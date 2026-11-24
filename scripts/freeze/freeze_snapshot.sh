#!/usr/bin/env bash
# Freeze the AlmmaGPT data used by the agent governance study, for later audit.
#
# Reads production with mongoexport (read-only), keeps only the fields the study
# scripts read, restores the copy into a throwaway local MongoDB, runs the check
# on both, then packs, encrypts and fingerprints the copy.
#
# Never writes to production. Never stores the connection string.
#
# Needs: mongoexport + mongoimport (MongoDB Database Tools), mongosh, docker,
#        gpg, sha256sum, tar.
# Usage: MONGO_URI='mongodb://readonly-user:...@host:27017/?authSource=admin' \
#        DB_NAME=LibreChat ./freeze_snapshot.sh
set -euo pipefail

: "${MONGO_URI:?Set MONGO_URI to a read-only connection string}"
: "${DB_NAME:?Set DB_NAME to the AlmmaGPT database name}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/../agent_governance_check.js"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="almmagpt-freeze-$STAMP"
mkdir -p "$WORK/data" "$WORK/runs"
cd "$WORK"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a manifest.txt; }

for t in mongoexport mongoimport mongosh docker gpg sha256sum tar; do
  command -v "$t" >/dev/null || { echo "missing tool: $t"; exit 1; }
done

log "freeze started (UTC) $STAMP, database $DB_NAME"
log "check script: $(sha256sum "$CHECK" | cut -d' ' -f1)  agent_governance_check.js $(head -1 "$CHECK" | sed 's#^// ##')"

# 1. Live run, immediately before the export (suppression off and on).
log "live run before export"
AGC_SUPPRESS_SMALL=0 mongosh "$MONGO_URI" --quiet --eval "db = db.getSiblingDB('$DB_NAME')" --file "$CHECK" > runs/live_unsuppressed.json
mongosh "$MONGO_URI" --quiet --eval "db = db.getSiblingDB('$DB_NAME')" --file "$CHECK" > runs/live_suppressed.json
mongosh "$MONGO_URI" --quiet --eval "
  const d = db.getSiblingDB('$DB_NAME');
  const out = {};
  d.getCollectionNames().sort().forEach(c => { out[c] = d.getCollection(c).estimatedDocumentCount(); });
  print(JSON.stringify(out, null, 2));" > runs/live_collection_counts.json

# 2. Export. Fields left blank = whole collection.
#    Excluded on purpose: message content, conversation titles, memory text,
#    API key material, action credentials, user profiles.
export_coll() {   # collection  [comma-separated fields]
  local c="$1" f="${2:-}"
  local args=(--uri "$MONGO_URI" --db "$DB_NAME" --collection "$c" --jsonFormat=canonical --out "data/$c.json" --quiet)
  [ -n "$f" ] && args+=(--fields "$f")
  mongoexport "${args[@]}"
  log "exported $c: $(wc -l < "data/$c.json") documents${f:+ (fields: $f)}"
}
export_coll agents
export_coll conversations "_id,agent_id,createdAt,updatedAt"
export_coll users "_id"
export_coll aclentries
export_coll projects
export_coll sharedagents
export_coll agentapikeys "_id,userId,agent_id,createdAt,lastUsedAt"
export_coll auditlogs
export_coll memoryentries "_id,userId,createdAt"
export_coll actions "_id,agent_id,metadata.domain,metadata.auth.type,metadata.auth.authorization_type"
log "messages: not copied; live count is in runs/live_collection_counts.json"

# 3. Restore into a throwaway local MongoDB and run the same check.
log "restoring into a local container"
CID=$(docker run -d --rm -p 127.0.0.1:27099:27017 mongo:7)
trap 'docker stop "$CID" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do mongosh "mongodb://127.0.0.1:27099" --quiet --eval "db.runCommand({ping:1})" >/dev/null 2>&1 && break; sleep 1; done
for f in data/*.json; do
  c=$(basename "$f" .json)
  [ -s "$f" ] || { log "skip empty $c"; continue; }
  mongoimport --uri "mongodb://127.0.0.1:27099" --db frozen --collection "$c" --file "$f" --quiet
done
AGC_SUPPRESS_SMALL=0 mongosh "mongodb://127.0.0.1:27099/frozen" --quiet --file "$CHECK" > runs/frozen_unsuppressed.json
mongosh "mongodb://127.0.0.1:27099/frozen" --quiet --file "$CHECK" > runs/frozen_suppressed.json

# 4. Compare live and frozen (ignoring the run time and the fields an export can
#    change: collections that were not copied, and is_fork).
node "$HERE/compare_runs.js" runs/live_unsuppressed.json runs/frozen_unsuppressed.json | tee runs/comparison.txt | tee -a manifest.txt

# 5. Pack, encrypt, fingerprint.
cd ..
tar -czf "$WORK.tar.gz" "$WORK"
log "archive sha256 (unencrypted): $(sha256sum "$WORK.tar.gz" | cut -d' ' -f1)"
gpg --symmetric --cipher-algo AES256 --output "$WORK.tar.gz.gpg" "$WORK.tar.gz"
sha256sum "$WORK.tar.gz.gpg" | tee "$WORK.tar.gz.gpg.sha256"
shred -u "$WORK.tar.gz" 2>/dev/null || rm -f "$WORK.tar.gz"
echo
echo "Done. Keep:   $WORK.tar.gz.gpg   and   $WORK.tar.gz.gpg.sha256"
echo "Then delete the clear-text folder: rm -rf $WORK"
