---
'@csg/engine': patch
---

Engine tests (M3-17): the 16 Quaternius goldens (8 per backend) are regenerated in the canonical container for the sole-based grounding (REQ-ANA-008, issue #10). AC-PIX-008.1 is a normal test again, and AC-ANA-008.8 covers `superhero-m` and `superhero-f` on both backends. New goldens on both backends: the four look presets `classic-16bit`, `gameboy-4`, `nes-like` and `hi-bit` (AC-EDT-044.2) and the chibi style (`chibi-side-64`, `chibi-three-quarter-64`; AC-CMP-043.2). AC-CMP-041.3 and AC-CMP-043.1 compare pixel-exactly with the default golden. The perf suite adds M3 cases: preview with each look preset, the P-07 export through the export worker (AC-EXP-026.1), and look-preset, part-swap and style-change latency. These cases report only, unless `CSG_PERF_GATE=1`.
