---
'@csg/engine': patch
'@csg/web': patch
---

Engine: `ClipPlayer.setClip` returns `Result<void, EngineError>`; assembly and renderer report retarget failures through that Result (a body switch whose skeleton the selected clip cannot retarget onto now fails and keeps the previous character). Calls on a disposed assembly or renderer, including ones in flight when `dispose()` runs, resolve to `ENGINE_DISPOSED` instead of throwing, and build nothing. New `resume()` continues preview playback from the paused or seek time without reloading the clip. Anatomy evaluation no longer allocates per frame, and root/pelvis vertical clip translation is measured along world up (rotated roots such as Quaternius, REQ-ANA-010). Web: the preview session checks cancellation after every await (one live renderer under StrictMode), shows start failures inline, Play after Pause resumes, and the packs middleware streams with error handling, explicit content types and `nosniff`.
