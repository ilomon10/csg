# AGENTS.md

Instructions for AI coding agents and human contributors. This file is canonical. Claude Code reads it through `CLAUDE.md`; other tools read it directly.

## Project summary

Character Sprite Generator is an open-source, local-first browser app. Users compose a game character from modular 3D parts, tune its anatomy and colors, pick animations, and render it through a pixel-art shader pipeline into sprite sheets (32 to 128 px). Side-view (platformer) and top-down, 3/4 or isometric (RPG) cameras are both first class. Advanced users edit material and post-process shaders in a node graph, and can upload their own GLB/glTF or VRM models. A Next.js + Fumadocs website hosts the landing page and the user guide.

When sources disagree, the order is: `specs/constitution.md`, then `specs/*.md` (behavior), then `docs/architecture.md` (structure), then `docs/adr/*` (rationale). Raise a conflict as `[NEEDS CLARIFICATION: ...]`; never pick a side silently.

## Repo map

- `specs/`: feature specs `000` to `011`, `constitution.md`, `_template.md`. Start at `specs/000-overview.md` (feature map, area-prefix registry, glossary).
- `docs/architecture.md`: package boundaries, data flow, contracts, milestones.
- `docs/adr/`: decision records 0001 to 0007.
- `docs/guide/`: user guide in Markdown (website source).
- `docs/contributing/`: contributor guides (website "Contribute" section).
- `packages/parts-schema` (`@csg/parts-schema`): Zod schemas and migrations for persisted documents.
- `packages/shader-graph` (`@csg/shader-graph`): pure graph model. Its `src/tsl/` compiler is the `@csg/shader-graph/tsl` subpath.
- `packages/engine` (`@csg/engine`): three.js runtime (renderer, asset registry, rig, animation, pipeline, export, upload).
- `apps/web` (`@csg/web`): Vite + React editor. Feature folders under `src/features/`: composer, anatomy, animation, look, export, shader-graph, upload. The shell and preview viewport live in `src/app/`.
- `apps/site` (`@csg/site`): Next.js App Router website with Fumadocs (spec 010, ADR-0007).
- `tools/`: Node scripts run with `tsx` (spec checks, asset build, rig verification). `tools/hooks/` holds Claude Code hooks.
- `.claude/`, `.tagconn/`: agent configuration and scratch. `.github/`: CI, issue forms, PR template. `.changeset/`: release notes. `.husky/`: git hooks.
- Per-package notes: `packages/*/CLAUDE.md` and `apps/web/CLAUDE.md` list allowed dependencies, spec prefixes and commands. Read them before editing a package.

## Setup and commands

Requirements: Node 24 (`.nvmrc`, `engines`) and pnpm 11, pinned by the `packageManager` field. Run `corepack enable` once.

```sh
corepack enable
pnpm install                  # CI runs: pnpm install --frozen-lockfile
pnpm --filter @csg/web dev    # editor dev server
```

Root scripts (from `package.json`):

- `pnpm lint`: ESLint (gts plus the architecture rules). `pnpm fix` runs ESLint `--fix` and Prettier.
- `pnpm format` and `pnpm format:check`: Prettier.
- `pnpm typecheck`: `tsc -b`.
- `pnpm test`: Vitest, single run. `pnpm test:watch` for watch mode. One folder: `pnpm exec vitest run packages/engine`.
- `pnpm spec:check`: validates spec IDs, prefixes and REQ/AC structure.
- `pnpm spec:immutability`: fails if any REQ or AC ID was removed compared with the base branch.
- `pnpm spec:trace`: regenerates the AC-to-test matrix in `specs/traceability.md`. Never edit that file by hand.
- `pnpm build`: runs `build` in every package that has one.
- `pnpm e2e`: Playwright tests for `@csg/web`. First run: `pnpm --filter @csg/web exec playwright install --with-deps chromium`.
- `pnpm changeset`: records a release note for an `@csg/*` change.

