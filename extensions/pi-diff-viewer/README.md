# Pi Diff Viewer Extension

Registers `/diff` in Pi and opens a full-screen terminal-native unified diff overlay with a file sidebar, without adding the diff to chat.

This is the extension integration layer from the design spec. The full `@pierre/diffs` web viewer still belongs in Pi's frontend/runtime; this extension provides the slash-command entrypoint, an interactive TUI overlay that shows the current branch, hides raw git metadata, renders GitHub-style unified file cards with full-file context, and lets `/review-diff` choose which changed files are sent to the agent, plus an inline fallback for non-interactive mode or `--no-overlay`.

## Commands

```text
/diff                         Show current working-tree git diff
/diff --staged                Show staged git diff
/diff <path>                  Show git diff for a path, or render a patch file
/diff <path> <path...>        Show git diff for multiple paths
/diff git <git-diff-args...>  Pass arguments directly to git diff
/diff --max-lines=200         Cap stored/rendered diff lines for the session message
/diff --no-overlay            Keep the diff inline instead of opening the overlay viewer
/diff --ask [source]          Render the diff, select review files, then ask the agent
/review-diff [source]         Shortcut for /diff --ask [source]
```

Examples:

```text
/diff
/diff --staged src/index.ts
/diff changes.patch
/diff git HEAD~1..HEAD -- src
/review-diff --staged
```

## Install

From this repository:

```bash
./.pi-extension/pi-diff-viewer/install.sh
```

Then run `/reload` inside Pi or restart Pi.

Uninstall:

```bash
./.pi-extension/pi-diff-viewer/install.sh --uninstall
```

## Notes

- Git diffs use full-file context by default so changed files are shown whole instead of as tiny hunks; `/diff git ...` keeps your raw git arguments.
- Diff output is still capped before storing in fallback session messages to avoid bloating context/session files.
- In interactive Pi, `/diff` opens the overlay only; it does not add the diff to chat/session history unless `--no-overlay` is used or no UI is available.
- The full-screen overlay supports mouse-wheel scrolling, `q`/Esc to close, `j`/`k` or arrows to scroll, Cmd+Down/Cmd+Up to jump to the next/previous changed line in the current file, `n`/`p` to jump files, Tab to focus the file list, and `f` to hide/show the file list.
- In `/review-diff` or `/diff --ask`, no files are selected for agent context by default. Click a sidebar file or press Space to toggle it, `a` selects all, `x` clears selection, and `r` continues review after at least one file is selected. After at least one file is selected, closing with `q`/Esc opens a prompt where text becomes change instructions and an empty response continues the review.
- `/diff git ...` passes arguments to `git diff` as an argv array; no shell interpolation is used.
- `/review-diff` sends a capped selected-file patch to the agent for review after rendering it.
