---
'@csg/web': patch
---

Trusted Types and CSP hardening (REQ-GEN-010, REQ-GEN-014): the `csg-worker-url` policy is created first, with a build-time worker URL allowlist; the production CSP gains `trusted-types csg-worker-url`; the palette LUT worker starts through the policy. The preview gets a palette select, a fresh canvas per renderer session, registry cleanup on cancel and a relayout on devicePixelRatio change. `/packs` no longer follows symlinks and the dev server's `fs.allow` is narrowed.
