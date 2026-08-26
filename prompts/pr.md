---
description: Review PRs from URLs with zero-context explanation and verified code analysis
argument-hint: "<PR-URL>"
---
You are given one or more GitHub PR URLs: $@

For each PR URL, review it as if the reader has zero prior context about the repository, feature, or bug. Explain unfamiliar terms and make the behavior before and after the PR concrete. Scale the detail to the complexity of the PR: keep simple reviews concise, but explain complex data flows and failure modes fully.

Perform this review directly. Do not start or delegate to any Fable review or advisory subagent, including `fable-advisor` and `fable-independent-review`.

Follow these steps in order:
1. Read the repository instructions that apply to the changed paths (for example `AGENTS.md`, `CONTRIBUTING.md`, or equivalent files).
2. Before analysis starts, check whether the repository has an `inprogress` label. If it exists, add it to the PR via GitHub CLI. If adding an existing label fails, report that explicitly and continue. If the label does not exist, continue without treating that as an error.
3. Read the PR page in full, including its description, all comments and reviews, all commits, changed files, and current CI/check status.
4. Identify issues referenced by the PR body, comments, reviews, commit messages, or cross-links. Read each relevant linked issue in full, including all comments.
5. Analyze the complete PR diff against the PR's current base branch. Read all relevant files from the base branch in full with no truncation and compare them with the diff. Do not fetch PR file blobs unless a file is missing on the base branch or the diff context is insufficient. Include related code paths outside the diff when they are required to validate behavior.
6. Build a zero-context explanation before judging the implementation:
   - what user or system problem the PR addresses;
   - how the relevant flow worked before the PR;
   - why the old behavior failed or was insufficient;
   - what the PR changes;
   - what users or dependent systems should observe afterward.
   Use a small concrete example when it makes the behavior easier to understand.
7. Verify external contracts whenever the implementation depends on a third-party runtime, API, wire protocol, framework, database, browser behavior, or deployment platform:
   - check current official documentation first;
   - when documentation is insufficient, inspect the upstream source repository, using the librarian cache when appropriate;
   - determine the version or protocol actually used by this repository from lockfiles, templates, runtime manifests, configuration, negotiation/handshake code, or observed metadata;
   - compare test fixtures and assumptions with the real external contract;
   - distinguish confirmed facts from compatibility assumptions.
   Do not turn an unverified assumption into a finding. If verification disproves an earlier concern, withdraw it explicitly.
8. Evaluate tests and validation at the behavior boundary, not only at the helper-function level. For streaming, UI, runtime, integration, deployment, or compatibility changes, decide whether staging E2E or visual browser verification is warranted. When it is warranted but was not run, state exactly what should be verified; do not claim it passed.
9. Check changelog and documentation impact only when there is a concrete reason, such as:
   - repository instructions require it;
   - a relevant changelog or documentation set exists for the changed area;
   - the PR adds or changes public, user-facing, API, CLI, configuration, deployment, or compatibility behavior;
   - existing documentation would become stale or inaccurate.
   Follow the repository's own format and contribution rules. Do not invent a changelog or documentation requirement when the repository provides no such convention. State that an update is required before merge only when repository policy or the actual change justifies it.
10. Assign a calibrated verdict:
   - `LGTM` when the implementation and validation are sufficient;
   - `LGTM with follow-ups` when the core change is correct but additional tests, staging verification, or non-blocking cleanup should still happen;
   - `NEEDS CHANGES` only for a concrete defect, regression, security/data risk, unmet acceptance criterion, or missing validation that makes the claimed behavior unreliable.
   Separate the correctness of the core fix from follow-up validation. Do not block a PR solely because of an adjacent pre-existing issue that the PR did not introduce and does not claim to solve; identify it as pre-existing and recommend a separate issue when relevant.
11. Present findings under `Good`, `Bad`, and `Ugly`:
   - `Good`: solid choices, correct behavior, useful tests, and improvements;
   - `Bad`: concrete regressions, missing coverage, maintainability risks, or required work;
   - `Ugly`: subtle, systemic, high-impact, or difficult-to-detect failure modes.
   Tie every blocking finding to the changed code, stated scope, repository policy, or acceptance criteria. If no issues are found, say so explicitly.
12. Add `Required before merge` and distinguish mandatory actions from optional follow-ups. For staging requests, name the scenarios and observable outcomes to verify.
13. Add `Questions or Assumptions` only for points that remain unclear after reasonable repository and upstream verification.
14. Add `Change summary` and `Tests`. Under `Tests`, clearly separate:
   - checks run by the reviewer;
   - checks reported by the PR author;
   - checks observed in CI;
   - checks not run and the reason;
   - staging/E2E status when relevant.

Output format per PR:

PR: <url>
Verdict:
- LGTM | LGTM with follow-ups | NEEDS CHANGES

Context:
- Problem: ...
- Before: ...
- After: ...

What changes:
- ...

Good:
- ...

Bad:
- ...

Ugly:
- ...

Required before merge:
- ...

Questions or Assumptions:
- ...

Change summary:
- ...

Tests:
- Reviewer-run: ...
- PR author-reported: ...
- CI-observed: ...
- Not run / staging status: ...

When changelog or documentation findings are relevant, add this optional section after `What changes`:

Changelog and documentation:
- ...

Writing and GitHub rules:
- Write the conversational review in the user's language unless they request another language.
- Write any GitHub review body, issue, PR text, or review comment in English.
- Do not post a GitHub review or comment unless the user explicitly asks you to do so.
- Prefer plain language and concrete examples over unexplained repository jargon.
- Preserve nuance: a correct core fix can be `LGTM overall` while still requiring realistic contract tests or staging verification before merge.
