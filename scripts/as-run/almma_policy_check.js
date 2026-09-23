// almma_policy_check.js — Step 2 of the Almma agent-governance study.
// READ-ONLY. Emits aggregate counts only. No instruction text, no names, no ids.
// Run:  mongosh "mongodb://localhost:27017/LibreChat" --quiet --file ~/almma_policy_check.js > ~/policy_out.json
//
// Checks derive from the canon's delegated-task specification:
// a delegation is governed only if it names an owner, bounds the task,
// states prohibitions, defines an escalation path, and is reviewable after change.

const out = { snapshot_utc: new Date().toISOString(), db: db.getName() };

// ------------------------------------------------------------ lookup tables
const sharedIds = new Set(db.sharedagents.distinct("agentId").map(String));
const apiKeyUsers = new Set(db.agentapikeys.distinct("userId").map(String));
const memoryUsers = new Set(db.memoryentries.distinct("userId").map(String));
const proj = db.projects.findOne() || {};
const projectAgents = new Set((proj.agentIds || []).map(String));

const convByAgent = {};
db.conversations.aggregate([
  { $match: { agent_id: { $exists: true, $ne: null } } },
  { $group: { _id: "$agent_id", n: { $sum: 1 }, last: { $max: "$updatedAt" } } },
]).forEach((r) => { convByAgent[String(r._id)] = r; });

