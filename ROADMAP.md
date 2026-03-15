# @victor-software-house/pi-multicodex roadmap

## Product focus

`@victor-software-house/pi-multicodex` is a pi extension focused on rotating multiple ChatGPT Codex OAuth accounts for the `openai-codex-responses` API.

The roadmap is centered on:

- stable account management
- explicit and configurable rotation behavior
- one clear operator command surface inside pi
- maintainable extension architecture built around a shared controller
- better status, verification, and recovery workflows
- package-quality release discipline

## Current product state

The current shipped behavior is:

- MultiCodex overrides the normal `openai-codex` provider path directly.
- MultiCodex auto-imports pi's stored `openai-codex` OAuth auth when it is new or changed.
- MultiCodex uses one `/multicodex` command family with subcommands.
- `/multicodex use` opens the account picker, supports account removal via `Backspace`, and supports `/multicodex use <identifier>` for direct activation.
- `/multicodex show`, `/multicodex verify`, `/multicodex path`, `/multicodex reset`, and `/multicodex help` are available without opening a panel.
- `/multicodex footer` opens an interactive settings panel with live preview, or prints a summary in non-interactive mode.
- The usage footer displays severity-based color tiers that shift as quota depletes.
- Footer settings are stored in `~/.pi/agent/settings.json` under `pi-multicodex`.
- Managed account storage is stored in `~/.pi/agent/codex-accounts.json`.
- The behavior contract (selection priority, retry policy, manual override, error classification) is documented in README.
- Rotation criteria are still hard-coded but fully documented.

## Operating principles

- Keep npmjs as the canonical public distribution channel.
- Keep the package npm-installable for pi users.
- Use pnpm for local development.
- Keep releases small, validated, and repeatable.
- Prefer explicit behavior over hidden heuristics.
- Prefer one memorable top-level command over several loosely related commands.
- Prefer dynamic autocomplete and operable non-UI subcommands over UI-only workflows.
- Persist user settings immediately when changes are cheap and local.
- Keep config, runtime state, and UI concerns separate.
- Avoid custom encryption schemes for local secrets.
- If secret storage needs stronger protection later, prefer platform-backed secure storage over homegrown crypto.

## Decisions already locked in

- **Package name:** `@victor-software-house/pi-multicodex`
- **Scope:** Codex only
- **Local package manager:** pnpm
- **Primary release path:** npmjs with trusted publishing
- **Storage file:** `~/.pi/agent/codex-accounts.json`
- **Provider strategy:** own the normal `openai-codex` path directly
- **Auth strategy:** auto-import pi's stored `openai-codex` auth when it is new or changed
- **Footer config storage:** `settings.json` key `pi-multicodex`
- **Hook strategy:** `lefthook` runs `mise run pre-push` before push
- **Migration policy for command UX:** move quickly to the new command family with no backward-compatibility aliases for deprecated commands

## Command model decision

The extension now uses one operator command family.

### Shipped command model

- `/multicodex`
  - open the main interactive UI
- `/multicodex show`
  - show current runtime state and active account summary
- `/multicodex use [identifier]`
  - choose or activate an account
- `/multicodex footer`
  - open footer settings
- `/multicodex rotation`
  - show current rotation behavior summary
- `/multicodex verify`
  - verify runtime health and config access
- `/multicodex path`
  - show config and storage paths
- `/multicodex reset [manual|quota|all]`
  - reset selected extension state
- `/multicodex help`
  - print compact usage text

### Migration rules applied

- `/multicodex-use`, `/multicodex-status`, and `/multicodex-footer` were removed with no compatibility aliases.
- README, ROADMAP, tests, and command implementation were updated in the same change.
- The command migration remains a user-facing breaking change and should be released accordingly.

## Completed milestone — command-family migration and operator UX

Outcome: the split command surface was replaced with one coherent operator API that works in both UI and non-UI flows.

### Work items

- [x] Replace `/multicodex-use`, `/multicodex-status`, and `/multicodex-footer` with one `/multicodex` command family
- [x] Make `/multicodex` with no arguments open the main interactive UI
- [x] Add subcommands: `show`, `use`, `footer`, `rotation`, `verify`, `path`, `reset`, `help`
- [x] Add dynamic autocomplete for subcommands
- [x] Add dynamic autocomplete for `/multicodex use <identifier>` from managed accounts
- [x] Keep `show`, `verify`, `path`, `reset`, and `help` usable without opening a panel
- [x] Ensure non-interactive contexts return short operational messages instead of trying to open pickers or panels
- [x] Remove references to `/login` from notifications and docs when MultiCodex owns the account flow directly
- [x] Update tests to cover the new command-family behavior and autocomplete

