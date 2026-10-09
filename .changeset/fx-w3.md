---
'@csg/web': patch
---

Recoverable preview errors (REQ-PIX-021, REQ-PIX-039, REQ-UX-031, REQ-UX-032): `PIX_PALETTE_LUT_FAILED` and `PIX_PREVIEW_FAILED` no longer turn a ready preview into the fatal error state. The controls stay enabled and a dismissable alert shows the code; `PIX_PREVIEW_FAILED` also offers Resume, which calls the renderer's `resume()`.
