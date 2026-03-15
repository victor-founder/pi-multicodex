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
  - footer rendering with severity-based color tiers, footer settings persistence, settings panel with live preview, and footer refresh behavior
- `commands.ts`
  - `/multicodex` command-family routing, dynamic autocomplete, account selection/removal flows
- `hooks.ts`
  - session-start and session-switch refresh behavior
- `storage.ts`
  - persisted account state in `~/.pi/agent/codex-accounts.json`
- `selection.ts`
  - account selection logic (untouched preference, earliest weekly reset, random fallback)
- `usage.ts` / `usage-client.ts`
  - usage data parsing and Codex API fetching
- `quota.ts`
  - quota/rate-limit error classification
- `browser.ts`
  - login URL opening in browser
- `abort-utils.ts`
  - linked abort controller for stream cancellation

## Current product behavior

- MultiCodex owns the normal `openai-codex` provider path directly.
- pi's stored `openai-codex` auth is auto-imported when new or changed.
- Current shipped command family is:
  - `/multicodex`
  - `/multicodex show`
  - `/multicodex use [identifier]`
  - `/multicodex footer`
  - `/multicodex rotation`
  - `/multicodex verify`
  - `/multicodex path`
  - `/multicodex reset [manual|quota|all]`
  - `/multicodex help`
- Footer settings are persisted in `~/.pi/agent/settings.json` under `pi-multicodex`.
- Rotation criteria are still hard-coded.

## Active roadmap priorities

When continuing work, prioritize these items before expanding scope:

1. Persist footer settings immediately instead of waiting until panel close.
2. Add rotation settings and document the rotation behavior contract.
3. Broaden the current footer controller into a shared MultiCodex controller.
4. Replace imported-account fallback labels with real email identity when it can be derived safely.
5. Keep command-family UX cohesive and avoid adding parallel top-level commands.

## Command family policy

- Keep `/multicodex` as the only operator command surface.
- Do not reintroduce `/multicodex-use`, `/multicodex-status`, or `/multicodex-footer` aliases.
- When command UX changes, update README, ROADMAP, tests, and release notes together.

## Goals

- Keep the extension runnable when installed outside the pi monorepo.
- Avoid deep imports that resolve to repo-local paths.
- Keep runtime behavior compatible with pi extension docs.
- Keep the published package self-contained, including all runtime TypeScript modules it imports.
- Prefer one memorable operator command surface over several loosely related commands.
- Prefer controller-owned config and runtime state over duplicated persistence logic.

## Packaging rules

- Core pi packages must stay aligned with pi package docs.
- Keep `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui` in `peerDependencies` and `devDependencies` as needed for local development.
- Do not move pi core packages into normal runtime `dependencies` unless pi package docs require it.
- Keep the published tarball limited to runtime files only.

## Type safety and architecture

- Use public exports from `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent`.
- Prefer small focused modules with explicit exports over large shared files.
- Keep durable config, runtime status, and UI wiring separate.
- Normalize config on load and save.
- Let shared controller code own persistence instead of duplicating file writes in commands or panels.
- Keep hooks and command handlers thin when controller extraction work starts.

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

- Use `semantic-release` with npm trusted publishing.
- Normal releases happen from merges to `main` through `.github/workflows/publish.yml`.
- Enforce Conventional Commits with commitlint locally and in CI.
- Use `lefthook` for the local `commit-msg` hook.
- Use `pnpm release:dry` for local release verification when needed.
- Do not use local `npm publish` for routine releases.
- Keep the npm trusted publisher mapping aligned with:
  - package: `@victor-software-house/pi-multicodex`
  - repository: `victor-software-house/pi-multicodex`
  - workflow file: `.github/workflows/publish.yml`

## Commit workflow

- Do not batch unrelated changes into a single large commit.
- Commit incrementally as each logical step is completed.
- Use conventional commit messages such as `build: ...`, `docs: ...`, `refactor: ...`, `feat: ...`, and `release: ...`.
- Keep release commits focused on version bumps and release metadata only.
