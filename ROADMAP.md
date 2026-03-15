# @victor-software-house/pi-multicodex roadmap

## Product focus

`@victor-software-house/pi-multicodex` is a pi extension focused on rotating multiple ChatGPT Codex OAuth accounts for the `openai-codex-responses` API.

The roadmap is centered on:

- stable account management
- clear release and install paths
- maintainable internal structure
- better usage visibility for the active account
- a cleaner user experience inside pi

## Operating principles

- Keep npmjs as the canonical public distribution channel.
- Keep the package npm-installable for pi users.
- Use pnpm for local development.
- Keep releases small, validated, and repeatable.
- Prefer explicit behavior over hidden heuristics.
- Avoid custom encryption schemes for local secrets.
- If secret storage needs stronger protection later, prefer platform-backed secure storage over homegrown crypto.

## Decisions already locked in

- **Package name:** `@victor-software-house/pi-multicodex`
- **Commands:** converge on `/multicodex-use [identifier]` as the primary account command
  - `/multicodex-login` remains a compatibility alias
  - `/multicodex-status`
  - `/multicodex-footer`
- **Scope:** Codex only
- **Local package manager:** pnpm
- **Primary release path:** npmjs with trusted publishing
- **Current storage filename:** `codex-accounts.json`
- **Local state path:** `~/.pi/agent/codex-accounts.json`

## Release discipline

Every release should continue to pass at least:

```bash
pnpm check
npm pack --dry-run
```

Target release flow:

1. Prepare the release locally with `npm run release:prepare -- <version>`.
2. Commit the prepared version bump.
3. Create and push a matching `v*` tag.
4. Let GitHub Actions publish through trusted publishing.

## Completed foundation work

### Storage identity

Completed:

- [x] Use `~/.pi/agent/codex-accounts.json`
- [x] Keep the on-disk format as JSON for now
- [x] Document the storage path in the repo docs
- [x] Avoid adding custom encryption

### Internal modularization

Completed:

- [x] Thin `index.ts` into a public export surface
- [x] Split account management into focused modules
- [x] Split provider, stream wrapper, command, hook, storage, usage, and browser helpers
- [x] Keep behavior stable during refactoring

### Baseline test coverage

Completed:

- [x] Cover usage parsing and reset helpers
- [x] Cover account selection behavior
- [x] Cover manual-account stream-wrapper behavior
- [x] Cover extension wiring and hook routing
- [x] Run all tests through Vitest with `*.test.ts`

## Next milestone — active-account usage visibility

Goal: surface usage information for the currently active account directly in pi.

Planned work:

- [ ] Integrate the ideas or code path from `calesennett/pi-codex-usage`
- [ ] Override the normal `openai-codex` path instead of requiring a separate provider to be selected manually
- [ ] Auto-import pi's stored `openai-codex` auth when it is new or changed
- [ ] Ensure the usage shown belongs to the currently selected active account
- [ ] Display the logged-in account identifier beside the usage metrics
- [ ] Add an interactive configuration panel for footer fields, reset countdown selection, and ordering
- [ ] Reuse or adapt a refresh model that stays responsive without excessive polling

Implementation next steps:

1. Override `openai-codex` with the MultiCodex-managed stream wrapper.
2. Import pi's stored `openai-codex` auth into managed account storage when it changes.
3. Treat `/multicodex-use [identifier]` as the primary select-or-login entrypoint.
4. Keep `/multicodex-login` only as a compatibility alias.
5. Render the footer for normal Codex usage and show the active managed account beside 5h and 7d usage.
6. Add an interactive footer settings panel for account visibility, 5h/7d/both reset countdown selection, usage mode, and field ordering.
7. Refresh on session start, session switch, model change, turn end, manual account change, and low-frequency timer ticks.
8. Add tests for auth import, provider override behavior, status formatting, cached-usage fallback, and extension event wiring.

## Follow-up milestone — behavior contract

Goal: make account rotation behavior explicit and documented.

- [ ] Define account selection priority
- [ ] Define quota exhaustion semantics
- [ ] Define which reset windows matter for selection
- [ ] Define retry policy
- [ ] Define manual override behavior
- [ ] Define when manual override clears
- [ ] Define cache TTL and refresh rules
- [ ] Define error classification rules
- [ ] Document the behavior contract in README or a dedicated doc

## Follow-up milestone — UX improvements

Goal: improve everyday usability for multi-account management.

- [ ] Review whether commands should stay unchanged or gain a top-level management command
- [ ] Improve account picker and status dialogs
- [ ] Decide whether `/multicodex-login` remains argument-based or becomes interactive
- [ ] Improve the status output for account state, cooldowns, and manual selection
- [ ] Make active-account information easier to understand during a session

## Final release validation

Before the next real release, explicitly validate the full release path:

- [ ] Run `pnpm check`
- [ ] Run `npm pack --dry-run`
- [ ] Create and push the release tag
- [ ] Verify the GitHub Actions trusted-publishing workflow completes successfully
- [ ] Verify the new version is available on npmjs
- [ ] Verify install or upgrade in pi from the published package
- [ ] Verify the published tarball includes every runtime TypeScript module the extension imports

## Non-goals for now

- [ ] No cross-provider account orchestration
- [ ] No attempt to become a generic auth manager for pi
- [ ] No custom encryption implementation for local secrets
- [ ] No Bun-first consumer install story
