---
'@csg/web': patch
---

The `#c=` share link is wired into the shell (REQ-CMP-034, REQ-CMP-035): decode, validate, confirm with Cancel focused, open as a new project, clear the fragment; invalid or oversized links show `CMP_SPEC_INVALID` and go home. The viewport recovers from a lost GPU device (REQ-UX-046): "Renderer restarting…", dispose, re-lease and re-apply the document, `PIX_BACKEND_UNAVAILABLE` after two failed attempts (detects `PIX_DEVICE_LOST` and WebGL `webglcontextlost`). Easy and Pro mark a tile `aria-busy` with a spinner while its part loads (REQ-UX-067, AC-CMP-004.2).
