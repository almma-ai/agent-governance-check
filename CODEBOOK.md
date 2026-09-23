# Codebook

Every check, its exact definition, and what it gets wrong. Version 1.0.

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

## Changes

**1.0** — initial release. Checks as run against a production deployment on
23 September 2026.
