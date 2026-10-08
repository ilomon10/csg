# @csg/engine

three.js runtime: renderer creation, asset registry and loaders, rig rebinding, composition,
anatomy, animation, `RenderPipeline`, frame sampler, exporters, upload validation, retargeting,
storage adapters. Framework-agnostic: no React. See `docs/architecture.md` sections 1.1, 2 and 4.8.

## Allowed dependencies

- `three` (pinned r186), `@csg/parts-schema`, `@csg/shader-graph` (+ `/tsl`).
- `src/rig/` and `src/retarget/` stay DOM-free so `tools/` can import them.
- Never React, never `apps/*`.

## Commands

- `pnpm --filter @csg/engine build` (typecheck)
- `pnpm exec vitest run packages/engine`

## Spec prefixes

CMP, ANA, PIX, ANM, EXP, UPL, AST. Tests cite ACs: `it('AC-PIX-003.2: ...')`.

## Rules

- Named exports only, kebab-case files, TSDoc on every exported symbol.
- Exporters are pure functions over `RenderedFrame[]` (no three.js) so they test in Node.
