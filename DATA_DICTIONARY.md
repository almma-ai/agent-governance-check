# Data dictionary

Every field in the version 1.1 output file. Full rules and patterns are in [CODEBOOK.md](CODEBOOK.md); the study protocol is in [PROTOCOL.md](PROTOCOL.md).

Counts are whole numbers or "<5". Percentages have one decimal and are never suppressed. `null` means the collection behind the field does not exist on that deployment.

## Header

| Field | Definition |
| --- | --- |
| `schema_version`, `codebook_version` | Version of the output format and of the rules, "1.1". |
| `snapshot_utc` | Time of the run. A site may delete it or round it to the month. |
| `deployment.label` | Optional label set by the site (`DEPLOYMENT_LABEL`). For the multi-site study, leave blank: the investigator assigns site numbers. |
| `deployment.kind` | Optional (`DEPLOYMENT_KIND`): enterprise, team, hobby or public. |
| `deployment.librechat_version` | Optional (`LIBRECHAT_VERSION`), as set by the site. |
| `deployment.is_fork` | True if the database has collections that stock LibreChat lacks (sharing, API keys, audit log or memory). |
| `collections_present.*` | True or false for each of nine collections the script looks for. |
| `small_counts_suppressed` | True when counts from 1 to 4 were replaced with "<5". |
| `error` | Present only if the database has no agents collection; the run then stops. |

## Scale and audit coverage

| Field | Definition |
| --- | --- |
| `scale.users` | Number of user accounts. |
| `scale.agents` | Number of agents. |
| `scale.agent_authors` | Number of distinct accounts that created at least one agent. |
| `scale.conversations` | Number of conversations. |
| `scale.conversations_via_agent` | Conversations held with an agent. |
| `audit_coverage.audit_documents` | Entries in an audit log, if the deployment has one. |
| `audit_coverage.agents_created` | Same as `scale.agents`. |
| `audit_coverage.agents_revised` | Agents with two or more saved versions. |
| `audit_coverage.share_events` | Share-link records, on forks that keep them. |
| `audit_coverage.api_keys_issued`, `api_keys_used` | Agent API keys issued, and those used at least once, on forks that have them. |

## Deleted agents

| Field | Definition |
| --- | --- |
| `deleted_agents.agents_referenced_by_conversations` | Distinct agents named in conversations. |
| `deleted_agents.agents_still_present`, `agents_deleted` | Of those, agents that still exist and agents that have been deleted. |
| `deleted_agents.conversations_on_present_agents`, `conversations_on_deleted_agents` | Conversations held with each group. |
| `deleted_agents.pct_traffic_unreviewable` | Share of agent conversations whose agent no longer exists, so its configuration can no longer be reviewed. |

## Checks, reported for three groups of agents

The same fields are reported under `cuts.all_agents` (every agent), `cuts.used_at_least_once` (agents with one or more conversations) and `cuts.used_5_or_more` (five or more).

| Field | Definition |
| --- | --- |
| `agents`, `conversations` | Agents in the group, and the conversations held with them. |
| `hard_fail_agents`, `hard_fail_conversations`, `hard_fail_pct` | Agents failing at least one hard check, their conversations, and that share of the group. |
| `checks.<check>.agents`, `.conversations` | Agents failing that check, and their conversations. A check that no agent fails is absent. |
| `fail_count_distribution.<n>` | Number of agents failing exactly n checks. |
| `v1_1.reachable_beyond_author` | Agents (and their conversations) shared with anyone other than their author, counting access-control grants as well as share links and projects. |
| `v1_1.drift_while_shared` | Of those, agents revised after creation. |
| `v1_1.structural_hard_fail_*` | Agents failing any of the three checks that use no language patterns: count, conversations and share of the group. |
| `v1_1.hard_fail_*` | Agents failing any hard check, using the version 1.1 sharing count. |

The checks:

| Check | Tier | An agent fails when |
| --- | --- | --- |
| `no_instructions` | Hard, structural | Its instruction text is empty. |
| `capability_without_scope` | Hard, structural | It has at least one tool and fewer than 200 characters of instructions. |
| `drift_while_shared` | Hard, structural | It is shared beyond its author and was revised after creation. |
| `external_reach_unbounded` | Hard | It can reach outside the platform (web, search or similar tools, an MCP server or an action) and its instructions state no prohibition. |
| `code_exec_unbounded` | Hard | It can execute code and its instructions state no prohibition. |
| `no_escalation` | Context | Its instructions contain no escalation step, such as asking a person or deferring when unsure. |
| `no_prohibitions` | Context | Its instructions state no prohibition. |
| `no_role_statement` | Context | Its instructions state no role, task or scope. |
| `no_named_contact` | Context | Its support contact is empty. |
| `reachable_beyond_author` | Context | It is shared through a share link, a shared flag or a project. |
| `revised_without_record` | Context | It was changed after creation (two or more versions, or updated later). |
| `author_has_persistent_memory` | Context | Its author has stored memory entries (forks only). |
| `author_holds_api_key` | Context | Its author holds an agent API key (forks only). |

## Sharing

| Field | Definition |
| --- | --- |
| `sharing.acl_agent_grants_total` | Access-control grants on agents. |
| `sharing.acl_agents_granted` | Agents with at least one grant. |
| `sharing.acl_agents_with_multiple_grants` | Agents with two or more grants. |
| `sharing.acl_agents_shared_beyond_author` | Agents granted to anyone other than their author. |
| `sharing.acl_agent_grants_by_principal_type.<type>` | Grants by type of recipient: user, group, role or public. |
| `sharing.acl_remote_agent_grants` | Grants on remote agents. |
| `sharing.share_records`, `share_records_public` | Share-link records, and those open to the public, on forks that keep them. |
| `sharing.agents_flagged_shared` | Agents carrying a shared flag. |

## Capability surface

| Field | Definition |
| --- | --- |
| `capability_surface.tools_histogram` | Up to 40 tools with the number of agents holding each. Action tools are grouped as one entry, and tools held by fewer than five agents are grouped as another. |
| `capability_surface.instruction_length` | Agents by length of instructions in characters: 0, 1 to 200, 201 to 1,000, 1,001 to 4,000, 4,001 to 16,000, over 16,000. |
| `capability_surface.versions` | Agents by number of saved versions: 0, 1, 2, 3 to 5, 6 to 10, 11 to 25, over 25. |
| `capability_surface.memory_entries`, `memory_users` | Stored memory entries, and the accounts holding them, on forks that have memory. |
| `capability_surface.agents_declaring_memory_tool` | Agents with the memory tool enabled. |
