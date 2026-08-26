# pi-agent

A reusable, public [Pi coding agent](https://github.com/earendil-works/pi) configuration package.

## Contents

- Generic global agent instructions and subagent definitions
- Prompt templates, a reusable skill, extensions, and themes
- Portable Pi settings defaults
- Public Pi-package and skill dependency declarations
- Idempotent bootstrap and update scripts

## Install

Review the package before installing it: Pi packages run with full system access.

```bash
pi install git:github.com/alexanderkreidich/pi-agent
```

Run bootstrap from Pi's managed checkout:

```bash
PACKAGE_ROOT="$HOME/.pi/agent/git/github.com/alexanderkreidich/pi-agent"
node "$PACKAGE_ROOT/scripts/bootstrap.mjs" --install-external-skills
```

Bootstrap changes only allowlisted resources. Existing affected files are moved to a timestamped directory under Pi's local `backups/` directory. Unrelated local resources are preserved.

Restart Pi or run `/reload` after bootstrap.

## Update

```bash
PACKAGE_ROOT="$HOME/.pi/agent/git/github.com/alexanderkreidich/pi-agent"
node "$PACKAGE_ROOT/scripts/update.mjs"
```

This updates installed Pi packages and reapplies the idempotent bootstrap links and settings merge.

## Repository boundary

The repository excludes credentials, authentication state, sessions, logs, caches, machine-specific paths, and project-specific material.

`config/settings.template.json` contains portable preferences and public package declarations. Bootstrap merges it into the local settings file; the local file itself is never copied into this repository.

`config/external-skills.json` contains public repository names and selected skill names. Installation timestamps, hashes, tool selections, and local paths are excluded.

## Development

Use a normal checkout for edits. Pi resets its managed package checkout during package updates, so do not edit that checkout directly.

```bash
npm ci
npm run validate
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

The package keeps `"private": true` to prevent accidental npm publication. It is distributed as a public Pi Git package.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for upstream attribution.
