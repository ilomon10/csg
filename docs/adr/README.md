# Architecture Decision Records

We use [MADR](https://adr.github.io/madr/)-style records. Each ADR captures one significant decision,
its context, consequences and the alternatives we rejected. The architecture overview lives in
[`../architecture.md`](../architecture.md).

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-3d-to-pixel-art-pipeline.md) | 3D modular models rendered through a pixel-art shader pipeline | Accepted | 2026-10-08 |
| [0002](0002-pnpm-monorepo-and-google-ts-style.md) | pnpm monorepo and Google TypeScript Style (gts) | Accepted | 2026-10-08 |
| [0003](0003-webgpu-renderer-and-tsl.md) | WebGPURenderer, TSL and RenderPipeline on pinned three r186 | Accepted | 2026-10-08 |
| [0004](0004-react-flow-for-node-graph-editor.md) | React Flow for the node graph editor, own graph model | Accepted | 2026-10-08 |
| [0005](0005-local-first-custom-model-upload.md) | Local-first custom model upload | Accepted | 2026-10-08 |
| [0006](0006-spec-driven-development.md) | Spec-driven development with EARS and stable IDs | Accepted | 2026-10-08 |
| [0007](0007-nextjs-fumadocs-website.md) | Next.js + Fumadocs website with Markdown in docs/guide | Accepted | 2026-10-08 |
| [0008](0008-shared-rig-skeleton-groups-runtime-retarget.md) | Shared rig with skeleton groups and runtime retargeting | Accepted | 2026-10-09 |

## Process

1. Copy [`template.md`](template.md) to `NNNN-short-title.md` (next free number, kebab-case).
2. Open a PR with status `Proposed`. Link affected specs.
3. On merge, set status `Accepted` and add the row above.
4. Never edit the decision of an accepted ADR. To change it, write a new ADR and mark the old one
   `Superseded by NNNN`. Numbers are never reused.