// ------------------------------------------------------------------ patterns
// English-only. Undercounts non-English governance language -> conservative
// against the agent (inflates measured failure). Stated as a limitation.
const RE_ESCALATE = /escalat|ask (the )?(user|human|me)|check with|confirm with|defer to|if (you are |you'?re )?(unsure|uncertain)|do not (guess|assume)|human review|approval|sign[- ]?off|hand off|flag (it|this|for)/i;
const RE_PROHIBIT = /\bnever\b|\bdo not\b|\bdon'?t\b|must not|shall not|under no circumstance|refuse|avoid|out of scope|not permitted|prohibited/i;
const RE_OWNER = /@[\w.-]+\.\w+|owner|report to|responsible|contact/i;
const RE_SCOPE = /\byou (are|act as|will)\b|\brole\b|\bscope\b|\btask\b|\bonly\b|\bobjective\b|\bpurpose\b/i;

// tools that reach outside the tenant or act on the world
const EXTERNAL = /search|crawl|sitemap|news|trending|web|browser|fetch|tavily|traversaal|google|youtube|wolfram|weather|dalle|image_gen|flux|stable-diffusion|_action_/i;
const CODE = /execute_code/i;

const c = {};              // check counters
const bump = (k, conv) => {
  c[k] = c[k] || { agents: 0, conversations: 0 };
  c[k].agents += 1;
  c[k].conversations += conv;
};

let total = 0, totalConv = 0;
const failCountDist = {};      // how many checks each agent fails
const tierCounts = { hard_fail: { agents: 0, conversations: 0 },
                     any_fail:  { agents: 0, conversations: 0 },
                     clean:     { agents: 0, conversations: 0 } };
let supportContactPresent = 0, authorNamePresent = 0;

db.agents.find({}, {
  id: 1, author: 1, instructions: 1, tools: 1, mcpServerNames: 1, actions: 1,
  agent_ids: 1, versions: 1, isShared: 1, isRestricted: 1, projectIds: 1,
  createdAt: 1, updatedAt: 1, support_contact: 1, authorName: 1, category: 1,
}).forEach((a) => {
  total += 1;
  const aid = String(a.id);
  const conv = (convByAgent[aid] || {}).n || 0;
  totalConv += conv;

  const instr = a.instructions || "";
  const len = instr.length;
  const tools = (a.tools || []).map(String);
  const nTools = tools.length;
  const hasExternal = tools.some((t) => EXTERNAL.test(t)) ||
                      (a.mcpServerNames || []).length > 0 ||
                      (a.actions || []).length > 0;
  const hasCode = tools.some((t) => CODE.test(t));
  const versions = (a.versions || []).length;
  const edited = versions >= 2 || (a.updatedAt > a.createdAt);
  const shared = a.isShared === true || sharedIds.has(aid) || projectAgents.has(aid) ||
                 (a.projectIds || []).length > 0;

  if (a.support_contact) supportContactPresent += 1;
  if (a.authorName) authorNamePresent += 1;

  const fails = [];

  // C1 no task boundary at all
  if (len === 0) { fails.push("C1_no_instructions"); bump("C1_no_instructions", conv); }
  // C2 capability without scope: holds tools, instructions under 200 chars
  if (nTools > 0 && len < 200) { fails.push("C2_capability_without_scope"); bump("C2_capability_without_scope", conv); }
  // C3 no escalation path stated
  if (!RE_ESCALATE.test(instr)) { fails.push("C3_no_escalation"); bump("C3_no_escalation", conv); }
  // C4 no prohibitions / never-do list
  if (!RE_PROHIBIT.test(instr)) { fails.push("C4_no_prohibitions"); bump("C4_no_prohibitions", conv); }
  // C5 no role/scope statement
  if (!RE_SCOPE.test(instr)) { fails.push("C5_no_role_statement"); bump("C5_no_role_statement", conv); }
  // C6 no owner or contact of record in the spec
  if (!a.support_contact && !RE_OWNER.test(instr)) { fails.push("C6_no_owner_of_record"); bump("C6_no_owner_of_record", conv); }
  // C7 external reach without prohibitions
  if (hasExternal && !RE_PROHIBIT.test(instr)) { fails.push("C7_external_reach_unbounded"); bump("C7_external_reach_unbounded", conv); }
  // C8 code execution without prohibitions
  if (hasCode && !RE_PROHIBIT.test(instr)) { fails.push("C8_code_exec_unbounded"); bump("C8_code_exec_unbounded", conv); }
  // C9 shared beyond author (reach without a review record - none exist)
  if (shared) { fails.push("C9_shared_no_review_record"); bump("C9_shared_no_review_record", conv); }
  // C10 changed after creation with no approval record
  if (edited) { fails.push("C10_silent_revision"); bump("C10_silent_revision", conv); }
  // C11 shared AND edited: behaviour changed under other people
  if (shared && edited) { fails.push("C11_drift_while_shared"); bump("C11_drift_while_shared", conv); }
  // C12 author holds a programmatic API key (invocation outside the UI)
  if (apiKeyUsers.has(String(a.author))) { fails.push("C12_author_holds_api_key"); bump("C12_author_holds_api_key", conv); }
  // C13 author accumulates persistent memory
  if (memoryUsers.has(String(a.author))) { fails.push("C13_persistent_memory"); bump("C13_persistent_memory", conv); }

  // hard tier: capability actually exercised without stated bounds
  const hard = fails.some((f) => ["C1_no_instructions", "C2_capability_without_scope",
    "C7_external_reach_unbounded", "C8_code_exec_unbounded", "C11_drift_while_shared"].includes(f));

  failCountDist[fails.length] = (failCountDist[fails.length] || 0) + 1;
  if (hard) { tierCounts.hard_fail.agents += 1; tierCounts.hard_fail.conversations += conv; }
  if (fails.length) { tierCounts.any_fail.agents += 1; tierCounts.any_fail.conversations += conv; }
  else { tierCounts.clean.agents += 1; tierCounts.clean.conversations += conv; }
});

out.denominators = {
  agents: total,
  agent_conversations: totalConv,
  agents_ever_used: Object.keys(convByAgent).length,
  support_contact_present: supportContactPresent,
  authorName_present: authorNamePresent,
  share_records: sharedIds.size,
  api_key_users: apiKeyUsers.size,
  memory_users: memoryUsers.size,
};
out.checks = c;
out.tiers = tierCounts;
out.fail_count_distribution = Object.fromEntries(
  Object.entries(failCountDist).sort((a, b) => Number(a[0]) - Number(b[0]))
);

// ------------------------------------------ audit coverage: the control group
out.audit_coverage = {
  auditlogs_documents: db.auditlogs.countDocuments(),
  agents_created: total,
  revisions_at_least: db.agents.aggregate([
    { $project: { v: { $size: { $ifNull: ["$versions", []] } } } },
    { $match: { v: { $gte: 2 } } },
    { $count: "n" },
  ]).toArray(),
  share_events: db.sharedagents.countDocuments(),
  api_keys_issued: db.agentapikeys.countDocuments(),
  api_keys_used: db.agentapikeys.countDocuments({ lastUsedAt: { $ne: null } }),
};

// ------------------------------- sharing path divergence (ACL vs share links)
out.sharing_paths = {
  acl_agent_grants_nonowner: db.aclentries.countDocuments({
    resourceType: "agent", principalType: { $ne: "user" },
  }),
  acl_agent_grants_total: db.aclentries.countDocuments({ resourceType: "agent" }),
  sharedagents_records: db.sharedagents.countDocuments(),
  sharedagents_public: db.sharedagents.countDocuments({ isPublic: true }),
  sharedagents_distinct_agents: sharedIds.size,
  agents_flagged_isShared: db.agents.countDocuments({ isShared: true }),
};

print(JSON.stringify(out, null, 2));
