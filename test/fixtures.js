// Two small LibreChat-shaped databases.
//   stock: sharing recorded only in aclentries (current upstream LibreChat)
//   fork:  sharing recorded in a fork's sharedagents collection / isShared flag;
//          the ACL holds owner grants only (as on the pilot deployment)
const LONG = (s) => s + " " + "x".repeat(260);
const t0 = new Date("2026-09-01T00:00:00Z"), t1 = new Date("2026-09-10T00:00:00Z");

function agents() {
  const a = (n, author, instructions, tools, versions, edited) => ({
    _id: "oid_" + n, id: "agent_" + n, author, instructions, tools,
    versions: Array.from({ length: versions }, () => ({})),
    createdAt: t0, updatedAt: edited ? t1 : t0,
  });
  return [
    a("A1", "u1", "", [], 1, false),                                        // no instructions
    a("A2", "u1", "You are a helper. Never share data.", ["web_search"], 1, false), // tools, <200 chars
    a("A3", "u2", LONG("You are a researcher."), ["web_search"], 3, true),  // reach, no prohibition, revised
    a("A4", "u2", LONG("You are a tutor. Do not grade."), [], 1, true),     // revised
    a("A5", "u3", LONG("You are a planner."), ["calculator"], 1, false),
    a("A6", "u3", LONG("Never run destructive code."), ["execute_code"], 1, false),
    a("A7", "u4", LONG("Never guess."), ["mytool_mcp_rare"], 1, false),     // rare tool
    a("A8", "u4", LONG("Never guess."), ["calculator"], 1, false),
    a("A9", "u4", LONG("Never guess."), ["calculator"], 1, false),
    a("A10", "u4", LONG("Never guess."), ["calculator"], 1, false),
    a("A11", "u4", LONG("Never guess."), ["calculator"], 1, false),
    a("A12", "u4", LONG("Never guess."), [], 1, false),
  ];
}
const conv = (id, n) => Array.from({ length: n }, () => ({ agent_id: id }));
const conversations = () => [
  ...conv("agent_A1", 2), ...conv("agent_A3", 6), ...conv("agent_A4", 1), ...conv("agent_A5", 3),
  ...conv("agent_A8", 5), ...conv("deleted_1", 4), ...conv("deleted_2", 1), {}, {},
];
const users = () => ["u1", "u2", "u3", "u4", "u5"].map((u) => ({ _id: u }));
const ownerGrants = (ags) => ags.map((x) => ({
  resourceType: "agent", resourceId: x._id, principalType: "user", principalId: x.author,
}));

const stockAgents = agents();
exports.stock = {
  users: users(),
  agents: stockAgents,
  conversations: conversations(),
  memoryentries: [{ userId: "u2" }],
  aclentries: [
    ...ownerGrants(stockAgents),
    { resourceType: "agent", resourceId: "oid_A3", principalType: "group", principalId: "g1" },
    { resourceType: "agent", resourceId: "oid_A4", principalType: "public" },
    { resourceType: "agent", resourceId: "oid_A5", principalType: "user", principalId: "u4" },
    { resourceType: "agent", resourceId: "oid_A6", principalType: "user", principalId: "u3" }, // owner again
    { resourceType: "promptGroup", resourceId: "oid_P1", principalType: "public" },            // not an agent
  ],
};

const forkAgents = agents();
forkAgents[3].isShared = true;   // A4 flagged shared
exports.fork = {
  users: users(),
  agents: forkAgents,
  conversations: conversations(),
  memoryentries: [{ userId: "u2" }],
  aclentries: ownerGrants(forkAgents),
  sharedagents: [{ agentId: "agent_A3", isPublic: true }],
  agentapikeys: [{ userId: "u1", lastUsedAt: null }],
  auditlogs: [],
};
