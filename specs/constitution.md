---
id: GEN
title: Project constitution
status: accepted
owner: maintainers
last_updated: 2026-10-08
---

# Constitution

These principles cannot be broken. Every spec, ADR, PR and AI agent follows them. If a spec conflicts with this file, this file wins. The spec author then raises the conflict as `[NEEDS CLARIFICATION]`.

## Principles

**P-01 Specs come first.** The specs in `specs/` are the source of truth. Code, tests and user docs follow the specs, never the other way round. A PR that changes behavior must update (or add) the spec first, in the same PR or in an earlier one. Specs and ADRs must not contradict each other. Fix the conflict before merging.

**P-02 Clear licensing.** All bundled assets (models, animations, palettes, fonts) are CC0 or carry a compatible license recorded in `ASSETS_LICENSE.md`, with author and source URL. Every export includes a `CREDITS.txt` that lists each asset it uses. Assets with unknown or non-commercial licenses always trigger a visible warning before export. Code is released under the repository's OSI license.

**P-03 Local-first privacy.** User files (uploads, characters, graphs) never leave the browser. There is no server upload, no third-party fetch of user content and no tracking pixel in the editor. Storage is OPFS/IndexedDB only. Network access is limited to loading the app's own static assets. Opt-in features that share data (for example share-by-URL) encode the data in the URL itself.

**P-04 Deterministic exports.** The same `CharacterSpec`, render settings, graph and app version must produce byte-identical PNG pixel data and identical metadata JSON on the same renderer backend. Exports use no time-based noise, no unseeded randomness and no wall-clock values in pixel output. Randomize features take an explicit seed.

**P-05 Pixel-perfect stability.** Rendering at integer resolutions uses nearest filtering and no anti-aliasing, and snaps translation to the texel grid. A static pose rendered twice shows zero pixel shimmer. Upscaling is integer-only (`image-rendering: pixelated`).

**P-06 Accessibility.** The editor and the website meet **WCAG 2.2 AA**. Every action can be done with the keyboard, focus is always visible, contrast is at least 4.5:1, `prefers-reduced-motion` is respected, and canvas tools offer accessible alternatives (labelled controls, a list view of graph nodes). Accessibility regressions block release.

**P-07 Performance budgets.** These are measured on a reference mid-range machine (4-core 2020 laptop, integrated GPU, Chrome stable):
- Editor initial load: ≤ 2.5 s LCP and ≤ 400 KB gzipped initial JS before 3D assets load. The default character becomes interactive in ≤ 5 s on a 50 Mbps connection.
- Live preview: ≥ 60 fps (p95 frame time ≤ 16.7 ms) at 64 px output with 8 equipped parts and the default pipeline.
- Export: a 64 px, 8-direction, 4-clip, 8-frame sprite sheet completes in ≤ 10 s.
- Website: Lighthouse Performance ≥ 90 and Accessibility ≥ 95 on mobile.
A PR that breaks a budget needs a spec amendment, not just a waiver.

**P-08 Code style.** All TypeScript follows the Google TypeScript Style Guide, enforced by `gts` (ESLint flat config + Prettier). This means strict mode, named exports only, kebab-case filenames and TSDoc on public APIs. Lint errors block merge.

**P-09 Test traceability.** Every acceptance criterion (`AC-<AREA>-NNN.k`) with priority P1 has at least one automated test whose name begins with that ID, e.g. `it('AC-PIX-003.1: …')`. Every test that checks spec behavior cites an AC. The `spec:trace` tool reports any ACs that have no test.

**P-10 Framework-agnostic core.** `packages/engine`, `packages/shader-graph` and `packages/parts-schema` do not import React, Next.js or any DOM-framework code. They run in a worker or in Node (headless tests) where the platform allows it. UI frameworks live only in `apps/*`.

**P-11 Community-friendly by design.** Parts, slots, palettes, presets and node types are **data-driven**: contributors add them through manifests and JSON/Zod schemas, not engine code. Docs are plain Markdown in the repo (`docs/**`, `specs/**`). Contributing must never require a proprietary tool or paid asset.

**P-12 No silent guessing.** Specs mark unknowns with `[NEEDS CLARIFICATION: …]`. Implementers stop and ask rather than invent behavior.

## Amendment process

1. Open a PR that edits only this file (plus any affected specs or ADRs) and has the label `constitution`.
2. The description states the principle changed, the reason, and its impact on existing specs and ADRs.
3. The PR needs approval from **two maintainers** and stays open for at least **7 days** for community comment.
4. Principles are never renumbered. A removed principle stays in place, struck through, with its reason (`~~P-0X …~~ (removed YYYY-MM-DD: reason)`).
5. After merge, update `last_updated` and fix any specs that now conflict, in the same release.
