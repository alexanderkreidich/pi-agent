# Global Agent Settings

Behavioral guidelines to reduce common LLM coding mistakes. Merge with
project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks,
use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong — fix the code.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes,
simplify.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it; don't delete it.

When your changes create orphans:
- Remove imports, variables, and functions that your changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass."
- "Fix the bug" -> "Write a test that reproduces it, then make it pass."
- "Refactor X" -> "Ensure tests pass before and after."

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria like "make it
work" require constant clarification.

These guidelines are working if there are fewer unnecessary changes in diffs,
fewer rewrites due to overcomplication, and clarifying questions come before
implementation rather than after mistakes.

## 5. Independent Issue/PR Review

Independent review applies only when the human uses the global `/is` or `/pr`
prompt to implement or fix a specific issue or pull request. Do not invoke it
for ad-hoc tasks, local configuration changes, ordinary file edits, planning,
exploration, or other work outside an active `/is` or `/pr` workflow.

The implementing model owns the implementation. Never delegate implementation or
review to `codex-worker`.

Run the independent review once, at the end of the issue or PR implementation:
- after the requested implementation or fix is complete and validated;
- before telling the human it is finished or creating the pull request.

Do not invoke independent review after every commit or small follow-up change. If
the same issue or fix already received a `PASS`, do not run another review only
because additional commits were added or a PR is now being created.

- Use the `gpt-sol-independent-review` agent (`openai-codex/gpt-5.6-sol`).
- Give the reviewer the issue or requirements, acceptance criteria, relevant
  diff or PR reference, implementation summary, and validation already run.
- The reviewer must independently inspect the work and use the global `/pr`
  prompt as its review rubric. Resolve the Pi agent directory from
  `PI_CODING_AGENT_DIR` when set, otherwise use `$HOME/.pi/agent`, then read
  `prompts/pr.md`.
- Review agents may edit validation tests or temporary validation
  instrumentation only. They must not fix implementation code or mutate
  GitHub state.
- A `NEEDS CHANGES` verdict is the exception to the one-review rule: fix the
  findings and run the same reviewer again. Do not claim completion until it
  returns `PASS`; if review is blocked, report the blocker instead.
- When the reviewer returns `PASS`, proceed without asking the human to approve
  its Minor findings. Minor findings are advisory and do not create an approval
  gate.
- In the completion message for the `/is` or `/pr` workflow, name the reviewer
  model and state its verdict.

## 6. GitHub Language

Write GitHub issues, pull request titles, pull request descriptions, review
comments, and release/change notes in English, even when the user communicates
in another language.
