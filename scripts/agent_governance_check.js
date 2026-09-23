// agent_governance_check.js  v1.0
// Read-only governance check for LibreChat-derived deployments.
//
//   mongosh "mongodb://localhost:27017/LibreChat" --quiet --file agent_governance_check.js > submission.json
//
// Emits aggregate counts only. Reads no message bodies, no agent instructions
// beyond pattern matching, no names, no email addresses, no identifiers.
// Nothing it prints can be traced to a user or an agent.
//
// Optional environment: DEPLOYMENT_LABEL, DEPLOYMENT_KIND, LIBRECHAT_VERSION.

const out = {
  schema_version: "1.0",
  snapshot_utc: new Date().toISOString(),
  deployment: {
    label: process.env.DEPLOYMENT_LABEL || null,      // e.g. "org-a" or "anon-1"
    kind: process.env.DEPLOYMENT_KIND || null,        // enterprise | team | hobby | public
    librechat_version: process.env.LIBRECHAT_VERSION || null,
    is_fork: null,                                     // filled below
  },
};

const names = new Set(db.getCollectionNames());
const has = (c) => names.has(c);
const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

// stock LibreChat has none of these; their presence indicates a fork
out.deployment.is_fork = ["sharedagents", "agentapikeys", "auditlogs", "memoryentries"]
  .some(has);
out.collections_present = {
  agents: has("agents"),
  conversations: has("conversations"),
  aclentries: has("aclentries"),
  projects: has("projects"),
  actions: has("actions"),
  sharedagents: has("sharedagents"),
  agentapikeys: has("agentapikeys"),
  auditlogs: has("auditlogs"),
  memoryentries: has("memoryentries"),
};

if (!has("agents")) {
  out.error = "no agents collection; not a LibreChat-derived database";
  print(JSON.stringify(out, null, 2));
  quit(0);
}

// ---------------------------------------------------------------- 1. scale
out.scale = {
  users: safe(() => db.users.countDocuments(), null),
  agents: db.agents.countDocuments(),
  agent_authors: db.agents.distinct("author").length,
  conversations: safe(() => db.conversations.countDocuments(), null),
  conversations_via_agent: safe(
    () => db.conversations.countDocuments({ agent_id: { $exists: true, $ne: null } }), null),
};

// ------------------------------------------------- 2. audit coverage (C0)
// The control question: does the platform record agent lifecycle events?
out.audit_coverage = {
  audit_documents: has("auditlogs") ? db.auditlogs.countDocuments() : null,
  agents_created: out.scale.agents,
  agents_revised: safe(() => db.agents.aggregate([
    { $project: { v: { $size: { $ifNull: ["$versions", []] } } } },
    { $match: { v: { $gte: 2 } } }, { $count: "n" },
  ]).toArray()[0]?.n || 0, null),
  share_events: has("sharedagents") ? db.sharedagents.countDocuments() : null,
  api_keys_issued: has("agentapikeys") ? db.agentapikeys.countDocuments() : null,
  api_keys_used: has("agentapikeys")
    ? db.agentapikeys.countDocuments({ lastUsedAt: { $ne: null } }) : null,
};

// ------------------------------------------------------ 3. lookup tables
const sharedIds = has("sharedagents")
  ? new Set(db.sharedagents.distinct("agentId").map(String)) : new Set();
const projectAgents = new Set(
  safe(() => (db.projects.findOne() || {}).agentIds || [], []).map(String));
const memoryUsers = has("memoryentries")
  ? new Set(db.memoryentries.distinct("userId").map(String)) : new Set();
const apiKeyUsers = has("agentapikeys")
  ? new Set(db.agentapikeys.distinct("userId").map(String)) : new Set();

const convCount = {};
safe(() => db.conversations.aggregate([
  { $match: { agent_id: { $exists: true, $ne: null } } },
  { $group: { _id: "$agent_id", n: { $sum: 1 } } },
]).forEach((r) => { convCount[String(r._id)] = r.n; }), null);

// ----------------------------------------------- 4. orphaned traffic (C14)
const liveIds = new Set(db.agents.distinct("id").map(String));
let orphanConv = 0, orphanAgents = 0, liveConv = 0, liveAgents = 0;
for (const [id, n] of Object.entries(convCount)) {
  if (liveIds.has(id)) { liveConv += n; liveAgents += 1; }
  else { orphanConv += n; orphanAgents += 1; }
}
out.deleted_agents = {
  agents_referenced_by_conversations: liveAgents + orphanAgents,
  agents_still_present: liveAgents,
  agents_deleted: orphanAgents,
  conversations_on_present_agents: liveConv,
  conversations_on_deleted_agents: orphanConv,
  pct_traffic_unreviewable: +(100 * orphanConv / Math.max(liveConv + orphanConv, 1)).toFixed(1),
};

