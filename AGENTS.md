# MultiCodex Extension - Agent Notes

## Scope

Only edit files in this repository.

## Current architecture

The current codebase is organized around these responsibilities:

- `provider.ts`
  - overrides the normal `openai-codex` provider path
  - mirrors Codex models and installs the managed stream wrapper
- `stream-wrapper.ts`
  - account selection, retry, and quota-rotation path during streaming
- `account-manager.ts`
  - managed account storage, token refresh, usage cache, activation logic, auth import sync
- `auth.ts`
  - reads pi's `~/.pi/agent/auth.json` and extracts importable `openai-codex` OAuth state
- `status.ts`
  - footer rendering, footer settings persistence, footer settings panel
- `commands.ts`
  - `/multicodex-use [identifier]`
  - `/multicodex-status`
  - `/multicodex-footer`
- `storage.ts`
  - persisted account state in `~/.pi/agent/codex-accounts.json`

## Current product behavior

- MultiCodex owns the normal `openai-codex` provider path directly.
- pi's stored `openai-codex` auth is auto-imported when new or changed.
- `/multicodex-use [identifier]` is the only account entrypoint.
  - with identifier: use account or login if missing/stale
  - without identifier: account picker
- Footer settings are persisted in `~/.pi/agent/settings.json` under `pi-multicodex`.

## Known unfinished areas

These are the main open issues at the time of writing:

1. `model_select` footer refresh is too expensive during rapid `Ctrl+P` model cycling.
2. Footer layout still groups reset countdowns at the end instead of next to their matching periods.
3. Footer color styling needs refinement.
4. `/multicodex-footer` needs live preview while settings change.
5. Footer updates need tighter synchronization with manual account changes and quota rotation.

When continuing in a new session, start there before expanding scope.

## Goals

- Keep the extension runnable when installed outside the pi monorepo.
- Avoid deep imports that resolve to repo-local paths.
- Keep runtime behavior compatible with pi extension docs.
- Keep the published package self-contained, including all runtime TypeScript modules it imports.

## Packaging rules

- Core pi packages must stay aligned with pi package docs.
- Keep `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui` in `peerDependencies` and `devDependencies` as needed for local development.
- Do not move pi core packages into normal runtime `dependencies` unless pi package docs require it.
- Keep the published tarball limited to runtime files only.

## Type Safety

- Use public exports from `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent`.
- Prefer small focused modules with explicit exports over large shared files.

## Checks

Run:

```bash
npm run lint
npm run tsgo
npm run test
```

Release validation:

```bash
npm pack --dry-run
```

## Hook workflow

- Use `lefthook` for git hooks.
- `mise run install` should install dependencies and run `lefthook install`.
- Pre-push validation runs through `mise run pre-push`.
- Keep pre-push checks aligned with CI:
  - `pnpm check`
  - `npm pack --dry-run`

## Release workflow

- Prepare releases locally with `npm run release:prepare -- <version>`.
- The release helper should prefer Bun package-manager commands for version updates.
- Normal releases are tag-driven through GitHub Actions trusted publishing.
- Do not use local `npm publish` for routine releases.
- Before pushing a release tag, make sure the working tree is clean and the local validations pass.

## Commit Workflow

- Do not batch unrelated changes into a single large commit.
- Commit incrementally as each logical step is completed.
- Use conventional commit messages such as `build: ...`, `docs: ...`, `refactor: ...`, `feat: ...`, and `release: ...`.
- Keep release commits focused on version bumps and release metadata only.
