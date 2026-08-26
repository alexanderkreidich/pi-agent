# /diff

Open a terminal-native unified diff viewer with a file sidebar in Pi.

Supported sources:

- No arguments: current working-tree git diff.
- `--staged` / `--cached`: staged git diff.
- One or more paths: `git diff -- <paths>`.
- Patch file path: if the file contains a unified patch, render the patch file directly.
- `git <args...>`: pass arguments directly to `git diff`.

In interactive Pi, the command opens a full-screen read-only overlay viewer and does not add the diff to chat. For git sources it shows the current branch and requests full-file context, so changed files are shown whole instead of as tiny hunks. The overlay hides raw git metadata and renders GitHub-style unified file cards with the file sidebar kept visible. Use the mouse wheel or `j`/`k` to scroll; use Cmd+Down/Cmd+Up to jump to the next/previous changed line in the current file. Use `--no-overlay` to keep only the inline message.

With `--ask` or `/review-diff`, the sidebar becomes review-context selection: no files are selected by default, clicking a file toggles whether it is sent to the agent, Space toggles the current file, `a` selects all, `x` clears, and `r` continues review after at least one file is selected. After at least one file is selected, closing with `q`/Esc asks whether you want to tell the agent what to change or continue review.
