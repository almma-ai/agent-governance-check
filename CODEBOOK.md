# Codebook

Every check, its exact definition, and what it gets wrong. Version 1.1.
Everything defined for 1.0 is unchanged; 1.1 adds the fields described in
[Version 1.1 additions](#version-11-additions).

Field names refer to the `agents` collection unless stated. All checks are
computed from stored configuration; none involves running an agent or reading
a conversation.

---

## Derivation

The checks operationalise a delegated-task specification: a delegation is
governed when it names an owner, bounds the task, states prohibitions, defines
an escalation path, and remains reviewable after change. Each element becomes
one or more structural or textual tests.

| Specification element | Checks |
| --- | --- |
| Names an owner | `no_named_contact` |
| Bounds the task | `no_instructions`, `capability_without_scope`, `no_role_statement` |
| States prohibitions | `no_prohibitions`, `external_reach_unbounded`, `code_exec_unbounded` |
| Defines escalation | `no_escalation` |
| Remains reviewable | `drift_while_shared`, `revised_without_record`, audit coverage, deleted agents |

---

## Patterns

Four regular expressions carry all textual checks. They run against
`instructions`, case-insensitive.

```
ESCALATE  escalat | ask (the )?(user|human|me) | check with | confirm with |
          defer to | if (you are |you're )?(unsure|uncertain) |
          do not (guess|assume) | human review | approval | sign-off |
          hand off | flag (it|this|for)

PROHIBIT  never | do not | don't | must not | shall not |
          under no circumstance | refuse | avoid | out of scope |
          not permitted | prohibited

SCOPE     you (are|act as|will) | role | scope | task | only |
          objective | purpose

EXTERNAL  search | crawl | sitemap | news | trending | web | browser | fetch |
          tavily | traversaal | google | youtube | wolfram | weather |
          dalle | image_gen | flux | stable-diffusion | _action_
```

`EXTERNAL` matches against tool names, not instructions. An agent also counts
as externally reaching if `mcpServerNames` or `actions` is non-empty.

**Known weakness.** The three instruction patterns are English-only. An agent
instructed in Portuguese to never contact customers directly will match none
of them and will be scored as unbounded. This inflates measured failure. It is
correctable by hand-labelling a random sample and reporting classifier
precision; until that is done, treat textual sub-checks as upper bounds.

**Second weakness.** Keyword presence is not comprehension. An agent whose
instructions contain the word "approval" in an unrelated sentence passes
`no_escalation`. This biases in the opposite direction, understating failure.
The two biases do not cancel and their relative size is unmeasured.

---

## Hard tier

Counted in `hard_fail_pct`. Each requires capability actually held, or reach
actually granted — not merely absent documentation.

### `no_instructions`
`instructions` is empty or absent. The agent runs on its model default with
no delegation statement whatsoever.

### `capability_without_scope`
`tools` is non-empty and `instructions` is under 200 characters. Capability
was attached without enough text to say what it is for. The threshold is
arbitrary; 200 characters is roughly two sentences. Sensitivity to this
threshold has not been tested.

### `external_reach_unbounded`
The agent reaches outside the deployment (matching `EXTERNAL`, or holding MCP
servers or actions) and `instructions` matches no `PROHIBIT` pattern. Reach
without a stated never-do list.

### `code_exec_unbounded`
Holds `execute_code` and matches no `PROHIBIT` pattern.

### `drift_while_shared`
The agent is reachable beyond its author **and** has been revised — two or
more stored `versions`, or `updatedAt` later than `createdAt`. Behaviour
changed underneath other people. Whether anyone reviewed the change is
unknowable where no audit record exists, which is the usual case.

---

## Context tier

Reported per check, excluded from the headline rate. These conditions are
frequently near-universal, and a composite including them produces rates above
99%, which is uninformative and reads as a broken instrument.

| Check | Definition |
| --- | --- |
| `no_escalation` | No `ESCALATE` match |
| `no_prohibitions` | No `PROHIBIT` match |
| `no_role_statement` | No `SCOPE` match |
| `no_named_contact` | `support_contact` absent, or an object with empty `name` and `email` |
| `reachable_beyond_author` | `isShared`, a `sharedagents` record, or membership of a project |
| `revised_without_record` | Two or more `versions`, or `updatedAt` > `createdAt` |
| `author_has_persistent_memory` | The author appears in `memoryentries` |
| `author_holds_api_key` | The author appears in `agentapikeys` |

`no_named_contact` deserves care. Some forks auto-create `support_contact` as
an empty `{name, email}` object. Presence of the field is not presence of an
owner; the check tests for non-empty values.

---

## Sharing mechanism

Two independent paths can make an agent reachable beyond its author, and they
are not visible to each other.

| Field | Meaning |
| --- | --- |
| `acl_agent_grants_total` | Permission grants recorded against agents |
| `acl_agents_granted` | Distinct agents carrying at least one grant |
| `acl_agents_with_multiple_grants` | Agents with more than one grant |
| `share_records` | Documents in a fork-specific share collection |
| `share_records_public` | Share records flagged public |
| `agents_flagged_shared` | Agents whose own `isShared` field is set |

Where every agent carries exactly one grant and none carries more than one,
the access-control layer records ownership and nothing else: no agent has been
granted to a second principal of any kind. Share records existing alongside
that pattern indicate a sharing path implemented outside the permission
system, which a permissions audit would not see.

"Public" in `share_records_public` refers to the flag stored on the share
record, not to internet reachability. On the reference deployment, opening a
share URL while unauthenticated redirects to login, so shares are public
within the authenticated user base rather than to anonymous visitors. This is
a property of the fork's routing, not of the data, so test it on your own
deployment before interpreting the figure: open a share URL for an agent that
still exists in a private browser window and record whether it renders.

Whether share identifiers are guessable is not assessed here.

## Audit coverage

Lifecycle events that occurred, against records retained:

| Event | Source |
| --- | --- |
| Agents created | `agents` count |
| Agents revised | agents with 2+ `versions` (a lower bound) |
| Agents shared | `sharedagents` count |
| API keys issued and used | `agentapikeys`, `lastUsedAt` |
| Audit records | `auditlogs` count |

Revisions are a lower bound: version history may be pruned, and edits that do
not create a version are invisible. Deletions cannot be counted directly at
all — see below.

---

## Deleted agents

Conversations store an `agent_id`. Where that identifier no longer resolves to
a row in `agents`, the agent was deleted. The script counts those identifiers
and the conversations attached to them.

This is inference, not logging, and it is one-directional: it finds agents
that were used and then deleted. Agents deleted without ever being used leave
no trace and are not counted. The true deletion count is therefore higher than
reported.

The configuration of a deleted agent — its instructions, tools, permissions
and model — is gone. No check can be run against it. Where this figure is
large, most of a deployment's agent activity is beyond audit as a matter of
fact rather than of policy.

---

## Populations

Every cut is reported over three populations:

| Cut | Definition | Purpose |
| --- | --- | --- |
| `all_agents` | Every agent | Headline |
| `used_at_least_once` | One or more conversations | Excludes abandoned drafts |
| `used_5_or_more` | Five or more conversations | Working agents only |

A failure rate that holds across all three is not an artefact of unused
drafts. A rate that collapses in the third cut is.

Conversation counts attach to surviving agents only. Traffic on deleted agents
is reported separately and cannot be attributed to any cut.

---

## Version 1.1 additions

Version 1.1 adds fields and changes none. With `AGC_SUPPRESS_SMALL=0`, every
1.0 field is computed and reported exactly as in 1.0, so 1.0 and 1.1
submissions remain comparable on the fields they share.

### Reachability through the access-control layer

Current upstream LibreChat records agent sharing in `aclentries`: a grant on a
resource of type `agent` to another user, a group, a role, or the public. The
1.0 definition of `reachable_beyond_author` reads only `isShared`, a fork's
`sharedagents` collection, and project membership, which current stock
deployments do not populate. On a stock deployment, 1.0 therefore reports
little or no sharing and little or no drift.

1.1 counts an agent as reachable beyond its author if the 1.0 definition holds
**or** the agent carries any `aclentries` grant (resource type `agent`, matched
on the agent's `_id`) to a principal that is not the author: a different user,
any group, any role, or the public. The author's own grant is excluded. Grants
of type `remoteAgent` are counted separately in
`sharing.acl_remote_agent_grants` and do not affect reachability.

Reported per cut under `v1_1`: `reachable_beyond_author` and
`drift_while_shared` (reachable as above **and** revised, as in 1.0).

On a deployment whose access-control layer holds only owner grants, as on the
1.0 reference deployment, the 1.1 values equal the 1.0 values.

### Structural hard tier

The cross-site headline. An agent fails if it meets any of:

- `no_instructions`
- `capability_without_scope` (tools held, under 200 characters of instructions)
- `drift_while_shared` (1.1 reachability)

None of these reads the words of the instructions, only their presence and
length, so the rate means the same for agents instructed in any language.
Reported per cut as `v1_1.structural_hard_fail_agents`, `_conversations` and
`_pct`.

`v1_1.hard_fail_*` is the 1.0 hard tier recomputed with 1.1 reachability: the
structural tier plus the two English keyword checks
(`external_reach_unbounded`, `code_exec_unbounded`).

### Small-count suppression

On by default. Every count from 1 to 4 is reported as the string `"<5"`, so
that results from a small deployment cannot single out an individual. Zero is
reported as zero, because an empty audit log is a finding. Fields whose names
contain `pct`, and histogram bucket labels (`_id`), are left as computed.
Tools held by fewer than five agents are grouped into one bucket, so that a
rare custom tool or MCP server name cannot point to an author.

Set `AGC_SUPPRESS_SMALL=0` only for internal use. Submissions should be made
with suppression on, and the output records which was used in
`small_counts_suppressed`.

**Known limits of suppression.** A percentage computed from a small numerator
can still be combined with its denominator to recover the count. On very small
deployments, review the output before sharing it.

### Sharing summary

`sharing` adds `acl_agents_shared_beyond_author` (agents with at least one
such grant), `acl_agent_grants_by_principal_type`, and
`acl_remote_agent_grants`.

### Known issue carried from 1.0

`deployment.is_fork` is true when any of `sharedagents`, `agentapikeys`,
`auditlogs` or `memoryentries` exists. Newer stock releases may create
`auditlogs` or `memoryentries`, so contributors should state in their
submission whether the deployment is a fork. The field is left unchanged for
comparability.

---

## Changes

**1.1** — adds reachability through the access-control layer, the structural
hard tier, small-count suppression and rare-tool grouping. No 1.0 field
changes. Tested against mock stock and fork databases (see `test/`).

**1.0** — initial release. Checks as run against a production deployment on
23 September 2026.
