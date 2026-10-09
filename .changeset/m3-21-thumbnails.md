---
'@csg/tools': patch
'@csg/engine': patch
---

`pnpm assets:thumbnails` renders 54 deterministic lossless WebP thumbnails (30 parts and 8 character presets at 128x128, 4 looks and 12 body shapes at 64x64) through the export pixel pipeline (WebGL2) in the pinned golden container, verifies them against a libwebp decode and installs them with a generated `thumbnails/index.json`. `assets:build` fills the manifest `thumbnail` field from the files, and `assets:check` counts shape thumbnails and the index as referenced, warns `AST_THUMBNAIL_MISSING` for a missing shape thumbnail, and warns `AST_THUMBNAIL_STALE` / `AST_THUMBNAIL_INVALID` (spec 011 REQ-AST-015, REQ-AST-039).
