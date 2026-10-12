// Runs a mongosh-style script against an in-memory mock of a LibreChat database.
// Usage: node mockrun.js <script.js> <fixture.js>   (env passes through)
const fs = require("fs");
const path = require("path");

const [scriptPath, fixturePath] = process.argv.slice(2);
const data = require(path.resolve(fixturePath));

const get = (doc, f) => f.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
function matchVal(v, cond) {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === "$exists") return x ? v !== undefined : v === undefined;
      if (op === "$ne") return Array.isArray(v) ? !v.includes(x) : (v ?? null) !== x;
      if (op === "$gt") return v > x;
      if (op === "$gte") return v >= x;
      throw new Error("unsupported op " + op);
    });
  }
  return Array.isArray(v) ? v.includes(cond) : v === cond;
}
const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([f, c]) => matchVal(get(doc, f), c));

function cursor(rows) {
  return { toArray: () => rows.slice(), forEach: (fn) => rows.forEach(fn) };
}
function evalExpr(doc, e) {
  if (typeof e === "string" && e.startsWith("$")) return get(doc, e.slice(1));
  if (e && e.$size) { const v = evalExpr(doc, e.$size); return (v || []).length; }
  if (e && e.$ifNull) { const v = evalExpr(doc, e.$ifNull[0]); return v ?? e.$ifNull[1]; }
  if (e && e.$cond) {  // only the tools-histogram form is used
    const [test, a, b] = e.$cond;
    const input = String(evalExpr(doc, test.$regexMatch.input.$toString));
    return new RegExp(test.$regexMatch.regex).test(input) ? a : evalExpr(doc, b);
  }
  return e;
}
function aggregate(rows, pipeline) {
  let r = rows.slice();
  for (const st of pipeline) {
    const [op, arg] = Object.entries(st)[0];
    if (op === "$match") r = r.filter((d) => matches(d, arg));
    else if (op === "$unwind") r = r.flatMap((d) => (get(d, arg.slice(1)) || []).map((x) => ({ ...d, [arg.slice(1)]: x })));
    else if (op === "$project") r = r.map((d) => Object.fromEntries(Object.entries(arg).map(([k, e]) => [k, evalExpr(d, e)])));
    else if (op === "$group") {
      const g = new Map();
      for (const d of r) {
        const key = evalExpr(d, arg._id);
        const kk = JSON.stringify(key);
        if (!g.has(kk)) g.set(kk, { _id: key });
        const acc = g.get(kk);
        for (const [f, spec] of Object.entries(arg)) {
          if (f === "_id") continue;
          if (spec.$sum !== undefined) acc[f] = (acc[f] || 0) + (spec.$sum === 1 ? 1 : evalExpr(d, spec.$sum));
          if (spec.$max !== undefined) { const v = evalExpr(d, spec.$max); acc[f] = acc[f] > v ? acc[f] : v; }
        }
      }
      r = [...g.values()];
    } else if (op === "$count") r = r.length ? [{ [arg]: r.length }] : [];
    else if (op === "$sort") { const [[k, dir]] = Object.entries(arg); r.sort((a, b) => (a[k] - b[k]) * dir); }
    else if (op === "$limit") r = r.slice(0, arg);
    else if (op === "$bucket") r = [];   // histogram buckets are not under test
    else throw new Error("unsupported stage " + op);
  }
  return cursor(r);
}
function collection(name) {
  const rows = data[name] || [];
  return {
    countDocuments: (f) => rows.filter((d) => matches(d, f)).length,
    estimatedDocumentCount: () => rows.length,
    distinct: (field, f) => [...new Set(rows.filter((d) => matches(d, f)).flatMap((d) => {
      const v = get(d, field); return Array.isArray(v) ? v : v === undefined ? [] : [v];
    }).map((v) => (typeof v === "object" ? JSON.stringify(v) : v)))],
    find: (f) => cursor(rows.filter((d) => matches(d, f))),
    findOne: (f) => rows.find((d) => matches(d, f)) || null,
    aggregate: (p) => aggregate(rows, p),
  };
}
const db = new Proxy({}, {
  get: (_, k) => {
    if (k === "getCollectionNames") return () => Object.keys(data);
    if (k === "getName") return () => "LibreChat";
    return collection(k);
  },
});
class Quit extends Error {}
const print = (x) => process.stdout.write(x + "\n");
const quit = () => { throw new Quit(); };
const src = fs.readFileSync(scriptPath, "utf8");
try { new Function("db", "print", "quit", "process", src)(db, print, quit, process); }
catch (e) { if (!(e instanceof Quit)) throw e; }
