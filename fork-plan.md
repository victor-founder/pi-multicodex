# @victor/pi-multicodex fork plan

## Decisions locked in

- **Package name:** `@victor/pi-multicodex`
- **Command prefix:** keep current commands for now
  - `/multicodex-login`
  - `/multicodex-use`
  - `/multicodex-status`
- **Storage compatibility:** none
  - hard break
  - no migration
  - no import from previous storage
- **Scope:** Codex only
- **Replacement strategy:** hard break
  - no drop-in compatibility goal
  - no obligation to preserve previous behavior

## Package manager policy

- Use **pnpm** for local development in this repo.
- Keep the published package **npm-installable** because pi package docs and examples are npm-first.
- Keep release validation with at least:
  - `npm pack --dry-run`
  - one clean npm install/consume check
- Do not rely on Bun as the package manager for pi-managed package installs.

## Pi research summary

### What pi packages and examples show

- Pi packages are documented as being distributed through **npm or git**.
- Pi examples for extensions with dependencies use:
  - `package.json`
  - `package-lock.json`
  - explicit `npm install`
- Extensions are loaded as raw **TypeScript** via pi. No runtime bundling is required for normal extension loading.
- `pi.registerProvider()` is the intended mechanism for:
  - overriding built-in providers
  - registering new providers
  - adding OAuth providers to `/login`

### Why pnpm is acceptable here

- pnpm is a reasonable **repo-local** package manager choice.
- The package still needs to remain **npm-compatible** for pi consumers.
- Treat pnpm as the contributor workflow, not the consumer compatibility contract.

## Why the current implementation overrides the provider

The extension overrides or replaces provider behavior because pi's OAuth/auth model is keyed **per provider ID**, not per account within one provider.

### What pi supports cleanly

- Override an existing provider's `baseUrl` or `headers`
- Register a new provider with `oauth` so it appears in `/login`
- Replace provider behavior for a provider name via `pi.registerProvider(name, config)`

### What pi does not appear to support directly

Pi auth storage persists OAuth credentials in `~/.pi/agent/auth.json` and stores them **by provider ID**. The current auth storage API is effectively shaped around:

- one provider ID
- one stored credential set for that provider

That works for:

- `openai`
- `anthropic`
- `gitlab-duo`
- `qwen-cli`

But it does **not** naturally model:

- multiple OAuth accounts under the same provider ID
- account pools
- account rotation state
- per-account exhaustion windows

### Consequence

If we tried to "augment" the built-in OpenAI/Codex subscription provider directly and depend on the built-in `/login` behavior, we would still hit the core limitation:

- built-in login/auth is designed for **one credential set per provider**, not a rotating pool of Codex accounts

So the current command-driven account management exists because the extension needs its **own multi-account storage and selection logic**.

## Can we make `/login` work better anyway?

Yes, but not by simply augmenting the built-in OpenAI provider in place.

### Realistic options

#### Option A — keep custom commands
- `/multicodex-login <email>`
- `/multicodex-use`
- `/multicodex-status`

Pros:
- simple
- explicit
- already close to current implementation

Cons:
- feels separate from pi's native login UX

#### Option B — register a dedicated provider with OAuth support
Register a custom provider such as `multicodex` with `oauth` so it appears in `/login`.

Pros:
- integrates into pi's login panel
- feels native

Cons:
- built-in OAuth persistence is still **one credential set per provider**
- multi-account rotation still requires extension-managed storage outside normal provider auth
- login flow would still need custom logic to decide whether `/login multicodex` adds a new account, replaces one, or edits one

#### Option C — extension command opens its own account picker/login UI
Keep custom multi-account storage, but make the UX feel more native with better dialogs.

Pros:
- preserves the right architecture for multi-account rotation
- avoids fighting pi's one-provider-one-credential model
- can still feel polished

Cons:
- not integrated into the stock `/login` list

## Recommendation on login UX

For this fork, prefer:

- **custom multi-account storage**
- **custom commands/UI**
- possibly a later polished command flow that feels more native

