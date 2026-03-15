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
- **Command prefix:** keep current commands for now
  - `/multicodex-login`
  - `/multicodex-use`
  - `/multicodex-status`
- **Scope:** Codex only
- **Local package manager:** pnpm
- **Primary release path:** npmjs with trusted publishing
- **Current storage filename target:** `pi-multicodex.json`

## Release discipline

Every release should continue to pass at least:

```bash
pnpm check
npm pack --dry-run
```

Target release flow:

1. Update `package.json` version.
2. Run release validation.
3. Commit the release.
4. Create and push a matching `v*` tag.
5. Let GitHub Actions publish through trusted publishing.

## Milestone 1 — storage identity

Goal: give the package a stable, self-owned local data file and tighten the storage model.

- [x] Replace `~/.pi/agent/multicodex.json` with `~/.pi/agent/pi-multicodex.json`
- [ ] Keep the on-disk format as JSON unless there is a clear reason to split state and secrets
- [ ] Review exactly which fields belong in the local state file
- [ ] Decide whether secret material should remain in JSON state or move to a safer storage mechanism later
- [ ] Document the storage path and storage expectations

Notes:

- JSON is acceptable for local state because it is simple, debuggable, and already consistent with pi's surrounding file-based configuration model.
- If stronger protection is needed later, use platform-backed secure storage or a well-supported secret-management layer instead of inventing custom encryption.

## Milestone 2 — release-path validation

Goal: verify that the published package and trusted-publishing setup work end to end.

- [ ] Test install in pi from npmjs
- [ ] Verify command availability after install
- [ ] Perform the first fully tag-driven trusted-publishing release
- [ ] Confirm the release path works without manual publish fallbacks
- [ ] Document the final release checklist in concise form

## Milestone 3 — internal modularization

Goal: reduce maintenance cost by splitting the large root implementation into focused modules.

Target structure:

- [ ] `src/index.ts` or a thin root `index.ts`
- [ ] `src/storage.ts`
- [ ] `src/accounts.ts`
- [ ] `src/usage.ts`
- [ ] `src/selection.ts`
- [ ] `src/provider.ts`
- [ ] `src/commands.ts`
- [ ] `src/oauth.ts`
- [ ] `src/errors.ts`

Tests to add or split:

- [ ] `selection.test.ts`
- [ ] `usage.test.ts`
- [ ] `storage.test.ts`
- [ ] `provider.test.ts`

## Milestone 4 — behavior contract

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

## Milestone 5 — active-account usage visibility

Goal: surface usage information for the currently active account directly in pi.

Planned follow-up:

- [ ] Integrate the ideas or code path from `calesennett/pi-codex-usage`
- [ ] Display footer usage only when the active model is authenticated through this extension's provider override
- [ ] Ensure the usage shown belongs to the currently selected active account
- [ ] Display the logged-in account identifier beside the usage metrics
- [ ] Reuse or adapt a refresh model that stays responsive without excessive polling
- [ ] Keep the feature scoped to this extension's managed accounts rather than global Codex auth state

## Milestone 6 — UX improvements

Goal: improve everyday usability for multi-account management.

- [ ] Review whether commands should stay unchanged or gain a top-level management command
- [ ] Improve account picker and status dialogs
- [ ] Decide whether `/multicodex-login` remains argument-based or becomes interactive
- [ ] Improve the status output for account state, cooldowns, and manual selection
- [ ] Make active-account information easier to understand during a session

## Non-goals for now

- [ ] No cross-provider account orchestration
- [ ] No attempt to become a generic auth manager for pi
- [ ] No custom encryption implementation for local secrets
- [ ] No Bun-first consumer install story

## Immediate next milestone

Recommended next step:

**Storage identity**

Success criteria:

- storage path updated to `~/.pi/agent/pi-multicodex.json`
- tests still pass
- local behavior remains stable
- docs mention the storage path clearly
- no custom crypto added
