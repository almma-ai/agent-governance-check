#!/usr/bin/env bash
# Adapted from scripts/freeze/freeze_snapshot.sh (branch freeze-snapshot) for
# almma-prod-01: live check, field-limited export, throwaway restore, frozen check.
#
# Production is touched only through `docker exec chat-mongodb` running mongosh
# reads and mongoexport. mongod runs --noauth, so no credentials exist or are
# used. No packages, no image pulls. Encryption is NOT done here.
#
# Usage: bash freeze_server.sh <STAMP> <expected sha256 of agent_governance_check.js> <repo commit>
set -euo pipefail
umask 077

STAMP="$1"; CHECK_SHA="$2"; COMMIT="$3"
WORK="/root/almmagpt-freeze-$STAMP"
CHECK="$WORK/agent_governance_check.js"
PROD=chat-mongodb
DB=LibreChat
IMAGE=mongo:8.0.20
RESTORE="agc-freeze-restore-$STAMP"
SH_HOME="/tmp/agc-mongosh-$STAMP"   # mongosh client logs go here, not into /data/db (the prod data dir)
RDIR="$(mktemp -d /root/agc-restore-db.XXXXXX)"

COPY=(agents conversations users aclentries projects sharedagents agentapikeys auditlogs memoryentries actions)
declare -A FIELDS=(           # mongoexport --fields; collections in neither map are copied whole
  [conversations]="_id,agent_id,createdAt,updatedAt"
  [users]="_id"
  [agentapikeys]="_id,userId,agent_id,createdAt,lastUsedAt"
  [memoryentries]="_id,userId,createdAt"
)
# Server-side projections, run by mongosh. mongoexport --fields does not limit
# subdocuments (it exported all of actions.metadata, credentials included).
AGENT_FIELDS='_id id author authorName instructions tools mcpServerNames actions agent_ids isShared isRestricted projectIds createdAt updatedAt support_contact category versions'
declare -A PROJ=(
  [actions]='db.actions.find({}, { _id: 1, agent_id: 1, "metadata.domain": 1, "metadata.auth.type": 1, "metadata.auth.authorization_type": 1 })'
  [agents]='db.agents.aggregate([{ $project: { id: 1, author: 1, authorName: 1, instructions: 1, tools: 1, mcpServerNames: 1, actions: 1, agent_ids: 1, isShared: 1, isRestricted: 1, projectIds: 1, createdAt: 1, updatedAt: 1, support_contact: 1, category: 1, versions: { $map: { input: { $ifNull: ["$versions", []] }, as: "v", in: { updatedAt: "$$v.updatedAt" } } } } }])'
  [sharedagents]='db.sharedagents.find({}, { _id: 1, agentId: 1, isPublic: 1, createdAt: 1, updatedAt: 1 })'
)

cd "$WORK"; mkdir -p data runs
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a manifest.txt; }

cleanup() {
  docker exec "$PROD" rm -rf "$SH_HOME" >/dev/null 2>&1 || true
  docker rm -f "$RESTORE" >/dev/null 2>&1 || true
  rm -rf "$RDIR"
}
trap cleanup EXIT

# psh [-e VAR=value ...] '<js>': read-only mongosh against production
psh() {
  local envs=(); while [ "$1" = -e ]; do envs+=(-e "$2"); shift 2; done
  docker exec -e HOME="$SH_HOME" "${envs[@]}" "$PROD" mongosh --quiet "$DB" --eval "$1"
}
# rsh [-e VAR=value ...] '<js>': mongosh against the throwaway copy
rsh() {
  local envs=(); while [ "$1" = -e ]; do envs+=(-e "$2"); shift 2; done
  docker exec -e HOME=/tmp "${envs[@]}" "$RESTORE" mongosh --quiet frozen --eval "$1"
}

