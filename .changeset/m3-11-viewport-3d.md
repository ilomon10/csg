---
'@csg/web': minor
---

Character viewport 3D view (REQ-UX-003, REQ-UX-057, REQ-UX-058, REQ-CMP-043): the Pixel/3D toggle is live through the engine's `setViewMode`, dragging orbits in 3D (Pixel keeps the 45 degree direction steps), F and a Frame button call `frameCharacter()`, the canvas fills the stage at device pixels in 3D, and `CMP_STYLE_UNSUPPORTED` is shown as a persistent non-blocking notice from the engine's `onNotice`. The preview lab gets a 3D view toggle.
