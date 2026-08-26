# Contributing

## Before opening a change

- Search existing issues and pull requests.
- Keep changes portable and unrelated to any private environment or project.
- Never commit credentials, authentication state, local paths, session data, or internal service details.
- Open an issue first for broad behavioral or compatibility changes.

## Development

Use Node.js 22 or newer.

```bash
npm ci
npm run validate
```

## Pull requests

- Create a focused branch from `main`.
- Explain the user-visible effect and any compatibility implications.
- Add or update tests for behavioral changes.
- Record the exact validation commands and results.
- Keep the pull request in draft until validation passes.

By contributing, you agree that your contribution is licensed under the MIT License.