### UX acceptance criteria

1. **Discoverability**
   - Users only need to remember `/multicodex`.
   - `help` returns one compact usage line.
   - autocomplete exposes the available subcommands and account identifiers.

2. **Primary flow**
   - `/multicodex` opens the main UI.
   - the main UI exposes account selection, account status, footer settings, and rotation settings.

3. **Non-UI flow**
   - `/multicodex show` prints a compact readable summary.
   - `/multicodex use <identifier>` works without opening a picker.
   - `/multicodex verify`, `/multicodex path`, and `/multicodex reset` do not require UI.

4. **Removal of old commands**
   - old command registrations are deleted, not aliased.
   - documentation and tests mention only the new command family.

## Next milestone — actionable account management UX

Goal: make account inspection and switching consistent, direct, and easy to understand.

### Work items

- [x] Make account selection explicit and actionable from the main UI
- [x] Ensure selecting an account actually activates it instead of only displaying it
- [x] Keep read-only summaries and mutating actions clearly separated
- [x] Show active account, manual override state, cooldown state, import source, and cached usage in a consistent format
- [ ] Improve select-or-login flow for unknown or stale identifiers
- [x] Replace brittle string parsing in selection flows with structured item mapping
- [ ] Replace imported-account fallback labels with real email identity when it can be derived safely
- [ ] Make active-account information easier to understand during a session

### UX acceptance criteria

1. **Action clarity**
   - every picker either performs a clearly named action or is read-only by design
   - there is no status view that looks interactive but does nothing

2. **Selection state**
   - the active account is clearly marked
   - manual override is clearly marked
   - quota or cooldown state is clearly marked
   - imported-account origin is clearly marked when relevant

3. **Identity quality**
   - imported accounts prefer a real email label when derivable safely
   - fallback labels remain deterministic and readable when email cannot be derived

## Parallel milestone — footer settings UX completion

Goal: finish the footer experience so it matches the new command model and follows the recommended settings-panel pattern.

### Already done

- [x] Debounce model-change refresh work so rapid `Ctrl+P` cycling never blocks on auth sync or usage fetches
- [x] Render each reset countdown next to its matching usage period instead of grouping them at the end
- [x] Add live preview inside the footer settings panel
- [x] Update the actual footer while footer settings change in the panel
- [x] Tune the footer color palette before locking the final style
- [x] Tighten footer updates so account switches and quota rotation are reflected immediately
- [x] Add tests for live preview updates, model-switch debouncing, and footer/account synchronization

### Remaining work

- [x] Move footer settings access under `/multicodex footer`
- [ ] Persist footer settings immediately on each change instead of waiting until panel close
- [ ] Re-read normalized settings after save when needed so the UI reflects persisted truth
- [x] Add a non-UI footer summary path under `/multicodex footer` for non-interactive mode
- [ ] Keep live preview behavior while switching to immediate persistence

### Footer acceptance criteria

- footer changes survive panel exit failures because persistence happens during editing
- the footer panel remains shallow, searchable, and quick to scan
- the actual footer remains synchronized with cached usage and active account state

## Follow-up milestone — rotation behavior contract and settings

Goal: make account rotation behavior explicit, configurable, and inspectable.

### Behavior contract work

- [x] Define account selection priority
- [x] Define quota exhaustion semantics
- [x] Define which reset windows matter for selection
- [x] Define retry policy
- [x] Define manual override behavior
- [x] Define when manual override clears
- [x] Define cache TTL and refresh rules
- [x] Define error classification rules
- [x] Document the behavior contract in README

### Rotation configuration work

- [ ] Replace hard-coded rotation criteria with persisted configuration
- [ ] Add a rotation settings model with normalized load and save behavior
- [ ] Add a `/multicodex rotation` panel
- [ ] Persist rotation criteria in settings and apply them to account selection
- [ ] Expose the current rotation policy in `/multicodex show`
- [ ] Expose a short rotation-health summary in `/multicodex verify` where practical

### Candidate settings to support

- [ ] prefer untouched accounts
- [ ] prefer earliest weekly reset when multiple accounts are available
- [ ] configurable fallback cooldown when reset time is unknown
- [ ] configurable retry count for pre-stream quota rotation
- [ ] explicit enable or disable toggles for selection heuristics that are currently implicit

### Rotation acceptance criteria

- rotation rules are readable from config and from runtime summary output
- account selection behavior no longer depends on undocumented hard-coded priorities
- configuration changes take effect without ambiguous mixed state

