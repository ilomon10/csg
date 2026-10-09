---
'@csg/engine': minor
---

Palette LUT worker (REQ-GEN-014, REQ-GEN-016): the engine no longer constructs a `Worker` from a URL; the host injects a factory built from the new `@csg/engine/palette-lut.worker` subpath. Replies are validated, requests time out (5 s), failures reject instead of falling back to the main thread, `PaletteLutSource.stats` and `onBuild` report the build path, and the worker bundle no longer includes zod (128 kB to 13 kB).