# 0. Preflight
[ "$(sha256sum < "$CHECK" | cut -d' ' -f1)" = "$CHECK_SHA" ] || { echo "check script sha256 mismatch"; exit 1; }
docker image inspect "$IMAGE" >/dev/null || { echo "$IMAGE not present locally; not pulling"; exit 1; }
avail_gb=$(df -BG --output=avail /root | tail -1 | tr -dc 0-9)
[ "$avail_gb" -ge 20 ] || { echo "less than 20 GB free"; exit 1; }
docker exec "$PROD" mkdir -p "$SH_HOME"
SRC="$(cat "$CHECK")"
LCV="$(docker exec LibreChat-API node -p "require('/app/package.json').version")"

log "freeze started (UTC) $STAMP on $(hostname)"
log "database $DB in container $PROD, image $(docker inspect -f '{{.Config.Image}}' "$PROD"), server $(psh 'print(db.version())')"
log "app container LibreChat-API, image $(docker inspect -f '{{.Config.Image}} {{.Image}}' LibreChat-API), LibreChat $LCV"
log "check script sha256 $CHECK_SHA ($(head -1 "$CHECK" | sed 's#^// ##')), agent-governance-check freeze-snapshot @ $COMMIT"

# 1. Live run, immediately before the export (suppression off and on), plus exact counts.
COUNTS_JS='const o = {}; db.getCollectionNames().sort().forEach(c => { o[c] = db.getCollection(c).countDocuments(); }); print(JSON.stringify(o, null, 2));'
log "live run before export"
psh "$COUNTS_JS" > runs/live_collection_counts.json
psh -e AGC_SUPPRESS_SMALL=0 -e LIBRECHAT_VERSION="$LCV" "$SRC" > runs/live_unsuppressed.json
psh -e LIBRECHAT_VERSION="$LCV" "$SRC" > runs/live_suppressed.json

# 2. Export to the host. Excluded on purpose: messages, conversation titles,
#    memory text, API key material, action credentials, user profiles.
for c in "${COPY[@]}"; do
  f="${FIELDS[$c]:-}"; p="${PROJ[$c]:-}"
  if [ -n "$p" ]; then
    psh "$p.forEach(d => print(EJSON.stringify(d, { relaxed: false })))" > "data/$c.json"
    log "exported $c: $(wc -l < "data/$c.json") documents, projection: $p"
  else
    docker exec "$PROD" mongoexport --db "$DB" --collection "$c" --jsonFormat=canonical --quiet ${f:+--fields "$f"} > "data/$c.json"
    log "exported $c: $(wc -l < "data/$c.json") documents, fields: ${f:-all}"
  fi
done
psh "$COUNTS_JS" > runs/live_collection_counts_after_export.json
log "messages: not copied; live count $(grep '"messages"' runs/live_collection_counts.json | tr -dc 0-9)"

# 3. Restore into a throwaway container: no network at all, capped resources,
#    data in a temp dir that the EXIT trap deletes.
log "restoring into throwaway container $RESTORE ($IMAGE, --network none)"
docker run -d --name "$RESTORE" --pull never --network none --cpus 2 --memory 3g \
  -v "$RDIR":/data/db "$IMAGE" mongod --wiredTigerCacheSizeGB 1 --bind_ip 127.0.0.1 >/dev/null
for i in $(seq 1 60); do rsh 'db.runCommand({ping: 1}).ok' >/dev/null 2>&1 && break; sleep 1; done
for c in "${COPY[@]}"; do
  if [ -s "data/$c.json" ]; then
    docker exec -i "$RESTORE" mongoimport --db frozen --collection "$c" --quiet < "data/$c.json"
  elif grep -q "\"$c\":" runs/live_collection_counts.json; then
    rsh "db.createCollection('$c')" >/dev/null
    log "created empty $c (exists in production with 0 documents)"
  fi
  n=$(rsh "print(db.getCollection('$c').countDocuments())")
  [ "$n" -eq "$(wc -l < "data/$c.json")" ] || { log "import count mismatch for $c"; exit 1; }
done

