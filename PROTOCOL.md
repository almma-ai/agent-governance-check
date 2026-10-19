# Multi-site study protocol

Version 1, October 19, 2026. Field definitions are in [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## Purpose and status

The study counts how AI agents are governed on LibreChat deployments, using site-wide totals only. It is led by Lucas E. Wall, Assistant Professor of Practice, Busch School of Business, The Catholic University of America (CUA).

- **Question.** How many deployed agents run without written instructions, hold capabilities without a stated scope, or keep changing while shared with others, and whether the platform records those events.
- **Design.** Described in [Agents Outrun Review: A Read-Only Audit and Multi-Site Protocol for Delegated AI Agents](https://papers.ssrn.com/abstract=7599098) (SSRN 7599098, October 2026).
- **Human subjects status.** CUA's Office of Research advised in writing on October 14, 2026 that research with no interaction with living people and no identifiable information is not human subjects research as federally defined (45 CFR 46.102). The study, as described to that office, meets both conditions, so no IRB protocol or protocol number exists. The correspondence is available to participating sites on request.
- **Changes.** Any later phase that involves people or identifiable data, such as human review of instruction text, will go to the CUA IRB before it starts, and participating sites will be told.

## Site recruitment and participation

Participation is voluntary, decided by each site, and can be withdrawn at any time before publication.

- **Who is invited.** Universities and other organizations that run their own LibreChat deployment. Invitations go to the people responsible for each service, found through public sources and LibreChat's community channels. No one at a site is contacted as a research participant.
- **What a site agrees to.** Running the read-only check once on its own system, reviewing the output, and sending it if it chooses. A site may instead compute the same fields with its own tools.
- **What a site controls.** Whether to run the check, what it sends, whether it is named in the list of participants, and the wording of anything specific to it before publication.
- **Withdrawal.** A site that withdraws before publication has its submission deleted and excluded. After publication its figures cannot be removed from the paper, but no further use is made of them.

## Data collection

Each site runs one read-only script against its own LibreChat database and receives a single file of site-wide totals; nothing is sent anywhere unless the site sends it.

- **The instrument.** [scripts/agent_governance_check.js](scripts/agent_governance_check.js), version 1.1 (tag `v1.1`), about 330 lines, open source (MIT), run with `mongosh`. It makes no network calls and writes nothing to the database. Running it under a read-only database account is recommended.
- **What it reads.** Agent configuration records (instruction text, enabled tools, author account ID, version history, sharing settings, creation and update times, whether a support contact is filled in); the agent each conversation used, to count conversations per agent; access-control entries for agents; the number of user accounts; and, where they exist, a fork's sharing, API-key, audit-log and memory collections, which it only counts.
- **What it never reads.** Message content, user names, email addresses or any other profile field.
- **How instruction text is used.** It is scanned in memory for a few English keyword patterns (for example, whether an instruction states a prohibition or an escalation step). Only yes/no tallies are kept; no text is stored or output.
- **What it outputs.** One JSON file of totals for the whole deployment, defined field by field in [DATA_DICTIONARY.md](DATA_DICTIONARY.md). No account IDs, agent IDs, names or message text appear in it.
- **Small counts.** Any count from 1 to 4 is reported as "<5", and tools held by fewer than five agents are grouped into one bucket. Zero is kept, because an empty audit log is itself a finding.

Before sending, the site reviews the file and may change two fields:

- `snapshot_utc` holds the exact time of the run. A site that does not share exact dates can delete it or round it to the month.
- `capability_surface.tools_histogram` names each tool held by five or more agents. A custom tool or server name that would identify the site can be replaced with a generic label.

## Data storage, sharing and publication

Submissions are held only in the investigator's CUA account, and no published result can be linked to the site that produced it.

- **Receipt and storage.** Sites send their file to walll@cua.edu. Files are stored only in CUA-managed storage under that account, never on Almma.AI systems.
- **Site numbers.** Each site is assigned a number (Site 01, Site 02, and so on). The key linking numbers to organizations is kept in a separate file in the same CUA account, is never published, and is never shared with anyone.
- **What is published.** Pooled totals across sites, and per-site results under site numbers only. Per-site results are given as percentages and size bands, not absolute counts, so that a site's size cannot identify it.
- **List of participants.** The paper may list the organizations that took part, in alphabetical order and without site numbers. Each site chooses whether it appears on that list; the default is not listed.
- **Public repository.** This repository can hold submitted results, but a site's file is posted here only with that site's written consent. The default is not posted.
- **Review before publication.** Each site receives any wording that describes it, or its site-numbered results, at least 10 business days before publication, and its corrections are made.
- **Retention.** Submissions and the key are kept for five years after final publication, to allow the results to be checked, then deleted. A site may ask for earlier deletion of its own file at any time.

## Conflict of interest

The investigator founded and leads Almma.AI, a company that builds and operates AI systems including LibreChat-based deployments; the study is run through CUA, and Almma has no access to anything sites provide.

- **Disclosure.** The role is on file with CUA under its conflict-of-interest policy, and an updated disclosure covering this study has been filed. It is also stated in the design paper and will be stated in every publication from the study.
- **No access for Almma.** No one at Almma.AI other than the investigator will see the participant list, the site key or any site's file, at any time.
- **No commercial use.** Participation, the participant list and site results will not be used for sales, marketing or product development, and no site will be approached commercially because it took part.
- **Open instrument.** The script and codebook are public under the MIT license, so any site can check exactly what it measures, and no one gains a commercial advantage from its use.
- **Almma's own deployment.** Almma.AI's deployment takes part as one numbered site under the same rules as every other site. Publications will state that one site is operated by the investigator's company, without saying which. A version 1.0 pilot of that deployment, posted in this repository in September 2026, is superseded, has been removed, and will not be reported.

## Scope, timeline and publication

Data collection runs through December 15, 2026, with first results in a revised working paper by December 31, 2026; sites that join later are added in updated versions.

- **Sites.** Universities and other organizations running their own LibreChat deployment, in the United States and Europe. The names of invited and participating sites are not shared with other sites.
- **Minimum for reporting.** Per-site results are published only once at least three sites have submitted, so that no single site stands out.

Timeline:

1. October to December 15, 2026: sites review, run the check and submit.
2. By December 31, 2026: revised version of the SSRN paper with results from the sites received.
3. 2027: later submissions added in updated versions as they arrive.
4. 2027: submission of the full study to a peer-reviewed journal.

Every publication uses site numbers only, follows the review step above, and is accompanied by the exact version of the script used.
