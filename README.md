# @victor-software-house/pi-multicodex

![MultiCodex](./assets/multicodex.png)

`@victor-software-house/pi-multicodex` is a pi extension that rotates multiple ChatGPT Codex OAuth accounts for the `openai-codex-responses` API.

## What it does

- overrides the normal `openai-codex` path instead of requiring a separate provider to be selected
- auto-imports pi's stored `openai-codex` auth when it is new or changed
- rotates accounts on quota and rate-limit failures
- prefers untouched accounts when usage data is available
- otherwise prefers the account whose weekly window resets first
- keeps the implementation focused on Codex account rotation

## Install

```bash
pi install npm:@victor-software-house/pi-multicodex
```

Restart `pi` after installation.

## Local development

This repo uses `mise` to pin tools and `pnpm` for dependency management.

```bash
mise install
pnpm install
pnpm check
```

Equivalent mise tasks:

```bash
mise run install
mise run check
mise run pack-dry
```

Run the extension directly during local development:

```bash
pi -e ./index.ts
```

## Commands

- `/multicodex-use [identifier]`
  - Use an existing managed account, or start the Codex login flow when the account is missing or the stored auth is no longer valid.
  - With no argument, opens an account picker.
- `/multicodex-login <identifier>`
  - Compatibility alias for `/multicodex-use <identifier>`.
- `/multicodex-status`
  - Show managed account state and cached usage information.
- `/multicodex-footer`
  - Open an interactive panel to configure footer fields and ordering.

## Project direction

This project is maintained as its own package and release line.

Current direction:

- package name: `@victor-software-house/pi-multicodex`
- Codex-only scope
- local state stored at `~/.pi/agent/codex-accounts.json`
- internal logic split into focused modules
- current roadmap tracked in `ROADMAP.md`

Current next step:

- make MultiCodex own the normal `openai-codex` path directly
- auto-import pi's existing `openai-codex` auth when it is new or changed
- mirror the existing codex usage footer style, including support for displaying both reset countdowns
- show the active account identifier beside the 5h and 7d usage metrics
- keep footer configuration in an interactive panel
- tighten footer updates so account switches and quota rotation are reflected immediately

## Release validation

Minimum release checks:

```bash
pnpm check
npm pack --dry-run
```

Release flow:

1. Prepare the release locally.
2. Commit the version bump.
3. Create and push a matching `v*` tag.
4. Let GitHub Actions publish through trusted publishing.

Prepare locally:

```bash
npm run release:prepare -- <version>
```

The helper updates `package.json` with `bun pm pkg set` and then runs the release checks.

Example:

```bash
git add package.json
git commit -m "release: v<version>"
git tag v<version>
git push origin main --tags
```

Do not use local `npm publish` for normal releases in this repo.

## Acknowledgment

This project descends from earlier MultiCodex work. Thanks to the original creator for the starting point that made this package possible.

The active-account usage footer work also draws on ideas from `calesennett/pi-codex-usage`. Thanks to its author for the reference implementation and footer design.
