---
'@csg/web': minor
---

Export feature (spec 005, spec 001 REQ-CMP-044): `ExportDialog` with the P1 settings, the `EXP_TOO_LARGE` refusal before any rendering, a blocking licence dialog per warning code, `aria-live` progress, cancel within 250 ms, one ZIP download through a Blob URL, a disabled reason for `CMP_STYLE_UNSUPPORTED` and a snapshot of the document at export start. `openExport()` opens it; the host passes the renderer lease, registry and worker factory (`ExportHostDeps`). The e2e build (`build:e2e`, `vite.e2e.config.ts`) adds a test-only host page; the production build is unchanged.