Asset and generator scripts (spec 011; being added, names are final):

- `pnpm assets:build [--pack <id>]`: builds optimized packs and `manifest.json` from `tools/packs/<packId>/pack.config.json`.
- `pnpm assets:check`: validates built packs. Runs without `assets-src/`.
- `pnpm assets:verify-rig`: checks skinned parts and clips against the canonical rig (the M1 gate).
- `pnpm assets:licenses`: regenerates the bundled section of `ASSETS_LICENSE.md`.
- `pnpm assets:thumbnails`: renders part thumbnails with Playwright.
- `pnpm fixtures:build`: regenerates the synthetic test fixtures.
- `pnpm docs:shortcuts`, `pnpm docs:nodes`: regenerate the shortcut and shader node reference pages from their registries.
- `pnpm site:sprites`: renders the pre-rendered sprites used by the website.

A script that is not implemented yet prints `not implemented (Mx)` and exits 0. Read the output, not only the exit code.

## Golden rules

Spec first

- Before coding, find the governing `REQ-` and `AC-` IDs in `specs/`. If none exists, write or extend the spec first. If a question is open, write `[NEEDS CLARIFICATION: ...]` and stop (constitution P-12).
- A behavior change updates its spec first, in the same PR or an earlier one (P-01).
- IDs are permanent. Never renumber, reuse or delete one. Deprecate with strikethrough and a reason: `~~REQ-PIX-004~~ (deprecated YYYY-MM-DD: replaced by REQ-PIX-012)`. New requirements take the next free number at the end of the list.
- Edit specs with normal file edits; CI and pre-commit reject removed IDs regardless of tool (`pnpm spec:immutability`).
- Area prefixes are GEN, CMP, ANA, PIX, ANM, EXP, EDT, SGF, UPL, UX, WEB, AST. Add one only by editing the registry in `specs/000-overview.md`.
- Tests cite ACs in their names: `it('AC-PIX-003.1: snaps translation to the texel grid', ...)`. Every P1 AC needs at least one test (P-09).

Code style (Google TypeScript Style via gts, ADR-0002)

- Named exports only. Exceptions are listed in ESLint overrides: `apps/site/app/**/{page,layout,not-found,error,loading,template}.tsx`, `apps/site/app/**/route.ts`, `apps/site/mdx-components.tsx`, `*.config.{ts,js,mjs,cjs}` and `.prettierrc.js` (architecture 4.9).
- Kebab-case file names. React components are PascalCase functions in kebab-case files (`slot-list.tsx`).
- Strict TypeScript with `noUncheckedIndexedAccess`. No `any`: use `unknown` and narrow. Use `import type` for types. No namespaces.
- TSDoc on every exported symbol of `packages/*`.
- Lint and typecheck errors block merge. Fix the cause; a disable comment needs a reason in the PR.

Architecture boundaries (enforced by `eslint.config.js`, architecture 1.2)

- Dependencies point from consumers to dependencies. Nothing depends on `apps/*` or `tools/`. No cycles.
- `parts-schema` and the `shader-graph` root entry import no `three`, no React, no DOM APIs, and no other `@csg/*` package.
- Only `@csg/engine` and `@csg/shader-graph/tsl` import `three`. The compiler never imports the engine.
- `apps/web` renders only through `@csg/engine`. It may use `import type` from `three`, nothing else. Packages never import React.
- `apps/site` has no runtime dependency on workspace packages in v1. It reads Markdown from `docs/guide/`.
- `tools/` imports only DOM-free engine modules (`rig/`, `retarget/`), never the engine barrel.
- Inside `apps/web`, feature folders never import each other. Shared code goes to `src/shared/`. The shell and preview viewport live in `src/app/`, and only the shell imports from it.

Data and formats

- Parts, slots, palettes, presets and node types are data (manifests, JSON, Zod schemas), not engine code (P-11).
- Persisted documents carry `format` and an integer `version`. Loaders migrate forward with pure functions and never write an older version. A breaking change bumps the version and ships a migration plus a fixture test from the previous version.
- Shader graph node types are versioned as `type@ver`. Socket IDs are stable strings, never array indexes. Unknown fields round-trip.

