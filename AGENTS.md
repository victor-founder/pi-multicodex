# MultiCodex Extension - Agent Notes

## Scope

Only edit files in this repository.

## Goals

- Keep the extension runnable when installed outside the pi monorepo.
- Avoid deep imports that resolve to repo-local paths.
- Keep runtime behavior compatible with pi extension docs.
- Keep the published package self-contained, including all runtime TypeScript modules it imports.

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

Release workflow:

- Prepare releases locally with `npm run release:prepare -- <version>`.
- The release helper should prefer Bun package-manager commands for version updates.
- Normal releases are tag-driven through GitHub Actions trusted publishing.
- Do not use local `npm publish` for routine releases.

## Commit Workflow

- Do not batch unrelated changes into a single large commit.
- Commit incrementally as each logical step is completed.
- Use conventional commit messages such as `build: ...`, `docs: ...`, `refactor: ...`, and `release: ...`.
- Before publishing, make sure the working tree is clean and all required checks pass.
- Keep release commits focused on version bumps and release metadata only.
