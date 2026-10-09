---
'@csg/web': minor
---

Character viewport and home frames (`src/app/viewport`, `src/app/home-frames`): `CharacterViewport` (Easy, Pro and wizard variants, direction by drag, keys and buttons, Pixel/3D toggle behind an engine capability check, Idle/Walk, integer zoom, live screen reader summary), `EngineHost` with one live renderer lease, and `HomeFrameService` (cache key, yielding scheduler, visibility pause, at most 7 animated, avatar crop, validated IndexedDB persistence). The preview files moved from `src/app` to `src/app/viewport`.
