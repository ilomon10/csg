---
title: Development setup
description: Install the tools, run the editor and run the checks for the Character Sprite Generator.
---

This page gets a working checkout running. Every command below comes from the root `package.json`.

## Requirements

- Node.js 24. The version is pinned in `.nvmrc`.
- pnpm 11. The version is pinned by the `packageManager` field. Corepack reads it.

## Install

```sh
git clone https://github.com/ilomon10/csg.git
cd character-sprite-generator
corepack enable
pnpm install
```

CI installs with `pnpm install --frozen-lockfile`. Use the same command if you want an identical lockfile.

`pnpm install` also sets up the git hooks through the `prepare` script:

- `pre-commit` runs lint-staged (ESLint with `--fix`, then Prettier) on the files you staged, then `pnpm spec:check` and `pnpm spec:immutability`.
- `commit-msg` runs commitlint, so commit messages must follow Conventional Commits.

## Run the editor

```sh
pnpm --filter @csg/web dev
```

Open the local URL that Vite prints. The website and the other packages are built separately.

## Run the checks

```sh
pnpm lint          # ESLint: gts style plus the architecture import rules
pnpm typecheck     # tsc -b
pnpm test          # Vitest, one run
pnpm spec:check    # spec IDs, prefixes and structure
pnpm spec:immutability  # no spec REQ or AC ID removed compared with the base branch
pnpm build         # every package that has a build script
```

CI runs the same checks, except that Firefox E2E, the website link check and the asset checks are planned and not yet in CI.

Use `pnpm format:check` to check Prettier formatting, and `pnpm fix` to apply ESLint and Prettier fixes.

To run one test folder, use `pnpm exec vitest run packages/engine`.

## End-to-end tests

The first time, install the Chromium browser and its system dependencies:

```sh
pnpm --filter @csg/web exec playwright install --with-deps chromium
```

Then run:

```sh
pnpm e2e
```

On failure, Playwright writes its report to `apps/web/playwright-report`.

## Renderer notes

The editor uses WebGPU when the browser offers it and falls back to WebGL2 automatically. Tests can force WebGL2 with `forceWebGL: true`. Firefox on Linux has known renderer differences. A Firefox E2E run is planned for CI; until it lands, check rendering changes in Firefox by hand.

## Troubleshooting

- A hook blocks your commit message: fix it to match Conventional Commits, for example `feat(engine): snap camera to texel grid`.
- `pnpm e2e` fails at launch: run the Playwright install command above.
- A spec check fails: see [Spec process](./spec-process).
