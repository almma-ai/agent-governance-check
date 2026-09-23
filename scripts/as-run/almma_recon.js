// almma_recon.js — Step 1 of the Almma agent-governance study.
// READ-ONLY. Aggregate counts only. No instruction text, no names, no user ids.
// Run:  mongosh "$MONGO_URI" --quiet --file almma_recon.js > recon_out.json

const out = { snapshot_utc: new Date().toISOString(), db: db.getName() };
const have = new Set(db.getCollectionNames());
const has = (c) => have.has(c);
const nz = (f) => ({ $gt: [{ $size: { $ifNull: ["$" + f, []] } }, 0] }); // non-empty array
const hist = (coll, expr, limit) =>
  db[coll].aggregate([
    { $group: { _id: expr, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    ...(limit ? [{ $limit: limit }] : []),
  ]).toArray();

// ------------------------------------------------------------ 1. denominators
out.scale = {
  users: db.users.countDocuments(),
  agents: db.agents.countDocuments(),
  distinct_agent_authors: db.agents.distinct("author").length,
  conversations: db.conversations.countDocuments(),
  messages: db.messages.estimatedDocumentCount(),
};

out.agents_per_author = db.agents.aggregate([
  { $group: { _id: "$author", n: { $sum: 1 } } },
  { $bucket: {
      groupBy: "$n",
      boundaries: [1, 2, 3, 6, 11, 26, 101],
      default: "101+",
      output: { authors: { $sum: 1 } },
  } },
]).toArray();

// ----------------------------------------------- 2. capability surface (non-empty)
out.capability_surface = db.agents.aggregate([
  { $group: {
      _id: null,
      total:            { $sum: 1 },
      with_tools:       { $sum: { $cond: [nz("tools"), 1, 0] } },
      with_handoffs:    { $sum: { $cond: [nz("agent_ids"), 1, 0] } },
      with_actions:     { $sum: { $cond: [nz("actions"), 1, 0] } },
      with_mcp:         { $sum: { $cond: [nz("mcpServerNames"), 1, 0] } },
      with_projectIds:  { $sum: { $cond: [nz("projectIds"), 1, 0] } },
      with_starters:    { $sum: { $cond: [nz("conversation_starters"), 1, 0] } },
      with_toolres:     { $sum: { $cond: [{ $gt: [{ $type: "$tool_resources" }, "missing"] }, 1, 0] } },
      artifacts_on:     { $sum: { $cond: [{ $in: ["$artifacts", [true, "auto", "shadcn-ui"]] }, 1, 0] } },
      is_shared:        { $sum: { $cond: [{ $eq: ["$isShared", true] }, 1, 0] } },
      is_restricted:    { $sum: { $cond: [{ $eq: ["$isRestricted", true] }, 1, 0] } },
      instr_empty:      { $sum: { $cond: [{ $in: [{ $strLenCP: { $ifNull: ["$instructions", ""] } }, [0]] }, 1, 0] } },
      edited:           { $sum: { $cond: [{ $gt: ["$updatedAt", "$createdAt"] }, 1, 0] } },
  } },
]).toArray();

// individual tool names, action-tools bucketed
out.tools_histogram = db.agents.aggregate([
  { $unwind: "$tools" },
  { $group: {
      _id: { $cond: [
        { $regexMatch: { input: { $toString: "$tools" }, regex: "_action_" } },
        "<action_tool>",
        "$tools",
      ] },
      n: { $sum: 1 },
      agents: { $addToSet: "$id" },
  } },
  { $project: { n: 1, agents: { $size: "$agents" } } },
  { $sort: { n: -1 } },
]).toArray();

out.mcp_servers = has("agents")
  ? db.agents.aggregate([
      { $unwind: "$mcpServerNames" },
      { $group: { _id: "$mcpServerNames", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray()
  : null;

out.providers = hist("agents", "$provider");
out.models_top20 = hist("agents", "$model", 20);
out.category = hist("agents", "$category", 20);

out.instruction_length = db.agents.aggregate([
  { $project: { len: { $strLenCP: { $ifNull: ["$instructions", ""] } } } },
  { $bucket: {
      groupBy: "$len",
      boundaries: [0, 1, 201, 1001, 4001, 16001],
      default: "16001+",
      output: { agents: { $sum: 1 } },
  } },
]).toArray();

// ------------------------------------------------------------------- 3. drift
out.versions_distribution = db.agents.aggregate([
  { $project: { v: { $size: { $ifNull: ["$versions", []] } } } },
  { $bucket: {
      groupBy: "$v",
      boundaries: [0, 1, 2, 3, 6, 11, 26],
      default: "26+",
      output: { agents: { $sum: 1 } },
  } },
]).toArray();

out.age_days = db.agents.aggregate([
  { $project: {
      age: { $divide: [{ $subtract: [new Date(), "$createdAt"] }, 86400000] },
      since_edit: { $divide: [{ $subtract: [new Date(), "$updatedAt"] }, 86400000] },
  } },
  { $group: {
      _id: null,
      min_age: { $min: "$age" }, max_age: { $max: "$age" }, avg_age: { $avg: "$age" },
      avg_days_since_edit: { $avg: "$since_edit" },
  } },
]).toArray();

// ------------------------------------------------ 4. reach: sharing + API keys
for (const c of ["sharedagents", "aclentries", "accessroles", "systemgrants",
                 "agentapikeys", "groups", "projects", "mcpservers",
                 "integrations", "pluginauths", "memoryentries", "skills",
                 "skillsynccredentials", "toolcalls", "agent_checkpoints",
                 "auditlogs", "actions"]) {
  if (!has(c)) continue;
  const one = db[c].findOne();
  out[c] = {
    count: db[c].countDocuments(),
    fields: one ? Object.keys(one).sort() : [],
  };
}

if (has("aclentries")) {
  out.aclentries.agent_grants = db.aclentries.aggregate([
    { $match: { resourceType: "agent" } },
    { $group: { _id: { p: "$principalType", bits: "$permBits" }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  out.aclentries.distinct_agents_granted =
    db.aclentries.distinct("resourceId", { resourceType: "agent" }).length;
}

if (has("agentapikeys")) {
  out.agentapikeys.distinct_agents = db.agentapikeys.distinct("agent_id").length;
  out.agentapikeys.sample_shape = db.agentapikeys.aggregate([
    { $sample: { size: 200 } },
    { $project: { keys: { $objectToArray: "$$ROOT" } } },
    { $unwind: "$keys" },
    { $group: { _id: "$keys.k", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
}

if (has("memoryentries")) {
  out.memoryentries.distinct_users = db.memoryentries.distinct("userId").length;
}

// ---------------------------------- 5. the money question: what IS audited?
if (has("auditlogs")) {
  out.auditlogs.field_shape = db.auditlogs.aggregate([
    { $sample: { size: 500 } },
    { $project: { keys: { $objectToArray: "$$ROOT" } } },
    { $unwind: "$keys" },
    { $group: { _id: "$keys.k", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  // try the likely event-name fields; whichever exists will populate
  for (const f of ["action", "event", "eventType", "type", "operation", "resourceType"]) {
    try {
      const h = hist("auditlogs", "$" + f, 40).filter((r) => r._id !== null);
      if (h.length) out.auditlogs["histogram_" + f] = h;
    } catch (e) { /* field absent */ }
  }
  out.auditlogs.date_range = db.auditlogs.aggregate([
    { $group: { _id: null, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
  ]).toArray();
}

// ------------------------------------------------- 6. external reach + secrets
if (has("actions")) {
  out.actions.domains = db.actions.aggregate([
    { $group: { _id: "$metadata.domain", n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 50 },
  ]).toArray();
  out.actions.auth_types = db.actions.aggregate([
    { $group: {
        _id: { type: "$metadata.auth.type", authz: "$metadata.auth.authorization_type" },
        n: { $sum: 1 },
        with_key: { $sum: { $cond: [{ $gt: [{ $type: "$metadata.api_key" }, "missing"] }, 1, 0] } },
    } },
    { $sort: { n: -1 } },
  ]).toArray();
}

// --------------------------------------------------- 7. usage linked to agents
if (has("conversations")) {
  out.usage = {
    by_endpoint: hist("conversations", "$endpoint", 20),
    with_agent_id: db.conversations.countDocuments({ agent_id: { $exists: true, $ne: null } }),
    distinct_agents_used: db.conversations.distinct("agent_id").length,
  };
  out.usage.per_agent_buckets = db.conversations.aggregate([
    { $match: { agent_id: { $exists: true, $ne: null } } },
    { $group: { _id: "$agent_id", n: { $sum: 1 } } },
    { $bucket: {
        groupBy: "$n",
        boundaries: [1, 2, 6, 21, 101, 1001],
        default: "1001+",
        output: { agents: { $sum: 1 }, conversations: { $sum: "$n" } },
    } },
  ]).toArray();
}

print(JSON.stringify(out, null, 2));
