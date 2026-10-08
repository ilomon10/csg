# 0005. Local-first custom model upload

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect, asset pipeline engineer
- Related: spec 008 (custom upload, threat model); ADR-0001

## Context

Users want to bring their own characters and cosmetics: whole characters or single parts (rigged
or static). Files are untrusted and can be large or malformed. Users' assets may be private or
under licenses they must respect. Running a server for storage would add cost, privacy risk and
moderation duties to a volunteer project.

## Decision

- **No server.** Uploaded files never leave the device. Binaries go to OPFS, metadata
  (`UserAssetRecord`) to IndexedDB. The app requests `navigator.storage.persist()` and shows
  `storage.estimate()`.
- **Formats:** GLB/glTF (Draco, Meshopt, KTX2) and VRM (0.x and 1.0) are must-have. FBX
  (ASCII 7.0+ / binary 6400+) is beta with a "convert to GLB" recommendation. OBJ is static props
  only.
- **Untrusted-input handling:** size cap and magic-byte check on the main thread; parsing and
  `gltf-validator` in a Web Worker with a timeout; `LoadingManager.setURLModifier` allows only
  `blob:`/`data:` (no network fetches); budgets (tris, textures, bones, influences); sanitized
  names; no `innerHTML`; CSP `connect-src 'self'`.
- **Retargeting:** own retargeter with name-map presets (Mixamo, VRM humanoid, UE5), auto-map
  heuristics and a manual mapping UI; A/T-pose correction. `SkeletonUtils.retargetClip` is only a
  fallback. Weight transfer for foreign-rig clothing is out of scope.
- **Licensing UX:** license, author, source URL and a rights checkbox are required at upload.
  Exports always include `CREDITS.txt` and warn on unknown or non-commercial assets.

## Consequences

- Good: privacy by design; zero hosting cost; works offline once loaded.
- Good: user assets are first-class in the composer (`user:<uuid>` refs).
- Bad: no cross-device sync; clearing site data deletes uploads. Mitigation: project export
  bundles (spec 008/009 decide format) and clear warnings.
- Bad: share URLs cannot include user assets.
- Risk: parser vulnerabilities in loaders. Mitigation: worker isolation, validator first, budgets,
  timeouts, a malicious-fixture test suite, and security review (T13).
- Risk: browser storage quotas vary. Mitigation: estimate checks before writes, clear errors.

## Alternatives considered

- **Cloud storage with accounts**: enables sync and sharing, but needs a backend, auth, moderation
  and a privacy policy. Out of scope; could be a separate optional service later.
- **Parse on the main thread**: simpler, but malformed files can freeze the editor.
- **`SkeletonUtils.retargetClip` only**: less code, but known to twist Mixamo rigs.
- **Accept any format via server-side conversion (Assimp/Blender)**: contradicts no-server.
