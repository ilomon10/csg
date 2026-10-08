# @csg/web

Vite + React editor. Owns UI state, not rendering. See `docs/architecture.md` sections 1.2 and 4.8.

## Allowed dependencies

- `@csg/engine`, `@csg/shader-graph` (root), `@csg/parts-schema`, React.
- `three` only via `import type`. No renderers, materials or scenes: render through `@csg/engine`.

## Layout

- Feature folders in `src/features/`: `composer`, `anatomy`, `animation`, `look`, `export`, `shader-graph`, `upload`.
- The shell and the preview viewport live in `src/app/`.
- Features never import each other. Shared code goes to `src/shared/`, which features may import. Do not move shared code into `src/app/`.
- Features export through their `index.ts` only.

## Commands

- `pnpm --filter @csg/web dev` / `build`
- `pnpm e2e` (Playwright; needs `pnpm exec playwright install chromium`)
- `pnpm exec vitest run apps/web`

## Spec prefixes

CMP, ANA, PIX, ANM, EXP, EDT, SGF, UPL, UX. Tests cite ACs: `it('AC-UX-010.2: ...')`; e2e likewise.

## Rules

- Named exports only (configs excepted), kebab-case files, PascalCase React components.
- Never use `innerHTML` or `dangerouslySetInnerHTML`. Render user text as text.
