---
paths:
  - 'tools/**'
---

# tools/ rules

Specs: 011 (AST, asset pipeline and rig verification), GEN-008 (licensing). Architecture 1.2, rule 6, and milestone M1 in section 5.

- Scripts are Node with `tsx`. Import only DOM-free engine modules (`rig/`, `retarget/`), never the engine barrel. Do not import `three`, React or anything under `apps/*`.
- Use the pure graph model from the `@csg/shader-graph` root, never the `/tsl` subpath.
- Keep pure logic apart from file I/O, as `tools/spec-ids.ts` and `tools/spec-files.ts` do, so tests run without touching the disk.
- `tools/hooks/` are Claude Code hooks. Internal errors fail open. Exit code 2 only blocks an edit. Test hook logic in a `*.test.ts` file next to it.
- Expose every tool as a root `package.json` script in the `<area>:<action>` form. Docs and agents use the root script name, not `pnpm exec tsx tools/<file>.ts`.
- Root script names (spec 011 and the registries): `assets:build`, `assets:check`, `assets:verify-rig`, `assets:licenses`, `assets:thumbnails`, `fixtures:build`, `docs:shortcuts`, `docs:nodes`, `site:sprites`, plus the existing `spec:check`, `spec:immutability`, `spec:trace`.
- Until a script is implemented for its milestone, it prints `not implemented (Mx)` and exits 0. Do not treat that exit code as a pass. Name the milestone in the message.
- Asset scripts read raw sources from `assets-src/` (gitignored, never committed) and per-pack config from `tools/packs/<packId>/pack.config.json`. They write optimized output to `assets/packs/<packId>/`. `assets:check` must run without `assets-src/`.
- Every built asset keeps its license, author and source URL in the manifest.
- `assets:verify-rig` is the M1 gate. Fail loudly with a readable report: missing or extra bones, bind-pose deltas, more than 4 influences per vertex.
- Asset builds are deterministic: single-threaded encoding, sorted iteration, no timestamps.
- Spec tooling: `pnpm spec:check`, `pnpm spec:immutability`, `pnpm spec:trace`. Hook logic lives in `tools/hooks/`.