## Architecture milestone — shared MultiCodex controller

Goal: move from scattered command logic to one shared controller that owns config, runtime summaries, and verification flows.

### Work items

- [ ] Introduce a broader MultiCodex controller instead of having footer logic own the only controller-like abstraction
- [ ] Let commands call controller methods instead of duplicating state access and persistence logic
- [ ] Keep durable config separate from runtime status and cached usage
- [ ] Move verify logic into the controller
- [ ] Move reset logic into the controller
- [ ] Provide a stable path API for config and storage reporting
- [ ] Keep hooks and command handlers thin by pushing orchestration into the controller

### Target controller responsibilities

- [ ] `getConfigPaths()`
- [ ] `getFooterPreferences()`
- [ ] `setFooterPreferences(...)`
- [ ] `getRotationSettings()`
- [ ] `setRotationSettings(...)`
- [ ] `getRuntimeStatus()`
- [ ] `refreshRuntimeStatus()`
- [ ] `setManualAccount(...)`
- [ ] `clearManualAccount()`
- [ ] `reset(...)`

### Architecture acceptance criteria

- command handlers are mostly routing and notification glue
- UI code does not write files directly
- hooks do not duplicate command logic
- config load and save paths are normalized and centralized

## Completed milestone — runtime verification and recovery

Outcome: extension health is inspectable and recoverable from the command family.

### Work items

- [x] Add `/multicodex verify`
- [x] Verify account storage readability and writability
- [x] Verify settings storage readability and writability
- [x] Verify importable `openai-codex` auth visibility
- [x] Verify active-account resolution state
- [ ] Verify usage refresh behavior and report failures concisely
- [x] Add `/multicodex path`
- [x] Show managed account storage path and settings path
- [x] Add `/multicodex reset`
- [x] Define reset scopes: manual override, quota cooldown, or all

### Verification acceptance criteria

- a user can inspect storage paths without reading docs
- a user can tell whether the extension is healthy from one short command
- a user can recover from bad local state without deleting files manually

## State restoration and event review

Goal: confirm runtime behavior stays correct as the command model and controller expand.

### Work items

- [ ] Review whether session restoration should also handle `session_tree` and `session_fork` in addition to the current startup and switch events
- [ ] Confirm manual override semantics remain correct across reloads and new sessions
- [ ] Confirm status refresh paths do not leave stale footer state behind after model changes or shutdown
- [ ] Re-check hook responsibilities after controller extraction so startup, switch, and refresh logic stay narrow

### Acceptance criteria

- state restoration behavior is explicit and tested
- command-family migration does not introduce stale in-memory assumptions
- footer and account state remain aligned after session lifecycle events

## Suggested implementation order

1. ~~Build the `/multicodex` command family and delete the old commands.~~ Done.
2. ~~Add subcommand and account autocomplete.~~ Done.
3. ~~Make the main UI the zero-argument path.~~ Done.
4. ~~Make account selection fully actionable and remove no-op status selection.~~ Done.
5. ~~Move footer settings under the command family.~~ Done. Immediate persistence still pending.
6. ~~Add `verify`, `path`, `reset`, and `help`.~~ Done.
7. ~~Document the behavior contract in README.~~ Done.
8. Introduce the broader MultiCodex controller.
9. Add configurable rotation settings.
10. Review state restoration and lifecycle handling after the controller migration.

## Release discipline

Every release should continue to pass at least:

```bash
pnpm check
npm pack --dry-run
pnpm release:dry
```

Target release flow:

1. Write Conventional Commits.
2. Merge to `main`.
3. Let GitHub Actions run CI and `semantic-release` from `.github/workflows/publish.yml`.
4. Let npm trusted publishing handle `npm publish --provenance` without long-lived npm tokens.

## Final release validation

Before treating the new release flow as fully settled, explicitly validate the full path:

- [x] Run `pnpm check`
- [x] Run `npm pack --dry-run`
- [x] Configure npm trusted publishing for `.github/workflows/publish.yml`
- [x] Verify the GitHub Actions trusted-publishing workflow completes successfully
- [x] Verify the new version is available on npmjs after a release-triggering commit
- [x] Verify install or upgrade in pi from the published package after a release-triggering commit
- [x] Verify the published tarball includes every runtime TypeScript module the extension imports

## Non-goals for now

- [ ] No cross-provider account orchestration
- [ ] No attempt to become a generic auth manager for pi
- [ ] No custom encryption implementation for local secrets
- [ ] No Bun-first consumer install story
