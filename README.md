# @victor/pi-multicodex

![MultiCodex](./assets/multicodex.png)

`@victor/pi-multicodex` is a pi extension for rotating multiple ChatGPT Codex OAuth accounts when using the `openai-codex-responses` API.

Current behavior:

- rotates on quota and rate-limit failures
- prefers untouched accounts when usage data is available
- otherwise prefers the account whose weekly window resets first
- stays focused on Codex only

## Install

```bash
pi install npm:@victor/pi-multicodex
```

Restart `pi` after installation.

## Local development

This repo uses `pnpm` for local development.

```bash
pnpm install
pnpm lint
pnpm tsgo
pnpm test
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

## Status

This package is being turned into an independent fork with deliberate breaking changes.

Current direction:

- package name: `@victor/pi-multicodex`
- hard break from previous storage compatibility
- Codex-only scope
- independent implementation roadmap tracked in `fork-plan.md`

## Release validation

Local development uses pnpm, but published package output must remain npm-compatible.

Minimum release checks:

```bash
pnpm lint
pnpm tsgo
pnpm test
npm pack --dry-run
```
