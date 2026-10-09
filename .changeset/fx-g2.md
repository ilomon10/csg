---
'@csg/engine': patch
---

`RESERVED_NON_UNIFORM_IDS` now lists `outline.inner.colorMode`, a `field` binding in the spec 007 reserved table, so `SettingsBinder.uniform` rejects it (REQ-SGF-041). Adds the AC-PIX-023.6 GPU test (texel alpha only drives the cutoff) and documents the AC-PIX-008.1 grounding root cause in the idle-grounding GPU test.
