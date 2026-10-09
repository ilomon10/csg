---
'@csg/engine': patch
---

Preview: `seek(t)` now inverts the playback timing, so `resume()` after a seek continues from the sought frame when the clip's fps differs from N / D, near the clip end, and in ping-pong (REQ-ANM-017, REQ-ANM-018). New pure helper `previewElapsedFor(timing, t)` in the renderer's preview clock. With "Show export frames" on, a ping-pong selection now previews frames `0..N-1` then `N-2..1` (REQ-ANM-010).
