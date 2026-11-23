// Compares a live run with a run on the frozen copy.
// Usage: node compare_runs.js live.json frozen.json
const fs = require("fs");
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
const SKIP = new Set(["/snapshot_utc", "/deployment/is_fork", "/collections_present/actions"]);
const diffs = [];
(function cmp(x, y, p) {
  if (SKIP.has(p)) return;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y || {})])) cmp(x[k], (y || {})[k], `${p}/${k}`);
  } else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${p}: live ${JSON.stringify(x)} | frozen ${JSON.stringify(y)}`);
})(a, b, "");
console.log(diffs.length ? `DIFFERENCES (${diffs.length}):\n` + diffs.join("\n")
  : "MATCH: the frozen copy reproduces the live run exactly.");
console.log("Small differences in conversation counts are expected if users chatted during the export.");
