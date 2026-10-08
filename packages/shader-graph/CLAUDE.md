# @csg/shader-graph

Pure shader graph model (document schema, socket registry, validation, migrations, commands) at
the root entry, and the graph-to-TSL compiler under the `@csg/shader-graph/tsl` subpath
(`src/tsl/`). See `docs/architecture.md` sections 1.1 and 4.8.

## Allowed dependencies

- Root entry (`src/**` except `src/tsl/**`): `zod` only. No `three`, React or DOM.
- `src/tsl/**`: may import `three` (pinned r186) and the root entry. Never the engine; compile
  against a `CompileContext` interface the engine implements.

## Commands

- `pnpm --filter @csg/shader-graph build` (typecheck)
- `pnpm exec vitest run packages/shader-graph`

## Spec prefixes

SGF (format + compiler); EDT depends on the command API. Tests cite ACs: `it('AC-SGF-001.1: ...')`.

## Rules

- Named exports only, kebab-case files, TSDoc on every exported symbol.