// ------------------------------------------------------------ 5. patterns
// English-only keyword detection. Undercounts governance language in other
// languages, which biases measured failure UPWARD. See CODEBOOK.md.
const RE_ESCALATE = /escalat|ask (the )?(user|human|me)|check with|confirm with|defer to|if (you are |you'?re )?(unsure|uncertain)|do not (guess|assume)|human review|approval|sign[- ]?off|hand off|flag (it|this|for)/i;
const RE_PROHIBIT = /\bnever\b|\bdo not\b|\bdon'?t\b|must not|shall not|under no circumstance|refuse|avoid|out of scope|not permitted|prohibited/i;
const RE_SCOPE = /\byou (are|act as|will)\b|\brole\b|\bscope\b|\btask\b|\bonly\b|\bobjective\b|\bpurpose\b/i;
const EXTERNAL = /search|crawl|sitemap|news|trending|web|browser|fetch|tavily|traversaal|google|youtube|wolfram|weather|dalle|image_gen|flux|stable-diffusion|_action_/i;
const CODE = /execute_code/i;

// --------------------------------------------- 6. checks, over three cuts
const HARD = ["no_instructions", "capability_without_scope", "external_reach_unbounded",
              "code_exec_unbounded", "drift_while_shared"];

function evaluate(minConversations) {
  const per = {};
  let agents = 0, conversations = 0, hard = 0, hardConv = 0;
  const failDist = {};

  db.agents.find({}, {
    id: 1, author: 1, instructions: 1, tools: 1, mcpServerNames: 1, actions: 1,
    versions: 1, isShared: 1, projectIds: 1, createdAt: 1, updatedAt: 1,
    support_contact: 1,
  }).forEach((a) => {
    const id = String(a.id);
    const cv = convCount[id] || 0;
    if (cv < minConversations) return;
    agents += 1; conversations += cv;

    const instr = a.instructions || "";
    const tools = (a.tools || []).map(String);
    const bounded = RE_PROHIBIT.test(instr);
    const ext = tools.some((t) => EXTERNAL.test(t))
      || (a.mcpServerNames || []).length > 0
      || (a.actions || []).length > 0;
    const code = tools.some((t) => CODE.test(t));
    const edited = (a.versions || []).length >= 2 || a.updatedAt > a.createdAt;
    const shared = a.isShared === true || sharedIds.has(id)
      || projectAgents.has(id) || (a.projectIds || []).length > 0;
    const sc = a.support_contact;
    const namedContact = !!(sc && typeof sc === "object"
      ? (sc.name || sc.email) : sc);

    const f = [];
    if (instr.length === 0) f.push("no_instructions");
    if (tools.length > 0 && instr.length < 200) f.push("capability_without_scope");
    if (ext && !bounded) f.push("external_reach_unbounded");
    if (code && !bounded) f.push("code_exec_unbounded");
    if (shared && edited) f.push("drift_while_shared");
    if (!RE_ESCALATE.test(instr)) f.push("no_escalation");
    if (!bounded) f.push("no_prohibitions");
    if (!RE_SCOPE.test(instr)) f.push("no_role_statement");
    if (!namedContact) f.push("no_named_contact");
    if (shared) f.push("reachable_beyond_author");
    if (edited) f.push("revised_without_record");
    if (memoryUsers.has(String(a.author))) f.push("author_has_persistent_memory");
    if (apiKeyUsers.has(String(a.author))) f.push("author_holds_api_key");

    f.forEach((k) => {
      per[k] = per[k] || { agents: 0, conversations: 0 };
      per[k].agents += 1; per[k].conversations += cv;
    });
    const isHard = f.some((k) => HARD.includes(k));
    if (isHard) { hard += 1; hardConv += cv; }
    failDist[f.length] = (failDist[f.length] || 0) + 1;
  });

  return {
    agents, conversations,
    hard_fail_agents: hard,
    hard_fail_conversations: hardConv,
    hard_fail_pct: +(100 * hard / Math.max(agents, 1)).toFixed(1),
    checks: per,
    fail_count_distribution: Object.fromEntries(
      Object.entries(failDist).sort((x, y) => Number(x[0]) - Number(y[0]))),
  };
}

out.cuts = {
  all_agents: evaluate(0),
  used_at_least_once: evaluate(1),
  used_5_or_more: evaluate(5),
};

// -------------------------------------------------- 7. sharing mechanism
out.sharing = {
  acl_agent_grants_total: has("aclentries")
    ? db.aclentries.countDocuments({ resourceType: "agent" }) : null,
  acl_agents_with_multiple_grants: has("aclentries")
    ? db.aclentries.aggregate([
        { $match: { resourceType: "agent" } },
        { $group: { _id: "$resourceId", n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: "n" },
      ]).toArray()[0]?.n || 0
    : null,
  acl_agents_granted: has("aclentries")
    ? db.aclentries.distinct("resourceId", { resourceType: "agent" }).length : null,share_records: has("sharedagents") ? db.sharedagents.countDocuments() : null,
  share_records_public: has("sharedagents")
    ? db.sharedagents.countDocuments({ isPublic: true }) : null,
  agents_flagged_shared: db.agents.countDocuments({ isShared: true }),
};

// ------------------------------------------- 8. capability surface (context)
out.capability_surface = {
  tools_histogram: db.agents.aggregate([
    { $unwind: "$tools" },
    { $group: {
        _id: { $cond: [
          { $regexMatch: { input: { $toString: "$tools" }, regex: "_action_" } },
          "<action_tool>", "$tools" ] },
        agents: { $sum: 1 } } },
    { $sort: { agents: -1 } }, { $limit: 40 },
  ]).toArray(),
  instruction_length: db.agents.aggregate([
    { $project: { len: { $strLenCP: { $ifNull: ["$instructions", ""] } } } },
    { $bucket: { groupBy: "$len", boundaries: [0, 1, 201, 1001, 4001, 16001],
                 default: "16001+", output: { agents: { $sum: 1 } } } },
  ]).toArray(),
  versions: db.agents.aggregate([
    { $project: { v: { $size: { $ifNull: ["$versions", []] } } } },
    { $bucket: { groupBy: "$v", boundaries: [0, 1, 2, 3, 6, 11, 26],
                 default: "26+", output: { agents: { $sum: 1 } } } },
  ]).toArray(),
  memory_entries: has("memoryentries") ? db.memoryentries.countDocuments() : null,
  memory_users: memoryUsers.size || null,
  agents_declaring_memory_tool: db.agents.countDocuments({ tools: "memory" }),
};

print(JSON.stringify(out, null, 2));
