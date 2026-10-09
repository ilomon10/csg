---
'@csg/parts-schema': patch
'@csg/web': patch
---

Security review hardening (REQ-GEN-012, REQ-GEN-013). parts-schema: `findForbiddenKey` rejects shared references (cycles and DAGs), nesting deeper than 64 and more than 200,000 nodes; pack-relative preset paths reject `.` segments, `%`, `?` and `#`. Web: stored projects are checked against the 1 MB import limit on read and `sizeOf` can no longer hang or throw on hostile data; home-frames PNG headers are checked before decode; `TabMessage` is size-bounded before parsing; `theme-boot.js` honours the frame guard; the pack URL follows the deploy base path (`packsBaseUrl`); the three editor font packages are pinned again and the vendored files are hash-checked; an ESLint rule bans deep imports into `@csg/parts-schema/src`.
