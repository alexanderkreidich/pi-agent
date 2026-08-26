# /review-diff

Open a terminal-native unified diff viewer with a file sidebar, choose which changed files are included in review context, then ask the agent to review it.

Review focus:

- Correctness bugs and regressions.
- Risky edge cases.
- Missing or weak tests.
- Security and data-loss issues.
- Concrete fixes, not broad style commentary.

This command is equivalent to `/diff --ask` for the same source. The diff viewer itself is not added to chat unless `--no-overlay` is used.

In the overlay, no files are selected for review context by default. Click a file in the sidebar or press Space to include/exclude it; use `a` to select all, `x` to clear, and `r` to continue review after selecting at least one file. After at least one file is selected, closing with `q`/Esc asks: “Do you want to change anything?” Enter instructions to ask the agent to make changes, leave it empty to continue with review, or cancel the editor to stop.
