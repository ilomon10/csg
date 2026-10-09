---
'@csg/parts-schema': patch
---

Turn Zod JIT off from the package entry so module-load parses (slot registry, default character) no longer trigger a CSP / Trusted Types violation from Zod's `new Function` probe.
