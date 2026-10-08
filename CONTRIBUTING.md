# Contributing

Thanks for helping. Read `AGENTS.md` first: it holds the rules for every contributor, human or AI. The longer guides live in `docs/contributing/` and are published on the website.

Contributions are licensed under the MIT License (see `LICENSE`).

## Development setup

Install Node.js 24 and enable pnpm with `corepack enable`. Then run `pnpm install` and `pnpm --filter @csg/web dev`. Details, including Playwright setup, are in `docs/contributing/development-setup.md`.

## Spec process

Behavior is defined by specs in `specs/`, and code follows them.

1. Find the feature in `specs/000-overview.md`, then read its REQ and AC IDs.
2. If your change alters behavior, update the spec first, in the same PR or an earlier one.
3. Add new requirements at the end of the list, with the next free number. Never renumber or delete an ID. Deprecate with strikethrough. `pnpm spec:immutability` enforces this in pre-commit and CI.
4. Mark open questions as `[NEEDS CLARIFICATION: ...]` instead of guessing.
5. Trivial fixes that change no behavior skip the spec step. Say so in the PR.

Full guide: `docs/contributing/spec-process.md`.

## Add a part (data-driven)

Parts are data, not engine code. Describe a part in its pack's `tools/packs/<packId>/pack.config.json` (stable ID, slot, body-region hides, tint slots, license with author and source URL), then run `pnpm assets:build --pack <packId>` and `pnpm assets:check`. Never edit the generated `manifest.json`. Start with `docs/contributing/adding-parts.md`, and read `docs/contributing/assets.md` for licenses, Blender export settings and budgets. The contribution path is defined in `specs/011-asset-pipeline.md`.

## Write a shader node

Node types are versioned (`type@ver`). Add the metadata in `packages/shader-graph`, add the TSL emitter in `src/tsl/`, and keep the two in sync with a test. Full guide: `docs/contributing/writing-a-node.md`.

## Commits and pull requests

- Use Conventional Commits. The `commit-msg` hook runs commitlint.
- Branch names follow `<type>/<area>-<short-name>`.
- Run `pnpm changeset` for any change to an `@csg/*` package.
- Fill in the PR template. Cite the REQ and AC IDs your change implements, or say that no behavior changes.
- CI must pass: lint, typecheck, tests, spec check, spec immutability, build, and end-to-end tests (Chromium). Firefox E2E, the website link check and the asset checks are planned.
- `pre-commit` runs lint-staged, `pnpm spec:check` and `pnpm spec:immutability`. `commit-msg` runs commitlint.
- Do not skip git hooks with `--no-verify`.

Full guide: `docs/contributing/testing.md`.

## AI-assisted contributions

AI-assisted contributions are allowed. The contributor is responsible for every line they submit, whatever tool wrote it. AI-assisted work must follow `AGENTS.md`. Disclose AI assistance in the PR checklist. Details are in `docs/contributing/ai-assisted-contributions.md`.

## Conduct and security

Follow the `CODE_OF_CONDUCT.md`. Report security issues privately as described in `SECURITY.md`.
