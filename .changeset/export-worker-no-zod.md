---
'@csg/engine': patch
'@csg/web': patch
---

Engine: the export worker no longer bundles Zod (REQ-GEN-015, AC-GEN-015.2; 150 KB down to 28 KB). The worker validates requests with hand-written structural checks (`readExportRequest`, `checkExportSettings`); the main-thread `createExportWorkerClient` parses settings, render settings and licenses with the parts-schema Zod schemas (`prepareExportRequest`) before posting. `ExportContext.render` is now the narrower `ExportRenderInfo`, which a full `RenderSettings` satisfies; `planFromGroups`, `measureGroups` and `emittedFrameCount` moved to `plan-core`. Web: the build writes a Vite manifest, and `import.meta.env.VITE_APP_VERSION` is defined from the package version.
