---
paths:
  - 'packages/shader-graph/**'
---

# packages/shader-graph rules

Specs: 007 (SGF, format and compiler). 006 (EDT) depends on the command API. Architecture 1.1 and 3.5.

- The root entry (`src/**` except `src/tsl/`) depends on `zod` only. No `three`, no React, no DOM APIs, no other `@csg/*` package.
- `src/tsl/` is the only code that imports `three`. It compiles against the `CompileContext` interface and never imports `@csg/engine`.
- Every edit is a command on the model. Undo, redo, copy/paste and serialization depend on it.
- Node types are `type@ver`. Each version ships a `migrateFrom` for the previous one. A change in node behavior means a new version with a migration.
- Socket IDs are stable strings. Never key sockets by array index.
- Keep unknown fields on round trip (loose Zod objects). The `ui` section is ignored by the compiler and by equality checks.
- Parameter changes update `uniform().value` without recompiling. Structure changes recompile, cached by `structureHash`.
- Compile errors carry `nodeId` and `socketId` so the editor can show them on the node.
- The metadata registry (root) and the TSL emitters (`src/tsl/`) must stay in sync. A test checks that they agree.
- Name tests after SGF ACs, for example `it('AC-SGF-001.1: ...')`.
- Verify with `pnpm exec vitest run packages/shader-graph` and `pnpm --filter @csg/shader-graph build`.