Rendering and determinism

- three.js is pinned to an exact version (r186, no caret). Upgrades are dedicated PRs with golden images on both backends (ADR-0003).
- Use `WebGPURenderer` from `three/webgpu`, TSL node materials, and `RenderPipeline` with `pass()` and MRT. Do not use `EffectComposer` or raw GLSL `ShaderMaterial` unless a spec allows it. Every visual feature must work with `forceWebGL: true`.
- Export paths are deterministic (P-04): no `Date.now()`, `performance.now()` or `Math.random()`. Animation time is `frame / fps`. Randomness uses a seeded PRNG whose seed is stored in the document. Dither uses screen-space Bayer matrices only.
- Pixel stability (P-05): integer resolutions, nearest filtering, no MSAA, texel-snapped translation, integer upscale with `image-rendering: pixelated`.
- Golden images are stored per backend (WebGPU, WebGL2). The default tolerance is zero differing pixels; a per-test override needs a written reason.

Privacy, security and licensing

- Local-first (P-03): user files (uploads, characters, graphs) never leave the browser. No server upload, no telemetry, no third-party fetch of user content, no tracking pixels. Storage is OPFS and IndexedDB. Share-by-URL encodes data in the URL fragment and covers built-in assets only.
- Uploads are untrusted: size cap, magic-byte check, worker parse with timeout, `gltf-validator`, a URL modifier that allows only `blob:` and `data:`, budgets from spec 008, and name sanitization to `[A-Za-z0-9_.:-]{1,64}`. Never use `innerHTML`.
- The editor runs on a dedicated origin, separate from the website. The domain is pending a project decision, so do not hard-code one.
- The editor is served under a strict Content Security Policy (for example `connect-src 'self'`). Do not relax it without a spec amendment.
- Treat all persisted data (OPFS, IndexedDB, share fragments, imported files) as untrusted. Validate and normalize it before use.
- Reject `__proto__`, `constructor` and `prototype` keys when parsing or merging user data.
- No CDN-hosted decoders, scripts or wasm. Ship every decoder and script from the repo.
- Never use `innerHTML` or `dangerouslySetInnerHTML` in any app. Render user text as text.
- Bundled assets are CC0 or a compatible license recorded in `ASSETS_LICENSE.md` with author and source URL (P-02). Manifest entries without license, author or source URL fail validation (GEN-008). Every export includes `CREDITS.txt`. Unknown or non-commercial assets trigger a visible warning before export.
- Code is MIT (`LICENSE`). Do not add code or assets whose license you have not verified.
- Never hotlink images. Website and app images are local files, npm icon packages or inline art. No external image URLs.

Accessibility and budgets

- The editor and the website meet WCAG 2.2 AA (P-06): every action has a keyboard path, focus is visible, contrast is at least 4.5:1, `prefers-reduced-motion` is respected, controls are labelled, and graph nodes have a list view. Accessibility regressions block release.
- Performance (P-07): editor initial load at most 2.5 s LCP and 400 KB gzipped JS before 3D assets; live preview at least 60 fps at 64 px with 8 parts; a 64 px, 8-direction, 4-clip, 8-frame export in at most 10 s; website Lighthouse mobile Performance at least 90 and Accessibility at least 95. A change that breaks a budget needs a spec amendment, not a waiver.

## Workflow

