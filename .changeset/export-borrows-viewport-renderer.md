---
'@csg/web': patch
---

Export from Easy or Pro no longer hangs: the export borrows the mounted viewport's live renderer (`EngineHost.borrow`, REQ-EXP-017, REQ-UX-057) and falls back to a fresh lease when no viewport is mounted. The engine host frees its slot even if `dispose` throws, tells every queued lease about later requests through `onPreempt`, the home frame service releases on preempt in a hidden tab, and Space taps no longer swallow a focused button's click.
