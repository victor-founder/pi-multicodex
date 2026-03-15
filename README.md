# @victor-software-house/pi-multicodex

![MultiCodex](./assets/multicodex.png)

`@victor-software-house/pi-multicodex` is a pi extension that rotates multiple ChatGPT Codex OAuth accounts for the `openai-codex-responses` API.

## What it does

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

- `/multicodex-login <email>`
  - Add or update a Codex account in the rotation pool.
- `/multicodex-use`
  - Select an account manually for the current session.
- `/multicodex-status`
  - Show account state and cached usage information.

## Project direction

This project is maintained as its own package and release line.

Current direction:

- package name: `@victor-software-house/pi-multicodex`
- Codex-only scope
- local state stored at `~/.pi/agent/pi-multicodex.json`
- independent storage and release policy
- current roadmap tracked in `ROADMAP.md`

## Release validation

Minimum release checks:

```bash
pnpm check
npm pack --dry-run
```

Release flow:

1. Update `package.json` version.
2. Run release checks.
3. Commit the release.
4. Create and push a matching `v*` tag.
5. Let GitHub Actions publish through trusted publishing.

Example:

```bash
git tag v<version>
git push origin main --tags
```

## Acknowledgment

This project descends from earlier MultiCodex work. Thanks to the original creator for the starting point that made this package possible.
