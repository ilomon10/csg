---
'@csg/engine': minor
'@csg/web': patch
---

Engine: pure sprite sheet exporter in `src/export/` (spec 005): grid, strip and per-frame layouts, scales 1/2/4/8, padding, margin, power-of-two, `<base>` naming, Aseprite JSON, manifest, `CREDITS.txt`, licence warnings and the REQ-EXP-025 limits (`planExport`). Own deterministic PNG and ZIP writers (fixed zlib level, DOS time 1980, sorted entries, no extra fields) on `fflate` 0.8.3 (MIT). New `@csg/engine/export.worker` subpath plus `createExportWorkerClient` (host-created worker, validated replies, timeout, progress, cancel by terminate). Web: the export worker URL joins the Trusted Types allowlist.
