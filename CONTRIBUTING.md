# Contributing results

A single deployment is a case study. Several deployments, measured the same
way, are a finding.

## Run the check

```bash
export DEPLOYMENT_LABEL="anon-1"        # or your org name, your choice
export DEPLOYMENT_KIND="enterprise"     # enterprise | team | hobby | public
export LIBRECHAT_VERSION="v0.8.8"       # or your fork's version

mongosh "mongodb://localhost:27017/LibreChat" --quiet \
  --file scripts/agent_governance_check.js > results/anon-1.json
```

Read the script first. It is under 250 lines, read-only, and every query is
visible. Run it off-peak if the deployment is busy: it walks the agents
collection three times.

## Check the output before you submit

The script is written to emit counts only, but verify for yourself:

```bash
grep -iE '@|http|mongodb://' results/anon-1.json
```

Should return nothing. If your fork stores something unexpected in a field the
script reads, tell us in the PR rather than editing the file by hand — the
script should be fixed for everyone.

## Submit

Open a PR adding one file to `results/`. Nothing else. In the PR description,
note anything unusual about your deployment: restricted agent creation, an
SSO-gated user base, a custom sharing model, whether agent creation is
self-serve or provisioned.

Anonymous is fine. `anon-N` as a label, and no identifying detail in the PR.

## What happens to submissions

Aggregates in `results/` are public under this repository's MIT license.
Analysis across submissions will be published with attribution to contributing
deployments by label only, never by organisation, unless a contributor asks to
be named.

If a cross-deployment analysis becomes a paper, contributors who submit
results and help interpret them will be offered co-authorship. Contributors
who submit results alone will be acknowledged. Anyone can decline both.

## Improving the check

Pull requests to the script and codebook are welcome, especially:

- non-English patterns for escalation, prohibition and scope
- support for fork-specific collections not handled here
- a hand-labelling protocol to calibrate the textual checks

Changes to check definitions bump the schema version and are recorded in
CODEBOOK.md, because results computed under different definitions are not
comparable.
