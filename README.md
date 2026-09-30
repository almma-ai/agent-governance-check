# Agent Governance Check
> Checks agents against the [Delegation Charter Specification](https://github.com/almma-ai/delegation-charter), an open standard for AI agent accountability.

A read-only check that measures how much of a LibreChat deployment's agent
population would fail a delegation policy review, and how much of it was never
recorded in the first place.

One script, no dependencies beyond `mongosh`, aggregate output only.

```bash
mongosh "mongodb://localhost:27017/LibreChat" --quiet \
  --file scripts/agent_governance_check.js > submission.json
```

---

## Why

Agent creation in self-hosted deployments is typically unrestricted and
unlogged. Users build agents, attach tools, share them by link, revise them,
and delete them, and no record of any of it survives. Operators discover the
resulting exposure by going and looking — after the fact, if at all.

This repository makes that measurable. It does not judge whether agents
behaved well. It measures whether the delegation was *specified* well enough
that anyone could tell.

---

## What it measures

Checks derive from a delegated-task specification: a delegation is governed
when it names an owner, bounds the task, states what the agent must not do,
defines an escalation path, and remains reviewable after it changes.

**Hard tier** — capability held without stated bounds, or behaviour changed
while others could use it:

| Check | Fails when |
| --- | --- |
| `no_instructions` | The agent has no instructions at all |
| `capability_without_scope` | Holds tools with under 200 characters of scope |
| `external_reach_unbounded` | Reaches outside the tenant, no stated prohibitions |
| `code_exec_unbounded` | Executes code, no stated prohibitions |
| `drift_while_shared` | Revised after being made reachable by others |

**Context tier** — reported but not counted as failures, because they are
often near-universal: `no_escalation`, `no_prohibitions`, `no_role_statement`,
`no_named_contact`, `reachable_beyond_author`, `revised_without_record`,
`author_has_persistent_memory`, `author_holds_api_key`.

**Audit coverage** — lifecycle events that occurred, against records the
platform kept of them. This is the control question, and on some deployments
the denominator is thousands and the numerator is zero.

**Unreviewable traffic** — conversations referencing agents that no longer
exist. These cannot be checked at all: the configuration is gone.

Full definitions, including the regular expressions, are in
[CODEBOOK.md](CODEBOOK.md).

---

## Output

Aggregate counts only. The script reads no message bodies and prints no
instruction text, names, email addresses, identifiers or hostnames. Nothing it
emits can be traced to a user or an agent. Read
`scripts/agent_governance_check.js` before running it — it is under 250 lines
and every query is visible.

Results are reported over three populations, so that failures among working
agents can be distinguished from abandoned drafts:

- all agents
- agents used at least once
- agents used five or more times

---

## Contributing results

A single deployment is a case study. Several are a measurement.

If you run LibreChat or a fork, run the script and open a PR adding your
`submission.json` to `results/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the submission schema and the two fields you should fill in by hand
(deployment kind and version).

Anonymous submissions are welcome — label your deployment `anon-N`.

---

## Limitations

**It measures what agents declare, not how they behave.** A well-behaved agent
with no written boundaries fails. A badly-behaved one with careful
instructions passes. That is the intended reading: without a record, nobody
can tell which is which.

**Language checks are English-only.** Escalation, prohibition and scope are
detected by keyword patterns. Agents governed in other languages read as
failing, which biases the rate upward. Structural checks — tools held, sharing
state, revision history, deletion — are exact and unaffected.

**Fork-specific collections are optional.** `sharedagents`, `agentapikeys`,
`auditlogs` and `memoryentries` do not exist on stock LibreChat. The script
detects and skips them, reporting `null` rather than failing. Submissions note
which were present.

---

## Repository layout

scripts/agent_governance_check.js the portable check (run this)
scripts/as-run/ the original three-pass scripts, for provenance
schema/submission.schema.json structure of a valid results file
CODEBOOK.md check definitions and patterns
CONTRIBUTING.md how to submit results
results/ submitted aggregates, one file per deployment


---

## License

MIT. See [LICENSE](LICENSE).
