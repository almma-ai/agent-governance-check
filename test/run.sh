#!/usr/bin/env bash
# Runs v1.0 and v1.1 against mock stock and fork databases, then checks that
# (a) with suppression off, every v1.0 field is identical between versions, and
# (b) v1.1 counts sharing recorded in the access-control layer.
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
process.exit(fail);
JS