Do **not** assume the built-in OpenAI subscription provider can be cleanly augmented into a multi-account rotating provider without architectural friction.

If we want login-panel integration later, use a **dedicated custom provider** plus separate extension-managed account pool state. But that should be treated as a UX enhancement, not as the core storage model.

## Fork milestones

## Milestone 1 — independent fork baseline

Goal: establish independent identity and remove upstream constraints before behavior changes.

- [x] Rename package to `@victor/pi-multicodex`
- [x] Update `repository`, `homepage`, `bugs`, and `author`
- [x] Rewrite package description to reflect the fork
- [x] Rewrite README as first-party project documentation
- [x] Adopt pnpm in the repo
- [x] Keep package output npm-compatible
- [x] Add `packageManager` field to `package.json`
- [x] Keep `npm pack --dry-run` as a release gate
- [x] Fix lint failures and config drift
- [x] Reassess `pi-coding-agent.d.ts`; remove if unnecessary

## Milestone 2 — hard storage break

Goal: remove upstream persistence baggage.

- [ ] Replace `~/.pi/agent/multicodex.json` with a new path
- [ ] Redesign storage schema without backward compatibility
- [ ] Remove all migration/import logic concerns
- [ ] Document the hard storage break in README and release notes

Suggested naming:
- [ ] choose one stable new storage file path
  - `~/.pi/agent/victor-pi-multicodex.json`
  - `~/.pi/agent/pi-multicodex.victor.json`

## Milestone 3 — refactor into modules

Goal: stop growing the monolithic `index.ts`.

Target structure:

- [ ] `src/index.ts` or thin root `index.ts`
- [ ] `src/storage.ts`
- [ ] `src/accounts.ts`
- [ ] `src/usage.ts`
- [ ] `src/selection.ts`
- [ ] `src/provider.ts`
- [ ] `src/commands.ts`
- [ ] `src/oauth.ts`
- [ ] `src/errors.ts`

Tests:
- [ ] `selection.test.ts`
- [ ] `usage.test.ts`
- [ ] `storage.test.ts`
- [ ] `provider.test.ts`

## Milestone 4 — define the new behavior contract

Goal: replace inherited heuristics with explicit, documented rules.

- [ ] Define account selection strategy
- [ ] Define quota exhaustion semantics
- [ ] Define which windows matter for selection
- [ ] Define retry policy
- [ ] Define manual override behavior
- [ ] Define when manual override clears
- [ ] Define cache TTL and refresh rules
- [ ] Define error classification rules
- [ ] Document all of the above in README

## Milestone 5 — native-feeling UX without false compatibility

Goal: improve usability without pretending we can reuse built-in single-account auth semantics.

- [ ] Review whether commands should stay unchanged or gain a top-level management command
- [ ] Improve account picker/status dialogs
- [ ] Decide whether `/multicodex-login` remains argument-based or becomes interactive
- [ ] Decide whether to add optional `/login` integration through a dedicated provider later
- [ ] Keep multi-account state extension-managed regardless of `/login` integration

## Milestone 6 — release readiness

Goal: publish as a clearly independent hard-break package.

- [ ] Ensure package name is `@victor/pi-multicodex`
- [ ] Ensure tarball contents are minimal
- [ ] Run lint, typecheck, tests
- [ ] Run `npm pack --dry-run`
- [ ] Test install via local path in pi
- [ ] Test install via git in pi
- [ ] Publish
- [ ] Add release notes with explicit breaking changes

## Non-goals

- [ ] No backward compatibility with previous storage
- [ ] No cross-provider account orchestration
- [ ] No attempt to preserve upstream behavior where it conflicts with the new design
- [ ] No Bun-first consumer install story

## First implementation milestone

Recommended first implementation milestone:

**Independent fork baseline**

Success criteria:
- package renamed
- pnpm adopted locally
- npm compatibility preserved for published package
- new storage path chosen
- stale type shim reassessed
- README rewritten
- lint/typecheck/test passing
- no functional redesign yet beyond hard storage break