# Field audit over the copy, key names only (never values):
#  - every document of every copied collection is walked, nested keys included;
#    the number walked and the distinct key paths are recorded per collection;
#  - it aborts if documents walked differ from the exported count, or if the
#    collections present differ from those copied;
#  - field-limited collections abort on any path outside their allow-list;
#  - every collection aborts on a key name that looks like a secret, unless the
#    exact path is allowed.
EXPORTED="{$(for c in "${COPY[@]}"; do printf '"%s": %s, ' "$c" "$(wc -l < "data/$c.json")"; done)}"
rsh "
const EXPORTED = $EXPORTED;
const AGENT = '$AGENT_FIELDS'.split(' ');
const allowed = {
  conversations: ['_id','agent_id','createdAt','updatedAt'], users: ['_id'],
  agentapikeys: ['_id','userId','agent_id','createdAt','lastUsedAt'],
  memoryentries: ['_id','userId','createdAt'],
  actions: ['_id','agent_id','metadata','metadata.domain','metadata.auth','metadata.auth.type','metadata.auth.authorization_type'],
  agents: AGENT.concat(['versions[]','versions[].updatedAt']),   // plus anything under support_contact (see below)
  sharedagents: ['_id','agentId','isPublic','createdAt','updatedAt'],
};
const SECRET = /key|token|secret|passw|pwd|auth|credential|cookie|bearer|session|cert|private|signature/i;
const SECRET_OK = new Set(['author','authorName','metadata.auth','metadata.auth.type','metadata.auth.authorization_type']);
// Documents are walked as plain JSON parsed in this realm (driver objects come
// from another realm). Objects whose keys all start with $ ({\$oid}, {\$date},
// ...) are canonical EJSON values, not fields.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isValue = (v) => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith('\$'));
const isField = (v) => Array.isArray(v) || (isObj(v) && !isValue(v));
function walk(v, p, out) {
  if (Array.isArray(v)) { v.forEach((x) => { if (isField(x)) { out.add(p + '[]'); walk(x, p + '[]', out); } }); return; }
  if (!isObj(v) || isValue(v)) return;
  for (const k of Object.keys(v)) { const q = p ? p + '.' + k : k; out.add(q); walk(v[k], q, out); }
}
const present = db.getCollectionNames().sort().join(','), copied = Object.keys(EXPORTED).sort().join(',');
if (present !== copied) throw new Error('collections in the copy (' + present + ') differ from those copied (' + copied + ')');
Object.keys(EXPORTED).sort().forEach((c) => {
  const paths = new Set();
  let walked = 0;
  db.getCollection(c).find().forEach((d) => { walked += 1; walk(JSON.parse(EJSON.stringify(d, { relaxed: false })), '', paths); });
  const list = [...paths].sort();
  print('field audit ' + c + ': walked ' + walked + ' of ' + EXPORTED[c] + ' exported documents; paths: ' + (list.join(', ') || '(none)'));
  if (walked !== EXPORTED[c]) throw new Error(c + ': walked ' + walked + ' documents, exported ' + EXPORTED[c]);
  if (walked > 0 && list.length === 0) throw new Error(c + ': no field paths found in ' + walked + ' documents');
  const ok = (x) => allowed[c].includes(x) || (c === 'agents' && x.startsWith('support_contact.'));
  if (allowed[c]) { const bad = list.filter((x) => !ok(x)); if (bad.length) throw new Error(c + ' has fields outside its allow-list: ' + bad); }
  const sus = list.filter((x) => !SECRET_OK.has(x) && SECRET.test(x.split('.').pop().replace('[]', '')));
  if (sus.length) throw new Error(c + ' has key names that look like secrets: ' + sus);
});
print('field audit: passed');
" | tee -a manifest.txt

rsh -e AGC_SUPPRESS_SMALL=0 -e LIBRECHAT_VERSION="$LCV" "$SRC" > runs/frozen_unsuppressed.json
rsh -e LIBRECHAT_VERSION="$LCV" "$SRC" > runs/frozen_suppressed.json

cleanup; trap - EXIT
docker ps -a --format '{{.Names}}' | grep -q "^$RESTORE$" && { log "restore container still present"; exit 1; }
log "throwaway container and its data removed; mongosh temp dir removed from $PROD"

(cd "$WORK" && sha256sum data/*.json runs/*.json agent_governance_check.js freeze_server.sh > SHA256SUMS)
log "phase 1 done; comparison runs on the investigator's laptop"
