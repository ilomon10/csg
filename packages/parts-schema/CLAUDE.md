# @csg/parts-schema

Zod schemas and inferred types for every persisted document except shader graphs
(`PartManifest`, `CharacterSpec`, `RenderSettings`, `ExportSettings`, ...), plus migrations and
JSON Schema generation. See `docs/architecture.md` sections 1.1 and 3.

## Allowed dependencies

- `zod` only. Never `three`, React or DOM APIs (runs in Node, browser and workers).
- Must not import other `@csg/*` packages.

## Commands

- `pnpm --filter @csg/parts-schema build` (typecheck)
- `pnpm exec vitest run packages/parts-schema`

## Spec prefixes

CMP (schemas of `CharacterSpec`), ANA, PIX (`RenderSettings`), EXP (`ExportSettings`), AST
(manifests); cross-cutting `GEN`. Tests cite ACs: `it('AC-CMP-001.1: ...')`.

## Rules

- Named exports only, kebab-case files, TSDoc on every exported symbol.
- Persisted formats carry `format` + `version`; never break a version without a migration.
