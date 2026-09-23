// almma_verify.js — Step 3 of the Almma agent-governance study.
// READ-ONLY. Aggregate counts only.
// Run: mongosh "mongodb://localhost:27017/LibreChat" --quiet --file ~/almma_verify.js > ~/verify_out.json

const out = { snapshot_utc: new Date().toISOString(), db: db.getName() };

// ---------------------------------------------- 1. orphan conversations
const liveIds = new Set(db.agents.distinct("id").map(String));
let convTotal = 0, convMatched = 0, convOrphan = 0;
const orphanIds = new Set(), matchedIds = new Set();

db.conversations.aggregate([
  { $match: { agent_id: { $exists: true, $ne: null } } },
  { $group: { _id: "$agent_id", n: { $sum: 1 } } },
]).forEach((r) => {
  const id = String(r._id);
  convTotal += r.n;
  if (liveIds.has(id)) { convMatched += r.n; matchedIds.add(id); }
  else { convOrphan += r.n; orphanIds.add(id); }
});

out.orphans = {
  conversations_with_agent_id: convTotal,
  conversations_matched_to_live_agent: convMatched,
  conversations_on_missing_agents: convOrphan,
  distinct_ids_referenced: matchedIds.size + orphanIds.size,
  distinct_ids_live: matchedIds.size,
  distinct_ids_missing: orphanIds.size,
  pct_traffic_on_missing_agents: +(100 * convOrphan / Math.max(convTotal, 1)).toFixed(1),
};
// are the missing ids malformed, or plausible deleted agent ids?
out.orphans.sample_missing_id_shape = [...orphanIds].slice(0, 5).map((s) => ({
  len: s.length, prefix: s.slice(0, 6),
}));

// ---------------------------------------- 2. is support_contact a default?
out.support_contact = {
  present: db.agents.countDocuments({ support_contact: { $exists: true, $ne: null, $ne: "" } }),
  distinct_values: db.agents.distinct("support_contact").length,
  top_shape: db.agents.aggregate([
    { $match: { support_contact: { $exists: true, $ne: null, $ne: "" } } },
    { $group: { _id: { $regexFind: { input: { $toString: "$support_contact" }, regex: "@.*$" } }, n: { $sum: 1 } } },
    { $project: { domain: "$_id.match", n: 1 } },
    { $sort: { n: -1 } }, { $limit: 10 },
  ]).toArray(),
};

// ------------------------------------------------- 3. API key sanity check
const apiKeyUsers = db.agentapikeys.distinct("userId").map(String);
out.api_keys = {
  keys: db.agentapikeys.countDocuments(),
  distinct_users: apiKeyUsers.length,
  agents_owned_by_key_holders: db.agents.countDocuments({
    $expr: { $in: [{ $toString: "$author" }, apiKeyUsers] },
  }),
  keys_used: db.agentapikeys.countDocuments({ lastUsedAt: { $ne: null } }),
  keys_never_used: db.agentapikeys.countDocuments({ lastUsedAt: null }),
};
// do key-holders' agents really have no conversations?
const keyHolderAgentIds = db.agents.find(
  { $expr: { $in: [{ $toString: "$author" }, apiKeyUsers] } }, { id: 1 }
).toArray().map((a) => String(a.id));
out.api_keys.conversations_on_key_holder_agents = db.conversations.countDocuments({
  agent_id: { $in: keyHolderAgentIds },
});

// -------------------------------- 4. the robustness cut: USED agents only
const convCount = {};
db.conversations.aggregate([
  { $match: { agent_id: { $exists: true, $ne: null } } },
  { $group: { _id: "$agent_id", n: { $sum: 1 } } },
]).forEach((r) => { convCount[String(r._id)] = r.n; });

const RE_ESCALATE = /escalat|ask (the )?(user|human|me)|check with|confirm with|defer to|if (you are |you'?re )?(unsure|uncertain)|do not (guess|assume)|human review|approval|sign[- ]?off|hand off|flag (it|this|for)/i;
const RE_PROHIBIT = /\bnever\b|\bdo not\b|\bdon'?t\b|must not|shall not|under no circumstance|refuse|avoid|out of scope|not permitted|prohibited/i;
const EXTERNAL = /search|crawl|sitemap|news|trending|web|browser|fetch|tavily|traversaal|google|youtube|wolfram|weather|dalle|image_gen|flux|stable-diffusion|_action_/i;
const CODE = /execute_code/i;
const sharedIds = new Set(db.sharedagents.distinct("agentId").map(String));

const cut = (label, filter) => {
  let n = 0, conv = 0, hard = 0, hardConv = 0;
  const per = {};
  db.agents.find({}, { id: 1, instructions: 1, tools: 1, mcpServerNames: 1,
    actions: 1, versions: 1, isShared: 1, projectIds: 1, createdAt: 1, updatedAt: 1 })
    .forEach((a) => {
      const id = String(a.id);
      const cv = convCount[id] || 0;
      if (!filter(cv)) return;
      n += 1; conv += cv;
      const instr = a.instructions || "";
      const tools = (a.tools || []).map(String);
      const ext = tools.some((t) => EXTERNAL.test(t)) || (a.mcpServerNames || []).length > 0 || (a.actions || []).length > 0;
      const code = tools.some((t) => CODE.test(t));
      const bounded = RE_PROHIBIT.test(instr);
      const edited = (a.versions || []).length >= 2 || a.updatedAt > a.createdAt;
      const shared = a.isShared === true || sharedIds.has(id) || (a.projectIds || []).length > 0;

      const f = [];
      if (instr.length === 0) f.push("no_instructions");
      if (tools.length > 0 && instr.length < 200) f.push("capability_without_scope");
      if (ext && !bounded) f.push("external_reach_unbounded");
      if (code && !bounded) f.push("code_exec_unbounded");
      if (shared && edited) f.push("drift_while_shared");
      if (!RE_ESCALATE.test(instr)) f.push("no_escalation");
      if (shared) f.push("shared_public");
      f.forEach((k) => { per[k] = per[k] || { agents: 0, conversations: 0 };
                         per[k].agents += 1; per[k].conversations += cv; });
      const isHard = f.some((k) => ["no_instructions", "capability_without_scope",
        "external_reach_unbounded", "code_exec_unbounded", "drift_while_shared"].includes(k));
      if (isHard) { hard += 1; hardConv += cv; }
    });
  return { label, agents: n, conversations: conv, hard_fail_agents: hard,
           hard_fail_conversations: hardConv,
           hard_fail_pct: +(100 * hard / Math.max(n, 1)).toFixed(1), checks: per };
};

out.cuts = [
  cut("all_agents", () => true),
  cut("used_at_least_once", (cv) => cv >= 1),
  cut("used_5_or_more", (cv) => cv >= 5),
];

print(JSON.stringify(out, null, 2));