- Branch from `main`. Name branches `<type>/<area>-<short-name>`, for example `feat/pix-outline-width`.
- Commits follow Conventional Commits, checked by commitlint in the `commit-msg` hook. Use the package or area as scope, for example `feat(engine): snap camera to texel grid`. Mark breaking format changes with `!` and a `BREAKING CHANGE:` footer.
- Changesets: run `pnpm changeset` for any change to an `@csg/*` package. Packages stay private until the 1.0 publishing decision, but the notes are still written. Spec-only and docs-only changes need none.
- Pull requests use `.github/pull_request_template.md`. Cite the REQ/AC IDs the change implements, or say explicitly that no behavior changes. Attach screenshots for UI changes and golden diffs for rendering changes.
- Local hooks: `pre-commit` runs lint-staged (ESLint `--fix` and Prettier on staged files), then `pnpm spec:check` and `pnpm spec:immutability`. `commit-msg` runs commitlint. Never skip hooks with `--no-verify`.
- CI (`.github/workflows/ci.yml`) must pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm spec:check`, `pnpm spec:immutability`, `pnpm build`, and a separate `pnpm e2e` job (Playwright, Chromium). Planned, not yet in CI: Firefox E2E, the website link check, and the asset checks (`pnpm assets:check`, `pnpm assets:licenses` diff). Run `pnpm format:check` before you push; CI does not run it.
- Constitution changes need a PR labelled `constitution`, approval from two maintainers, and at least 7 days open (constitution, amendment process).
- AI-assisted contributions are allowed. The human contributor stays responsible for every change and must follow this file.

## Definition of done

- The governing spec is updated first if behavior changed, and `pnpm spec:check` passes.
- Every P1 AC touched has a passing test named with its ID.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `pnpm build` passes for the touched packages. Run `pnpm e2e` when the UI changed.
- New exports have TSDoc. No default exports outside the listed exceptions.
- Docs are updated in the same PR: `docs/guide/` for user-facing behavior, `docs/contributing/` for workflow, `docs/architecture.md` when structure or contracts change. A significant decision gets an ADR from `docs/adr/template.md`.
- `@csg/*` changes have a changeset.
- New assets are described in `pack.config.json` with license, author and source URL, built with `pnpm assets:build`, and listed in `ASSETS_LICENSE.md` via `pnpm assets:licenses`.
- UI changes: keyboard path, focus and contrast checked. Rendering changes: golden images regenerated per backend, with the reason.

## Where to find things

- Feature specs and roadmap: `specs/000-overview.md`. Principles: `specs/constitution.md`.
- Architecture: `docs/architecture.md`. Decisions: `docs/adr/` (0001 3D-to-pixel, 0002 monorepo and gts, 0003 WebGPU and TSL, 0004 React Flow, 0005 local-first upload, 0006 spec-driven development, 0007 Next.js and Fumadocs).
- Contributor guides: `CONTRIBUTING.md` and `docs/contributing/`. User guide: `docs/guide/`.
- Asset licenses and credits: `ASSETS_LICENSE.md`.
- Security reports: `SECURITY.md`. Conduct: `CODE_OF_CONDUCT.md`.

## What NOT to do

- Do not renumber, reuse or delete IDs. Do not hand-edit `specs/traceability.md`.
- Do not implement behavior that no spec describes, and do not guess silently.
- Do not import `three` into `parts-schema` or the `shader-graph` root. Do not import React anywhere in `packages/*`, and do not touch the DOM in `parts-schema`, the `shader-graph` root or `engine/src/rig|retarget`.
- Do not add default exports, disable architecture rules, or bypass feature boundaries.
- Do not call `Math.random()`, `Date.now()` or `performance.now()` in export or pixel code.
- Do not send user data anywhere, add analytics, or fetch third-party resources at runtime.
- Do not hotlink images, or add an asset whose license is unknown.
- Do not commit `assets-src/`, `CLAUDE.local.md`, secrets, or fixtures larger than 200 KB.
- Do not upgrade three.js or change TSL usage outside a dedicated PR.
- Do not commit planning notes or generated reports. Put them in the PR description.
- Do not hand-edit generated files: `specs/traceability.md`, `assets/packs/*/manifest.json`, `clips.json`, or the bundled section of `ASSETS_LICENSE.md`. Edit the source (`pack.config.json`, the spec, the registry) and regenerate.
