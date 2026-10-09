---
'@csg/web': patch
---

M3-18 QA fixes. New projects (wizard Finish, Start from this preset, share-link "open as new") start with the default clip selection idle then walk, so the first export is never empty (REQ-ANM-004, REQ-CMP-036). The Pro dock timeline drives the viewport through the shared viewport store (seek, play/pause, frame stepping) and has the "Show export frames" toggle (REQ-ANM-017, REQ-ANM-018). Scrollable dialog bodies are keyboard focusable. Easy "Reset tab" buttons carry the visible text in their accessible name (WCAG 2.5.3). The Pro Render tab shows the Look preset picker and every Look control once, with no duplicated Palette. The viewport stage exposes the palette LUT counters as `data-lut-*` (AC-GEN-014.1).
