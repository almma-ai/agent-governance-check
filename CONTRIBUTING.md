# Contributing results

A single deployment is a case study. Several deployments, measured the same
way, are a finding.

## Run the check

```bash
export DEPLOYMENT_LABEL=""              # leave blank for the multi-site study
export DEPLOYMENT_KIND="enterprise"     # enterprise | team | hobby | public
export LIBRECHAT_VERSION="v0.8.8"       # or your fork's version

mongosh "mongodb://localhost:27017/LibreChat" --quiet \
  --file scripts/agent_governance_check.js > submission.json
```

Read the script first. It is about 330 lines, read-only, and every query is
visible. Leave small-count suppression on (the default) for anything you
submit; the output records it as `"small_counts_suppressed": true`. Run it off-peak if the deployment is busy: it walks the agents
collection three times.

## Check the output before you submit

The script is written to emit counts only, but verify for yourself:

```bash
grep -iE '@|http|mongodb://' submission.json
```

Should return nothing. Then review the two fields a site may change before
sending: `snapshot_utc` (delete it or round it to the month if you do not share
exact dates) and the tool names in `capability_surface.tools_histogram`
(replace any custom name that would identify you). If your fork stores
something unexpected in a field the script reads, tell us rather than editing
the file by hand: the script should be fixed for everyone.

## Submit

Email `submission.json` to walll@cua.edu. Nothing is posted here by default.
In the email, note anything unusual about your deployment: restricted agent
creation, an SSO-gated user base, a custom sharing model, whether agent
creation is self-serve or provisioned.

## What happens to submissions

Submissions are handled as set out in [PROTOCOL.md](PROTOCOL.md):

- files are stored only in the investigator's CUA account;
- each site is published under a site number, and the key is never published;
- a site is named in the list of participants, or has its file posted in
  `results/`, only with its written consent;
- each site reviews any wording about it before publication.

To post your file publicly in `results/`, say so in writing, or open a PR
adding it yourself.

If a cross-deployment analysis becomes a paper, contributors who submit
results and help interpret them will be offered co-authorship. Contributors
who submit results alone will be acknowledged if they wish. Anyone can decline
both, and the default is neither.

## Improving the check

Pull requests to the script and codebook are welcome, especially:

- non-English patterns for escalation, prohibition and scope
- support for fork-specific collections not handled here
- a hand-labelling protocol to calibrate the textual checks

Changes to check definitions bump the schema version and are recorded in
CODEBOOK.md, because results computed under different definitions are not
comparable.
