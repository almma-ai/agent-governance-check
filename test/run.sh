#!/usr/bin/env bash
# Runs v1.0 and the current version (v1.2) against mock stock and fork databases, then checks that
# (a) with suppression off, every v1.0 field is identical between versions, and
# (b) v1.1 counts sharing recorded in the access-control layer, and
# (c) v1.2 counts only saved agents, reporting temporary agent IDs separately.
# Needs Node.js only; no database.
set -euo pipefail
cd "$(dirname "$0")"
OUT=$(mktemp -d)
for f in stock fork; do
  node mockrun.js agent_governance_check.v1.0.js "$f.js" > "$OUT/$f.v10.json"
  AGC_SUPPRESS_SMALL=0 node mockrun.js ../scripts/agent_governance_check.js "$f.js" > "$OUT/$f.v11.json"
  node mockrun.js ../scripts/agent_governance_check.js "$f.js" > "$OUT/$f.v11.suppressed.json"
done
node - "$OUT" <<'JS'
const fs = require("fs"); const dir = process.argv[2];
const read = (n) => JSON.parse(fs.readFileSync(`${dir}/${n}`, "utf8"));
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fail = 1; };
for (const f of ["stock", "fork"]) {
  const a = read(`${f}.v10.json`), b = read(`${f}.v11.json`);
  const diffs = [];
  const cmp = (x, y, p) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const k of Object.keys(x)) {
        if (["snapshot_utc", "schema_version"].includes(k) && p === "") continue;
        if (!(k in y)) diffs.push(`${p}/${k} missing`); else cmp(x[k], y[k], `${p}/${k}`);
      }
    } else if (Array.isArray(x) && p.startsWith("/capability_surface/")) {
      // v1.2.1 sorts these lists deterministically; compare them as sets
      const key = (arr) => arr.map((e) => JSON.stringify(e)).sort().join("|");
      if (!Array.isArray(y) || key(x) !== key(y)) diffs.push(p);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(p);
  };
  cmp(a, b, "");
  check(diffs.length === 0, `${f}: every v1.0 field unchanged ${diffs.join(", ")}`);
}
const s = read("stock.v11.json").cuts.all_agents;
check(s.checks.reachable_beyond_author === undefined, "stock: v1.0 sees no sharing (the bug v1.1 fixes)");
check(s.v1_1.reachable_beyond_author.agents === 3, "stock: v1.1 counts 3 agents shared via ACL");
check(s.v1_1.drift_while_shared.agents === 2, "stock: v1.1 counts 2 revised while shared");
check(s.v1_1.structural_hard_fail_agents === 4, "stock: structural hard tier = 4 of 12");
const k = read("fork.v11.json").cuts.all_agents;
check(k.v1_1.reachable_beyond_author.agents === k.checks.reachable_beyond_author.agents,
  "fork: owner-only ACL leaves reachability as in v1.0");
const sup = read("stock.v11.suppressed.json");
check(sup.scale.agent_authors === "<5" && sup.scale.agents === 12, "suppression: 1-4 become \"<5\", larger counts kept");
check(sup.audit_coverage.agents_created === 12 && sup.cuts.all_agents.hard_fail_pct === read("stock.v11.json").cuts.all_agents.hard_fail_pct,
  "suppression: percentages untouched");
check(sup.capability_surface.tools_histogram.every((t) => t._id === "calculator" || t._id.startsWith("<")),
  "suppression: rare tool names grouped");
const d = read("stock.v11.json");
check(d.deleted_agents.pct_traffic_unreviewable === 37, "legacy: temporary IDs counted as deleted agents (37.0%), as in v1.0/v1.1");
const v = d.deleted_agents.v1_2;
check(v.agents_deleted === 2 && v.conversations_on_deleted_agents === 5, "v1.2: 2 deleted saved agents, 5 conversations");
check(v.conversations_on_present_agents === 17 && v.agents_still_present === 5, "v1.2: 5 present agents, 17 conversations");
check(v.pct_traffic_unreviewable === 22.7, "v1.2: unreviewable share over saved agents only = 22.7%");
check(v.temporary_agent_ids === 2 && v.conversations_with_temporary_agent_id === 5, "v1.2: 2 temporary IDs, 5 conversations, reported separately");
check(d.scale.v1_2.conversations_via_saved_agent === 22 && d.scale.conversations_via_agent === 27, "v1.2: 22 conversations via saved agents vs 27 legacy");
check(d.schema_version === "1.2", "schema_version is 1.2");
const h = d.capability_surface.tools_histogram;
check(h.every((x, i) => i === 0 || h[i-1].agents > x.agents || (h[i-1].agents === x.agents && String(h[i-1]._id) < String(x._id))), "v1.2.1: tools histogram sorted by count, ties by name");
const il = d.capability_surface.instruction_length.map((x) => x._id);
check(JSON.stringify(il) === JSON.stringify([...il].sort((a, b) => (typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : (typeof a === "number" ? -1 : 1)))), "v1.2.1: length buckets sorted by lower bound");
process.exit(fail);
JS
