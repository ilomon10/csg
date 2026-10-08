---
id: UPL
title: Custom model upload
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 004-animation, 005-export, 009-editor-shell-ux, 011-asset-pipeline]
last_updated: 2026-10-08
---

# 008 – Custom model upload

## Context

Users want to bring their own characters, cosmetics, props and animations. Uploaded files are
**untrusted input**: they can be malformed, huge or crafted to exploit decoders. They may also be
private or under licenses the user must respect. ADR-0005 decides the shape: no server, worker
parsing with validation first, budgets, own retargeter with bone-map presets, OPFS/IndexedDB
storage and a mandatory license form. This spec turns that into testable behavior, owns the
`UPL_*` error codes (architecture §3.6, §4.4) and holds the **threat model** (architecture §4.6).

Related: upload path in `docs/architecture.md` §2.2; contracts `UploadLimits`, `UploadAnalysis`,
`UserAssetRecord` (architecture §3.6); canonical skeleton and `RigDefinition` (spec 011, AST);
slots, sockets, tint slots (spec 001, CMP); clip library (spec 004, ANM); `CREDITS.txt` format and
license warnings (spec 005, EXP); shortcut registry, toasts and dialogs (spec 009, UX).

## Goals

- G1: Import GLB/glTF and VRM (0.x and 1.0) safely and locally; FBX and OBJ as beta.
- G2: Make uploads first-class in the composer as `user:<uuid>` assets.
- G3: Map foreign rigs to the shared skeleton with presets, auto-map and a manual UI, so built-in
  clips play on uploaded characters without visible twisting.
- G4: Never leak user files or trigger network requests, and never let a hostile file freeze or
  compromise the editor.
- G5: Record license data for every upload and carry it into `CREDITS.txt`.

## Non-goals

- NG1: Weight transfer, re-skinning or auto-rigging of meshes from foreign rigs (use Blender).
- NG2: Server-side storage, conversion or sharing of uploads (constitution P-03).
- NG3: Spring-bone / cloth physics simulation (exports stay deterministic, P-04).
- NG4: Editing meshes, UVs or textures inside the app.
- NG5: Formats other than those in REQ-UPL-001..003 (no USD, Blend, DAE, 3DS, STL).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to drop my Mixamo/VRoid character in and see it walk with the built-in clips | I can render sprites of my own hero |
| US-2 | P1 | pixel artist | to attach my own sword model to the hand socket and nudge it | my character holds the right weapon |
| US-3 | P1 | modder | rigged clothing made for the shared skeleton to equip like a built-in part | I can test parts before contributing them |
| US-4 | P1 | any user | clear, specific errors when a file is rejected | I know how to fix it in Blender |
| US-5 | P1 | any user | my uploads to stay on my device and be listed with their license | I stay private and credit authors correctly |
| US-6 | P2 | indie game dev | to upload extra animation clips (e.g. Mixamo FBX) | my sprite sheets include custom moves |
| US-7 | P2 | any user | to export/import my library as one zip | I can move it to another browser or back it up |

## Requirements

### Formats, kinds and entry points

**REQ-UPL-001 [P1]** THE SYSTEM SHALL accept GLB (`.glb`), multi-file glTF 2.0 (`.gltf` + `.bin`
+ images) and VRM 0.x / 1.0 (`.vrm`) files, including the `KHR_draco_mesh_compression`,
`EXT_meshopt_compression` and `KHR_texture_basisu` (KTX2) extensions.

- **AC-UPL-001.1** Given fixtures `cube.glb`, `cube-multi.gltf` (+`.bin`+`.png`), `draco.glb`, `meshopt.glb`, `ktx2.glb`, `vrm0.vrm` and `vrm1.vrm`, When each is uploaded, Then analysis succeeds and `UploadAnalysis.format` is `glb`, `gltf`, `glb`, `glb`, `glb`, `vrm0` and `vrm1` respectively.
- **AC-UPL-001.2** Given a glTF 1.0 file, When it is uploaded, Then it is rejected with `UPL_UNSUPPORTED_FORMAT`.

**REQ-UPL-002 [P2]** WHERE FBX import is enabled THE SYSTEM SHALL accept FBX binary version ≥ 6400 and FBX ASCII version ≥ 7.0, label the result "Beta", and show the notice "FBX support is in beta. For best results convert to GLB in Blender."

- **AC-UPL-002.1** Given a binary FBX 7400 fixture with a skinned mesh, When uploaded, Then analysis succeeds, `format` is `fbx` and the Beta notice is visible in the wizard.
- **AC-UPL-002.2** Given a binary FBX 6100 fixture, When uploaded, Then it is rejected with `UPL_FBX_VERSION`.

**REQ-UPL-003 [P2]** THE SYSTEM SHALL accept OBJ (`.obj` with optional `.mtl` and textures) only as the static-prop kind.

- **AC-UPL-003.1** Given `sword.obj` + `sword.mtl` + `sword.png`, When uploaded, Then `kind` is `static-part` and the kind selector offers no other kind.

**REQ-UPL-004 [P1]** THE SYSTEM SHALL offer three entry points to start an upload: an "Upload" button in the part library (file picker), dropping files or a folder anywhere on the editor window (a full-window drop overlay labelled "Drop to upload" appears while dragging), and the command-palette command "Upload model…" (spec 009).

- **AC-UPL-004.1** Given the editor, When a GLB is dropped on the viewport, Then the upload wizard opens at the analysis step with that file.
- **AC-UPL-004.2** Given keyboard-only use, When the user activates "Upload" with Enter, Then the native file picker opens with `accept` listing `.glb,.gltf,.vrm,.bin,.png,.jpg,.jpeg,.webp,.ktx2` plus `.fbx,.obj,.mtl` when those formats are enabled (WCAG 2.5.7: drag-drop is never the only way).

**REQ-UPL-005 [P1]** WHEN the user picks several files or drops a folder THE SYSTEM SHALL treat them as one upload session, choose the single `.gltf`/`.glb`/`.vrm`/`.fbx`/`.obj` as the root, and resolve the root's relative URIs only against the files in that session (path-normalized, case-sensitive, no `..` escaping the session root).

- **AC-UPL-005.1** Given a dropped folder `hero/` with `hero.gltf`, `hero.bin`, `tex/skin.png`, When uploaded, Then the URI `tex/skin.png` resolves to the dropped file and analysis succeeds.
- **AC-UPL-005.2** Given a folder with two root model files, When uploaded, Then the user is asked to pick one root (or upload each separately) and nothing is analyzed until they choose.
- **AC-UPL-005.3** Given a `.gltf` whose image URI is `../secret.png`, When uploaded, Then it is rejected with `UPL_EXTERNAL_URI`.
- **AC-UPL-005.4** Given a `.gltf` that references `hero.bin` which was not selected, When uploaded, Then it is rejected with `UPL_MISSING_RESOURCE` naming `hero.bin`.

**REQ-UPL-006 [P1]** WHEN analysis completes THE SYSTEM SHALL propose one upload kind — whole character, rigged part, static prop or animation clip(s) — using the rules in *Kind detection* below, and let the user override it within the budgets of the chosen kind.

- **AC-UPL-006.1** Given a skinned humanoid fixture with 15 required bones mapped and 20k tris, When analyzed, Then the proposed kind is `character`.
- **AC-UPL-006.2** Given a skinned mesh of 3k tris whose skin uses only arm bones, When analyzed, Then the proposed kind is `skinned-part`.
- **AC-UPL-006.3** Given a file with no skin, When analyzed, Then the proposed kind is `static-part`.
- **AC-UPL-006.4** Given a file with a skeleton and animations but no mesh, When analyzed, Then the proposed kind is `clip`.
- **AC-UPL-006.5** Given a 20k-tri skinned mesh, When the user overrides the kind to `skinned-part`, Then the wizard shows `UPL_BUDGET_TRIS` (limit 10,000) and blocks saving.

Kind detection (in order): no mesh but ≥ 1 animation → `clip`; no skin → `static-part`; skin
whose bone map covers all 15 required bones (REQ-UPL-021) and whose mesh spans ≥ 80 % of the
skeleton height → `character`; otherwise → `skinned-part`.

### Validation pipeline

Stages run in this order; a stage failure stops later stages. Within the budget stage, **all**
violations are collected and reported together.

1. Main thread: flush pending autosave, then pre-check (REQ-UPL-009, -007, -008).
2. Worker: JSON size check → JSON parse with prototype-key rejection (REQ-GEN-011) → structural
   limits (REQ-UPL-012) → `gltf-validator` (REQ-UPL-010) → header-only budget estimate
   (REQ-UPL-012, -013) → parse with network-blocking URL modifier (REQ-UPL-011) → exact budgets →
   name sanitization (REQ-UPL-014) → rig analysis and suggested bone map → normalization to GLB
   (REQ-UPL-052).
3. UI: kind, fitting/mapping, materials, license, save.

Security review 2026-10-08 amended REQ-UPL-009, -011, -012, -013, -014, -042 and -045 in place
and added REQ-UPL-052..054.

**REQ-UPL-007 [P1]** BEFORE any bytes are parsed THE SYSTEM SHALL check on the main thread that every file extension is on the allowlist (REQ-UPL-004), the session has ≤ 64 files, and the total session size is ≤ 50 MB (52,428,800 bytes).

- **AC-UPL-007.1** Given a 50 MB + 1 byte GLB, When dropped, Then `UPL_TOO_LARGE` is shown within 100 ms and no worker is started.
- **AC-UPL-007.2** Given a folder with 65 files, When dropped, Then `UPL_TOO_MANY_FILES` is shown.
- **AC-UPL-007.3** Given `model.exe` renamed to `model.dae`, When dropped, Then `UPL_UNSUPPORTED_FORMAT` is shown.

**REQ-UPL-008 [P1]** THE SYSTEM SHALL verify each file's leading bytes against the magic-byte table below and reject a mismatch with `UPL_MAGIC_MISMATCH`, regardless of extension or MIME type.

| Type | Check |
|------|-------|
| GLB / VRM | bytes 0–3 = `67 6C 54 46` (`glTF`), uint32 LE version at 4 = 2, uint32 LE length at 8 = file size |
| glTF JSON | first non-whitespace byte after an optional UTF-8 BOM is `{`; file is valid UTF-8 |
| `.bin` | no magic; its byte length must equal the referencing `buffers[i].byteLength` (checked in worker) |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| WebP | `RIFF` at 0 and `WEBP` at 8 |
| KTX2 | `AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A` |
| FBX binary | `Kaydara FBX Binary  \x00` (21 bytes) |
| FBX ASCII | first 1 KB valid UTF-8 and contains `FBXHeaderExtension` or starts with `; FBX` |
| OBJ / MTL | first 4 KB valid UTF-8 with no NUL bytes |

- **AC-UPL-008.1** Given a PNG renamed `model.glb`, When dropped, Then `UPL_MAGIC_MISMATCH` is shown naming `model.glb`.
- **AC-UPL-008.2** Given a GLB whose header length field differs from the file size, When dropped, Then `UPL_MAGIC_MISMATCH` is shown.

**REQ-UPL-009 [P1]** THE SYSTEM SHALL validate and parse model bytes only inside a dedicated Web Worker, and IF analysis has not finished within 20 s THEN THE SYSTEM SHALL terminate the worker and report `UPL_TIMEOUT`. *Amended (security review 2026-10-08):* WHEN an upload or library/bundle import is started THE SYSTEM SHALL first flush any pending autosave (spec 009) and start the worker only after the flush has completed or failed, so a crash during analysis cannot lose edits.

- **AC-UPL-009.1** Given a fixture that makes the loader loop forever (test hook), When uploaded, Then after 20 s ± 0.5 s the worker is terminated, `UPL_TIMEOUT` is shown, and the editor stays responsive (no main-thread task > 50 ms during the wait).
- **AC-UPL-009.2** Given a worker that throws or crashes, When the error event fires, Then `UPL_WORKER_CRASHED` is shown and a fresh worker is used for the next upload.
- **AC-UPL-009.3** Given an edit made 100 ms before a GLB is dropped (autosave debounce still pending), When the upload starts, Then the autosave write completes before the worker is created (event order asserted), and after a forced tab crash during analysis the reloaded editor contains that edit.
- **AC-UPL-009.4** Given an autosave flush that fails (mocked storage error), When the upload starts, Then the autosave error from spec 009 is shown and analysis still runs.

**REQ-UPL-010 [P1]** THE SYSTEM SHALL run `gltf-validator` (`validateBytes`, with an `externalResourceFunction` that resolves only session files) on every glTF/GLB/VRM before any three.js loader touches it, reject on any validator error with `UPL_VALIDATOR_ERROR`, and list validator warnings (max 50 shown, total count displayed) without blocking.

- **AC-UPL-010.1** Given a GLB with an accessor out of buffer bounds, When uploaded, Then `UPL_VALIDATOR_ERROR` is shown with the validator issue code and JSON pointer, and the loader is never invoked (spy asserts 0 calls).
- **AC-UPL-010.2** Given a GLB with 120 validator warnings, When analyzed, Then 50 warnings and the text "120 warnings" are shown and saving is allowed.

**REQ-UPL-011 [P1]** THE SYSTEM SHALL make no network request while loading an upload: the loader's URL modifier allows only `blob:` and `data:` URLs, and IF a file references an absolute URI (`http:`, `https:`, `file:`, `//…`, or any other scheme) THEN THE SYSTEM SHALL reject the file with `UPL_EXTERNAL_URI`. *Amended (security review 2026-10-08):* the URL modifier allows only (a) `blob:` URLs that this upload session created (tracked in a session set) and (b) `data:` URLs whose MIME type (case-insensitive, parameters ignored) is one of `application/octet-stream`, `application/gltf-buffer`, `image/png`, `image/jpeg`, `image/webp`, `image/ktx2`; any other URL is rejected with `UPL_EXTERNAL_URI`. Every `Blob` the upload code creates SHALL be constructed with an explicit MIME type from that list (or `application/zip` for downloads), and no upload-derived `blob:` or `data:` URL is ever used as a navigation target, `window.open` argument, or `<iframe>`/`<object>`/`<embed>` source (downloads use `<a download>` only).

- **AC-UPL-011.1** Given a glTF whose image URI is `https://example.com/x.png`, When uploaded, Then `UPL_EXTERNAL_URI` is shown and the recorded network log contains no request to `example.com` (REQ-GEN-003).
- **AC-UPL-011.2** Given an E2E run uploading every valid fixture, When network requests are recorded, Then none target a host other than the app origin and none carry file bytes.
- **AC-UPL-011.3** Given Draco/Meshopt/KTX2 decoders, When an upload needs them, Then they load from the app's own origin (bundled, version-pinned, hash-checked at build per REQ-GEN-010), never from a CDN.
- **AC-UPL-011.4** Given a `.gltf` whose image URI is `data:text/html;base64,PHNjcmlwdD4=`, When uploaded, Then `UPL_EXTERNAL_URI` is shown and nothing is decoded.
- **AC-UPL-011.5** Given a `.gltf` whose buffer URI is a `blob:<app-origin>/<uuid>` URL that this session did not create, When uploaded, Then `UPL_EXTERNAL_URI` is shown.
- **AC-UPL-011.6** Given the upload and library source, When the lint/unit check runs, Then every `new Blob(` call passes a `type` from the allowlist, and 0 calls assign an upload-derived URL to `location`, `window.open`, `iframe.src`, `object.data` or `embed.src`.

**REQ-UPL-012 [P1]** THE SYSTEM SHALL enforce the budgets below, estimating them from glTF JSON headers (accessor counts, image headers) **before** decompressing geometry or decoding images, and re-checking exact values after parse.

| Budget | Character | Rigged part | Static prop | Clip file | Error code |
|--------|-----------|-------------|-------------|-----------|-----------|
| Triangles (all meshes, after decode) | ≤ 50,000 | ≤ 10,000 | ≤ 10,000 | n/a | `UPL_BUDGET_TRIS` |
| Textures (distinct images) | ≤ 8 | ≤ 8 | ≤ 8 | n/a | `UPL_BUDGET_TEXTURES` |
| Texture size (either side) | ≤ 2048 px | ≤ 2048 px | ≤ 2048 px | n/a | `UPL_TEXTURE_TOO_LARGE` |
| Bones (joints in all skins) | ≤ 128 | ≤ 128 | 0 used | ≤ 128 | `UPL_BUDGET_BONES` |
| Influences per vertex | 4 (extra pruned, REQ-UPL-031) | 4 | n/a | n/a | warning `UPL_W_INFLUENCES_PRUNED` |
| Materials | ≤ 16 | ≤ 16 | ≤ 16 | n/a | `UPL_BUDGET_MATERIALS` |
| Morph targets | ≤ 64 | ≤ 64 | ≤ 64 | n/a | `UPL_BUDGET_MORPHS` |
| Clips / max clip length | — | — | — | ≤ 64 / ≤ 120 s | `UPL_BUDGET_CLIPS` |
| Estimated decoded memory (geometry + RGBA textures + keyframes) | ≤ 256 MB | ≤ 256 MB | ≤ 256 MB | ≤ 256 MB | `UPL_MEMORY_ESTIMATE` |

- **AC-UPL-012.1** Given a Draco GLB whose accessors declare 2,000,000 vertices, When analyzed, Then `UPL_MEMORY_ESTIMATE` (or `UPL_BUDGET_TRIS`) is reported and the Draco decoder is never called.
- **AC-UPL-012.2** Given a character fixture with 50,001 tris and 9 textures, When analyzed, Then both `UPL_BUDGET_TRIS` and `UPL_BUDGET_TEXTURES` are listed in one report.
- **AC-UPL-012.3** Given a character with exactly 50,000 tris, 8 textures of 2048², 128 bones, When analyzed, Then no budget error is reported.

*Amended (security review 2026-10-08):* THE SYSTEM SHALL also enforce the structural limits
below right after the glTF JSON is parsed and **before** `gltf-validator` runs, reporting every
violation together as `UPL_STRUCTURE_LIMIT`. The JSON size limit is checked before parsing.

| Structural limit | Value | Notes |
|------------------|-------|-------|
| JSON chunk (GLB chunk 0 length, or `.gltf` file size) | ≤ 8 MB (8,388,608 bytes) | includes embedded `data:` URIs; larger embedded `.gltf` must be exported as GLB |
| `nodes` | ≤ 10,000 | |
| `accessors` | ≤ 20,000 | |
| animation channels (sum over `animations[].channels`) | ≤ 8,192 | |
| total keyframes (sum of `count` of every sampler `input` accessor) | ≤ 2,000,000 | |
| any JSON string value | ≤ 4,096 UTF-16 code units | `uri` values that are `data:` URIs are exempt |
| any `name` value | truncated to 256 code units **before** REQ-UPL-014 sanitization | |

The worker's `UploadAnalysis` message (structured-clone payload, excluding transferred
`ArrayBuffer`s) SHALL be ≤ 2 MB (2,097,152 bytes) measured as UTF-8 JSON, with list fields capped
(warnings and validator issues ≤ 50 each plus a total count, bones ≤ 128, clips ≤ 64, materials
≤ 16, names ≤ 64 chars). The main thread validates the message against the `UploadAnalysis` schema
and rejects an oversized or invalid message with `UPL_WORKER_CRASHED`.

- **AC-UPL-012.4** Given a GLB whose JSON chunk header declares 8,388,609 bytes, When analyzed, Then `UPL_STRUCTURE_LIMIT` is reported, `JSON.parse` is never called (spy) and `gltf-validator` is never called.
- **AC-UPL-012.5** Given a 150 KB generated GLB with 10,001 nodes, 20,001 accessors and 8,193 animation channels, When analyzed, Then one report lists all three `UPL_STRUCTURE_LIMIT` violations and `validateBytes` was never called; with 10,000 / 20,000 / 8,192 the structural stage passes.
- **AC-UPL-012.6** Given sampler input accessors whose `count` values sum to 2,000,001, When analyzed, Then `UPL_STRUCTURE_LIMIT` names "2,000,000 keyframes" before any accessor data is read.
- **AC-UPL-012.7** Given an `extras` string of 4,097 characters, When analyzed, Then `UPL_STRUCTURE_LIMIT` is reported; Given a 1 MB `data:application/octet-stream` buffer URI, Then no string-length error is reported.
- **AC-UPL-012.8** Given a node name of 4,000 characters, When analyzed, Then the sanitizer receives at most 256 code units (spy) and the shown name has ≤ 64 characters.
- **AC-UPL-012.9** Given a test hook that makes the worker post a 2,097,153-byte analysis message, When the main thread receives it, Then `UPL_WORKER_CRASHED` is shown and nothing from the message is rendered.

**REQ-UPL-013 [P1]** THE SYSTEM SHALL read image dimensions from file headers before decoding, accept only PNG, JPEG, WebP and KTX2 images (reject others, including SVG and GIF, with `UPL_UNSUPPORTED_FORMAT`), and downscale any accepted texture larger than 1024 px on a side to fit 1024 px (aspect kept, nearest-power-of-two not required) in the normalized GLB.

- **AC-UPL-013.1** Given a PNG header declaring 30000×30000 in a 40 KB file, When analyzed, Then `UPL_TEXTURE_TOO_LARGE` is reported and the image is never decoded.
- **AC-UPL-013.2** Given a 2048×1024 texture, When the asset is saved, Then the stored GLB contains it at 1024×512.
- **AC-UPL-013.3** Given an embedded `image/svg+xml` image, When analyzed, Then `UPL_UNSUPPORTED_FORMAT` is reported.

*Amended (security review 2026-10-08):* THE SYSTEM SHALL also reject, from headers and before
decoding, with `UPL_UNSUPPORTED_FORMAT`: KTX2 images with `layerCount` > 1, `faceCount` ≠ 1,
`pixelDepth` ≠ 0, or `levelCount` greater than `floor(log2(max(pixelWidth, pixelHeight))) + 1`;
animated PNG (an `acTL` chunk before the first `IDAT`); and animated WebP (`VP8X` with the
animation flag set, or any `ANIM`/`ANMF` chunk).

- **AC-UPL-013.4** Given four KTX2 fixtures with `layerCount` 2, `faceCount` 6, `pixelDepth` 4, and a 256×256 image declaring `levelCount` 10, When analyzed, Then each is rejected with `UPL_UNSUPPORTED_FORMAT` and the Basis transcoder is never called; a 256×256 image with `levelCount` 9 passes.
- **AC-UPL-013.5** Given an APNG texture and an animated WebP texture, When analyzed, Then each is rejected with `UPL_UNSUPPORTED_FORMAT` and never decoded.

**REQ-UPL-014 [P1]** THE SYSTEM SHALL sanitize every file, node, mesh, bone, material, clip and morph name to `[A-Za-z0-9_.:-]{1,64}` (disallowed characters → `_`, truncated to 64, empty → `unnamed`, duplicates suffixed `_2`, `_3` …) and SHALL render all upload-derived text only as text nodes (never `innerHTML` or `dangerouslySetInnerHTML`).

- **AC-UPL-014.1** Given a node named `<img src=x onerror=alert(1)>`, When analyzed and shown in the mapping UI, Then the displayed name is `_img_src_x_onerror_alert_1__` and no script runs (E2E asserts no dialog event).
- **AC-UPL-014.2** Given bones `Bip01 L Thigh` and `Bip01_L_Thigh`, When sanitized, Then they become `Bip01_L_Thigh` and `Bip01_L_Thigh_2`, and the stored bone map uses these names consistently.
- **AC-UPL-014.3** Given the `apps/web` source, When lint runs, Then any use of `dangerouslySetInnerHTML` or `innerHTML` in `features/upload/**` fails the build.

*Amended (security review 2026-10-08):* a sanitized name equal to `__proto__`, `constructor` or
`prototype` SHALL get the suffix `_` (before duplicate suffixing). Contract: all name-keyed data
built from upload names (bone maps, `BoneMapPreset.map`, material and clip lookups) SHALL be a
`Map` or an object created with `Object.create(null)`, never a plain `{}` literal.

- **AC-UPL-014.4** Given bones named `__proto__`, `constructor` and `prototype`, When sanitized, Then they become `__proto___`, `constructor_` and `prototype_`, the bone map round-trips through save/load, and `({}).polluted` stays `undefined`.
- **AC-UPL-014.5** Given the Mixamo fixture's analysis result and its record after a save/load round trip, When a unit test inspects every in-memory name-keyed container (bone map, preset map, material and clip lookups), Then each is a `Map` or has `Object.getPrototypeOf(x) === null` (0 plain objects).

**REQ-UPL-015 [P1]** WHEN an upload fails THE SYSTEM SHALL show, inside the wizard, the error code, the user message from the *Error codes* table (with placeholders filled), and a "How to fix" hint, and SHALL NOT show a stack trace.

- **AC-UPL-015.1** Given each error code in the table, When its fixture (or test hook) triggers it, Then the wizard shows exactly the tabled message with placeholders filled and the code in monospace, and the message string comes from the i18n catalog key `upl.error.<CODE>`.

**REQ-UPL-016 [P1]** WHEN the user cancels the wizard at any step THE SYSTEM SHALL abort analysis (terminating the worker if running), revoke all `blob:` URLs created for the session, and persist nothing.

- **AC-UPL-016.1** Given analysis in progress, When the user presses Escape and confirms, Then the worker is terminated within 100 ms, OPFS and IndexedDB contain no new entries, and `URL.revokeObjectURL` was called for every created URL.

### Bone mapping and retargeting

The canonical skeleton is the shared rig defined in spec 011 (`RigDefinition`, provisional id
`quaternius-ue5-65`, bone names like `pelvis`, `spine_01..03`, `neck_01`, `head`, `clavicle_l`,
`upperarm_l`, `lowerarm_l`, `hand_l`, `thigh_l`, `calf_l`, `foot_l`, `ball_l`).
[NEEDS CLARIFICATION: final canonical names depend on the M1 rig spike; this spec uses the
provisional names above.]

**REQ-UPL-017 [P1]** THE SYSTEM SHALL ship bone-map presets for Mixamo (`mixamorig:` prefix stripped), VRM humanoid (0.x and 1.0 normalized bone names) and UE5 Mannequin, and SHALL select the preset whose names match the most source bones (minimum 60 % of the 15 required bones) as `detectedRig`.

- **AC-UPL-017.1** Given the Mixamo fixture, When analyzed, Then `detectedRig` is `mixamo` and `Hips→pelvis`, `Spine→spine_01`, `Spine1→spine_02`, `Spine2→spine_03`, `LeftArm→upperarm_l`, `LeftForeArm→lowerarm_l`, `LeftUpLeg→thigh_l`, `LeftLeg→calf_l` are mapped with confidence 1.0.
- **AC-UPL-017.2** Given a VRM 1.0 fixture, When analyzed, Then `detectedRig` is `vrm` and the mapping comes from the VRM humanoid extension (not from node names).
- **AC-UPL-017.3** Given a file already using canonical names with matching bind pose, When analyzed, Then `detectedRig` is `builtin` and no mapping step is shown.

**REQ-UPL-018 [P1]** IF no preset reaches the threshold or bones remain unmapped THEN THE SYSTEM SHALL auto-map the rest by: (1) normalizing names (lowercase; strip namespace prefixes before `:` or `|`; strip `_`, `-`, `.`, spaces; unify side tokens `left/l/lft/_l/.l` → `l` and `right/r/rt` → `r`), (2) looking up an alias dictionary (e.g. `hips/pelvis/root_hips`, `upperleg/thigh/upleg`), (3) topology fallback (root-most bone with ≥ 3 children = `pelvis`; longest chain from pelvis upward = spine→neck→head; limb side from the sign of rest-pose X; limb segments by chain order).

- **AC-UPL-018.1** Given a fixture with bones `Bip001 Pelvis`, `Bip001 L Thigh`, `Bip001 L Calf` …, When analyzed, Then those map to `pelvis`, `thigh_l`, `calf_l` via the alias step.
- **AC-UPL-018.2** Given a fixture whose bones are named `b0..b20` in a humanoid hierarchy, When analyzed, Then all 15 required bones are mapped via topology, each with confidence 0.5.

**REQ-UPL-019 [P1]** THE SYSTEM SHALL assign each mapped bone a confidence — preset or VRM extension 1.0, alias dictionary 0.9, normalized fuzzy match 0.7, topology 0.5 — and display it as High (≥ 0.9), Medium (0.6–0.89) or Low (< 0.6) with text and icon, never color alone.

- **AC-UPL-019.1** Given the topology fixture of AC-UPL-018.2, When the mapping step renders, Then every required row shows the label "Low" and a warning icon with an accessible name.

**REQ-UPL-020 [P1]** THE SYSTEM SHALL provide a manual mapping UI listing every canonical bone (grouped Spine/Head, Left arm, Right arm, Left leg, Right leg, Optional) with a searchable select of source bones, a highlight of the selected bone on the 3D preview, and "Reset to auto" and "Clear" actions, all keyboard operable.

- **AC-UPL-020.1** Given the mapping step, When the user tabs to `hand_l`, opens the select with Enter, types `wrist` and picks `LeftWrist`, Then the map updates, confidence becomes "Manual" (1.0), and the 3D preview highlights `LeftWrist`.
- **AC-UPL-020.2** Given one source bone already mapped to `hand_l`, When the user maps it to `hand_r` too, Then the UI warns "LeftWrist is already mapped to hand_l" and requires confirmation.

**REQ-UPL-021 [P1]** IF any of the 15 required canonical bones (`pelvis`, `spine_01`, `head`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r`, `thigh_l/r`, `calf_l/r`, `foot_l/r`) is unmapped for a character or clip upload THEN THE SYSTEM SHALL block saving with `UPL_BONE_MAP_INCOMPLETE` listing the missing bones; optional bones (`spine_02`, `spine_03`, `neck_01`, clavicles, `ball_*`, fingers) MAY stay unmapped and are then not animated.

- **AC-UPL-021.1** Given a map missing `foot_r`, When the user presses Save, Then saving is blocked and the message names `foot_r`.

**REQ-UPL-022 [P1]** THE SYSTEM SHALL classify the source rest pose from the upper-arm angle below horizontal (≤ 15° → `T`, 25°–60° → `A`, otherwise `unknown`) and correct the rest pose by aligning each mapped arm and leg bone's rest direction to the canonical rest pose before computing retarget offsets.

- **AC-UPL-022.1** Given A-pose (45°) and T-pose fixtures of the same character, When the built-in `idle` clip is retargeted to each, Then per-bone world directions of the mapped limb bones differ by ≤ 3° between the two at frames 0, 10 and 20.
- **AC-UPL-022.2** Given `restPose` is `unknown`, When the mapping step renders, Then a notice asks the user to confirm "Treat as T-pose" or "Treat as A-pose" before preview.

**REQ-UPL-023 [P1]** THE SYSTEM SHALL retarget with the project retargeter: for each mapped bone, `targetLocal = targetRest · inverse(sourceRest) · sourceAnimLocal` evaluated in world space, with hip translation scaled by the target/source leg-length ratio; `SkeletonUtils.retargetClip` is used only when the user selects "Compatibility retarget" in advanced options.

- **AC-UPL-023.1** Given the Mixamo and VRM fixtures, When built-in `walk` is retargeted, Then for every mapped limb bone the world direction error vs the reference pose is ≤ 5° at 8 sampled frames, and golden images at 64 px match (architecture M5).
- **AC-UPL-023.2** Given a source with legs 2× longer than the canonical rig, When `walk` is retargeted, Then the pelvis horizontal travel per loop is 2× the canonical travel (± 2 %).

**REQ-UPL-024 [P1]** WHILE the mapping step is open THE SYSTEM SHALL preview the uploaded rig playing a test animation (default `walk`, selectable from `idle`, `walk`, `run`, `attack-1`) next to the built-in reference character, in both 3D and pixel view (spec 009), updating within 500 ms of a mapping change.

- **AC-UPL-024.1** Given the mapping step, When the user changes `lowerarm_l`, Then the preview reflects the new mapping within 500 ms.
- **AC-UPL-024.2** Given `prefers-reduced-motion: reduce`, When the step opens, Then the preview starts paused with a visible Play button.

**REQ-UPL-025 [P3]** THE SYSTEM SHALL let the user save a manual bone map as a named user preset (stored in IndexedDB) and apply it to later uploads.

- **AC-UPL-025.1** Given a saved preset "MyRig", When a file with the same bone names is uploaded, Then "MyRig" is offered and applying it maps all bones at confidence 1.0.

### Static prop fitting

**REQ-UPL-026 [P1]** WHEN a static prop is uploaded THE SYSTEM SHALL ask for a category and pre-fill slot, socket and offset from the defaults below; the user can choose any socket (`hand_r`, `hand_l`, `head`, `spine_03`, `pelvis`).

| Category | Slot | Socket | Default offset (pos m / rotDeg / scale) |
|----------|------|--------|------------------------------------------|
| One-hand weapon | `prop-main-hand` | `hand_r` | [0, 0.02, 0] / [0, 0, -90] / 1 |
| Two-hand weapon | `prop-main-hand` | `hand_r` | [0, 0.02, 0] / [0, 0, -90] / 1 |
| Shield / off-hand | `prop-off-hand` | `hand_l` | [0, 0, 0.05] / [0, 90, 0] / 1 |
| Headwear | `headwear` | `head` | [0, 0.12, 0] / [0, 0, 0] / 1 |
| Back item | `back` | `spine_03` | [0, 0, -0.15] / [0, 0, 0] / 1 |
| Belt / hip item | `accessory` | `pelvis` | [0.12, 0, 0] / [0, 0, 0] / 1 |
| Other | `accessory` | `hand_r` | [0, 0, 0] / [0, 0, 0] / 1 |

Before applying the default, the prop is auto-scaled so its bounding-box height is plausible for the
category (one-hand 0.4–1.2 m, shield 0.4–0.9 m, headwear 0.1–0.4 m; else unchanged) and its pivot is
moved to the bounding-box centre (headwear: bottom centre).
[NEEDS CLARIFICATION: default offsets above assume canonical bone axes; confirm after the M1 rig spike.]

- **AC-UPL-026.1** Given a 10 m long sword OBJ, When category "One-hand weapon" is chosen, Then it is scaled to 1.2 m, attached to `hand_r` with the tabled offset.

**REQ-UPL-027 [P1]** WHILE the fitting step is open THE SYSTEM SHALL show a translate/rotate/scale gizmo on the prop (engine `attachGizmo`), switchable with W (translate), E (rotate), R (scale) in the `prop-fitting` shortcut scope (spec 009), with Shift snapping to 0.01 m / 15° / 0.1×.

- **AC-UPL-027.1** Given the fitting step with focus in the viewport, When the user presses E, Then the gizmo switches to rotate and the global R "Randomize" binding does not fire while the scope is active.

**REQ-UPL-028 [P1]** THE SYSTEM SHALL offer numeric fields for position (−2 to 2 m, step 0.001), rotation (−180° to 180°, step 1) and scale (uniform by default, 0.01 to 100, step 0.01), kept in sync with the gizmo, as the keyboard-accessible alternative to dragging (WCAG 2.5.7).

- **AC-UPL-028.1** Given the gizmo moved by dragging, When the drag ends, Then the numeric fields show the new values rounded to the field step, and typing a value moves the prop on the next frame.
- **AC-UPL-028.2** Given scale field input 0, When committed, Then it clamps to 0.01 and shows "Minimum 0.01".

**REQ-UPL-029 [P2]** WHEN the user re-fits an equipped prop for one character THE SYSTEM SHALL store the override in that character's `PartSelection.socket` and leave the library default unchanged unless the user picks "Save as default".

- **AC-UPL-029.1** Given a prop equipped on two characters, When one is re-fitted without "Save as default", Then the other's offset is unchanged.

### Rigged parts and whole characters

**REQ-UPL-030 [P1]** WHEN a rigged part is uploaded THE SYSTEM SHALL rebind it to the shared skeleton only if every bone that carries non-zero skin weight maps to a canonical bone and each such bone's bind pose matches the canonical bind pose within 1 % of skeleton height (position) and 5° (rotation); IF not THEN THE SYSTEM SHALL reject with `UPL_BIND_POSE_MISMATCH` (or `UPL_BONE_MAP_INCOMPLETE`) and never attempt weight transfer.

- **AC-UPL-030.1** Given a part built on the canonical rig, When uploaded, Then it rebinds and deforms identically to a built-in part (golden image).
- **AC-UPL-030.2** Given a Mixamo-rigged shirt, When uploaded as a part for the built-in body, Then `UPL_BIND_POSE_MISMATCH` lists the worst 5 bones with deltas, and the hint reads "Re-skin this part to the base skeleton in Blender (see guide: Custom parts)".

**REQ-UPL-031 [P1]** THE SYSTEM SHALL, for rigged uploads, keep the 4 largest influences per vertex (dropping the rest and reporting `UPL_W_INFLUENCES_PRUNED` with the vertex count) and renormalize weights whose sum deviates from 1 by more than 0.001.

- **AC-UPL-031.1** Given a fixture with 8 influences on 300 vertices, When analyzed, Then the warning states 300 vertices were pruned and every stored vertex weight sum is 1 ± 1e-4.

**REQ-UPL-032 [P1]** WHEN a whole character is saved THE SYSTEM SHALL register it as a `body`-slot part whose rig is the uploaded skeleton plus its bone map, play built-in and user clips on it through the retargeter, drive anatomy sliders through mapped bones (spec 002), and treat built-in skinned parts as incompatible (reason `rig`, REQ-CMP-008/009, text "Made for the base skeleton") unless the bind poses match per REQ-UPL-030.

- **AC-UPL-032.1** Given an uploaded Mixamo character equipped as body, When the user opens the Torso slot with "Show incompatible" on, Then built-in skinned torsos are disabled with that reason, and static props remain equippable.
- **AC-UPL-032.2** Given the same character, When the arm-length slider is set to 1.2, Then the mapped `upperarm_*`/`lowerarm_*` bones scale with child compensation.

**REQ-UPL-033 [P2]** WHEN an animation-clip file is uploaded THE SYSTEM SHALL retarget each selected clip onto the canonical skeleton, store it as `user:<uuid>#<clipName>`, and add it to the clip library (spec 004) under "My clips"; IF the file has more than 64 clips or any clip longer than 120 s THEN THE SYSTEM SHALL reject it with `UPL_BUDGET_CLIPS`.

- **AC-UPL-033.1** Given a Mixamo "without skin" FBX with one clip, When saved, Then the clip appears under "My clips" and plays on the default character.
- **AC-UPL-033.2** Given a clip with horizontal root motion, When the user ticks "In place", Then pelvis X/Z translation is removed from the stored clip.

### Materials and tints

**REQ-UPL-034 [P1]** THE SYSTEM SHALL convert every uploaded material (glTF PBR, VRM MToon, FBX/OBJ Phong/Lambert) to the default toon material graph, keeping base color factor and texture, emissive factor and texture, alpha mode (`OPAQUE`, `MASK` with its cutoff) and double-sidedness, and dropping metallic, roughness, occlusion and normal maps; `BLEND` materials become `MASK` at cutoff 0.5 with warning `UPL_W_BLEND_TO_MASK`.

- **AC-UPL-034.1** Given a PBR fixture with base color texture and normal map, When saved and rendered in pixel view, Then it uses the toon pipeline (golden image) and the stored GLB has no normal texture.

**REQ-UPL-035 [P1]** THE SYSTEM SHALL let the user assign each material to a tint slot (`skin`, `hair`, `eyes`, `primary`, `secondary`, `metal`, `leather`) or "Keep original", pre-suggesting by material name (e.g. contains `skin|body` → skin, `hair` → hair, `eye|iris` → eyes, `metal|steel|iron` → metal, `leather|belt|boot` → leather), and store the result in `entry.tintSlots`.

- **AC-UPL-035.1** Given materials `Body_Skin`, `Hair01`, `Cloth`, When the materials step renders, Then suggestions are skin, hair and "Keep original", and the user can change each with the keyboard.

**REQ-UPL-036 [P1]** WHEN a VRM is uploaded THE SYSTEM SHALL rotate VRM 0.x models to face the same direction as VRM 1.0 (`VRMUtils.rotateVRM0`), use normalized humanoid bones for mapping, expose VRM expressions as morph targets, ignore spring bones and constraints, and pre-fill the license form from VRM meta (author, license URL/name, commercial usage) for the user to confirm.

- **AC-UPL-036.1** Given VRM 0.x and 1.0 fixtures of the same model, When rendered side view facing direction 0, Then both face the same direction.
- **AC-UPL-036.2** Given a VRM 1.0 with `commercialUsage: personalNonProfit`, When the license step opens, Then "Commercial use" is pre-set to "No" and still editable.

### Local library and storage

**REQ-UPL-037 [P1]** WHEN the user saves an upload THE SYSTEM SHALL write the normalized GLB to OPFS at `user-assets/<uuid>/model.glb` (plus `thumb.png`, 128×128) and then the `UserAssetRecord` to IndexedDB, and on startup SHALL delete OPFS directories that have no record (orphans from interrupted saves).

- **AC-UPL-037.1** Given a save interrupted after the OPFS write (test hook), When the app restarts, Then the orphan directory is removed and the library does not list the asset.
- **AC-UPL-037.2** Given a saved asset, When the page reloads, Then it appears in the library with its thumbnail and equips without re-analysis.

**REQ-UPL-038 [P1]** THE SYSTEM SHALL show storage usage from `navigator.storage.estimate()` in the library ("Used 42 MB of 1.2 GB") and, before each write, require free space ≥ 1.2 × the bytes to write + 5 MB; IF not met THEN THE SYSTEM SHALL abort with `UPL_QUOTA_EXCEEDED` and keep the wizard open so the user can free space.

- **AC-UPL-038.1** Given a mocked estimate with 10 MB free and a 9 MB asset, When saving, Then `UPL_QUOTA_EXCEEDED` is shown and nothing is written.
- **AC-UPL-038.2** Given usage ≥ 80 % of quota, When the library opens, Then a warning "Storage almost full" is shown.

**REQ-UPL-039 [P1]** WHEN the first upload is saved THE SYSTEM SHALL call `navigator.storage.persist()` once and show the result in the library ("Storage: persistent" or "Storage: may be cleared by the browser — export your library to back it up").

- **AC-UPL-039.1** Given `persist()` resolves `false`, When the save completes, Then the non-persistent notice with an "Export library" action is shown.

**REQ-UPL-040 [P1]** WHEN the user deletes a library asset THE SYSTEM SHALL show a confirmation listing the number of saved local projects that reference it, then remove its IndexedDB record and OPFS directory; deletion is not undoable.

- **AC-UPL-040.1** Given an asset used by 2 saved projects, When Delete is chosen, Then the dialog says "Used by 2 saved projects. They will show it as missing." and after confirming the asset is gone from OPFS and IndexedDB.

**REQ-UPL-041 [P2]** THE SYSTEM SHALL export the whole library, or a selection, as a `.csglib.zip` (see *Data & contracts*) generated locally and downloaded.

- **AC-UPL-041.1** Given 3 assets, When "Export library" is chosen, Then a zip with `library.json` and 3 asset folders is downloaded and no network request carries its bytes.

**REQ-UPL-042 [P2]** WHEN a `.csglib.zip` is imported THE SYSTEM SHALL validate the archive (≤ 2,000 entries, ≤ 1 GB total uncompressed counted while streaming, per-entry compression ratio ≤ 100:1, no absolute or `..` paths), validate each record with the `UserAssetRecord` schema, re-run full analysis (REQ-UPL-008..014) on each GLB, and skip invalid entries with a per-entry report; assets whose `id` already exists are skipped unless the user chooses "Import as copy".

- **AC-UPL-042.1** Given a zip-bomb fixture (1 MB → 5 GB), When imported, Then extraction stops at the first violated limit with `UPL_LIBRARY_IMPORT_INVALID` and memory growth stays < 300 MB.
- **AC-UPL-042.2** Given a zip with entry `../../evil.glb`, When imported, Then that entry is rejected and nothing is written outside `user-assets/`.

*Amended (security review 2026-10-08)* (applies to `.csglib.zip` and `.csgproj.zip`, REQ-UPL-050).
Per asset, THE SYSTEM SHALL:

- re-run REQ-UPL-007..014 on `model.glb` (≤ 50 MB each) in the upload worker, normalize it per
  REQ-UPL-052, and recompute `sha256` from the stored bytes (the record's value is ignored);
- check `thumb.png` magic bytes (REQ-UPL-008) and IHDR dimensions exactly 128×128 before any decode;
- accept `record.json` (≤ 64 KB) only if `id` matches
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` and equals its folder name
  `assets/<id>/`; `sourceUrl` is `http:`/`https:` only (≤ 2,048 chars) in the Zod schema itself;
  `author` and `title` are 1–128 chars and `notes` ≤ 500 chars after the control-character
  stripping of REQ-UPL-045;
- not trust `rightsConfirmed`: the import dialog lists every asset with its license and the user
  must tick "I have the right to use these assets" once per import before anything is committed;
- for bundles, accept `project.json` only if ≤ 1 MB (1,048,576 bytes, the spec 001 document size
  limit) and valid under the document schemas and limits of specs 001, 007 and 009.

For the archive, THE SYSTEM SHALL reject:

- an entry name containing `\`, NUL, a drive letter (`^[A-Za-z]:`), a leading `/`, an empty, `.`
  or `..` segment, or not matching the layout in *Data & contracts* (that entry is skipped and
  reported, as in AC-UPL-042.2);
- symlink entries (Unix mode `0xA000` in the external attributes), entries whose name ends in
  `.zip`, `.gz`, `.7z`, `.rar` or `.tar`, or whose first 4 inflated bytes are `50 4B 03 04`
  (nested archives) (entry skipped and reported);
- the whole archive with `UPL_LIBRARY_IMPORT_INVALID` when two entry names are equal after
  Unicode NFC normalization and case folding, when a local file header disagrees with its central
  directory record (name, method, flags, CRC-32, compressed or uncompressed size), when an entry
  is encrypted, or when it uses a method other than stored (0) or deflate (8).

Limits SHALL be enforced on **actually inflated** bytes counted while streaming (declared sizes
are not trusted). Entries SHALL be streamed in chunks of ≤ 1 MB into an OPFS staging directory
`user-assets/.staging-<importId>/` and committed to `user-assets/<id>/` only after the asset
passes; staging is removed on failure and by the startup orphan cleanup (REQ-UPL-037). Before
extracting anything, THE SYSTEM SHALL apply the REQ-UPL-038 quota rule to the sum of the central
directory's declared uncompressed sizes and abort with `UPL_QUOTA_EXCEEDED` if it fails.

- **AC-UPL-042.3** Given an archive with an asset whose `model.glb` is 52,428,801 bytes, When imported, Then that asset is skipped with `UPL_TOO_LARGE` in the report and the other assets import.
- **AC-UPL-042.4** Given a `thumb.png` whose IHDR declares 30000×30000, and another that is a JPEG renamed `.png`, When imported, Then both assets are skipped and no image decode call happens (spy).
- **AC-UPL-042.5** Given records with `id` `../x`, an `id` that differs from its folder name, `sourceUrl: "javascript:alert(1)"`, and an `author` of 129 chars, When imported, Then each asset is skipped with a reason naming the field.
- **AC-UPL-042.6** Given a record with `rightsConfirmed: true`, When imported, Then nothing is committed until the user ticks the import rights checkbox, and cancelling leaves OPFS and IndexedDB unchanged.
- **AC-UPL-042.7** Given one archive per rule (entry names `a\b.glb`, `a\u0000.glb`, `C:/x.glb`, `/x.glb`, `assets/./x/model.glb`, a symlink entry, `assets/<id>/inner.zip`), When imported, Then each offending entry is skipped and reported, and 0 files are written for it.
- **AC-UPL-042.8** Given an archive with entries `assets/<id>/Model.glb` and `assets/<id>/model.glb`, or an entry whose local header uncompressed size is 10 bytes while its central directory record says 1 MB, When imported, Then the whole archive is rejected with `UPL_LIBRARY_IMPORT_INVALID` and nothing is committed.
- **AC-UPL-042.9** Given an entry whose declared uncompressed size is 1 KB but which inflates to 200 MB, When imported, Then inflation stops at 1 KB + 1 byte with `UPL_LIBRARY_IMPORT_INVALID`, and peak JS heap growth is < 64 MB.
- **AC-UPL-042.10** Given a mocked estimate with 100 MB free and an archive declaring 90 MB uncompressed, When imported, Then `UPL_QUOTA_EXCEEDED` is shown before any entry is inflated and no staging directory is created.
- **AC-UPL-042.11** Given a bundle whose `project.json` is 1,048,577 bytes, When imported, Then the bundle is rejected with `UPL_LIBRARY_IMPORT_INVALID` naming the 1 MB limit.

**REQ-UPL-043 [P2]** IF OPFS or IndexedDB is unavailable (e.g. private browsing) THEN THE SYSTEM SHALL allow uploads for the current session only, kept in memory, and show a persistent banner "Uploads will be lost when you close this tab" (`UPL_STORAGE_UNAVAILABLE`).

- **AC-UPL-043.1** Given `navigator.storage.getDirectory` rejects, When a GLB is uploaded, Then it is usable in the composer and the banner is visible.
- **AC-UPL-043.2** Given a build with `DEDICATED_ORIGIN=false` (REQ-GEN-009, security review 2026-10-08), When a GLB is uploaded and saved, Then this session-only behavior applies even though OPFS and IndexedDB are available, and 0 OPFS or IndexedDB writes are recorded.

### Licensing and credits

**REQ-UPL-044 [P1]** THE SYSTEM SHALL require, before saving, a license (`CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `own-work`, `other`), an author (1–128 chars), and the checkbox "I have the right to use this asset"; source URL is optional but, when given, must be `http:` or `https:` (≤ 2,048 chars); for `other`, a license name/notes (1–500 chars), "Commercial use" (yes/no/unknown) and "Attribution required" are also required. `commercialUse` is `yes` and `attributionRequired` follows the license for the four named licenses.

- **AC-UPL-044.1** Given an empty author, When Save is pressed, Then saving is blocked, focus moves to the author field and the error is announced (`UPL_LICENSE_INCOMPLETE`).
- **AC-UPL-044.2** Given source URL `javascript:alert(1)`, When Save is pressed, Then it is rejected with "Use an http or https link".
- **AC-UPL-044.3** Given license `CC-BY-4.0`, When saved, Then the record has `commercialUse: 'yes'`, `attributionRequired: true`, `rightsConfirmed: true`.

**REQ-UPL-045 [P1]** THE SYSTEM SHALL supply each used user asset's license to the exporter via `AssetRegistry.licenseOf(ref)` so it appears in `CREDITS.txt` (format owned by spec 005), with author, title and notes stripped of control characters and newlines, and SHALL trigger the export warnings of spec 005 for `commercialUse` `no`/`unknown` and share-alike licenses.

- **AC-UPL-045.1** Given an export using an uploaded asset with author `Evil\nLicense: CC0`, When exported, Then `CREDITS.txt` contains `Evil License: CC0` on one line within that asset's entry.
- **AC-UPL-045.2** Given an asset with license `other` and commercial use `unknown`, When exporting, Then the `LICENSE_UNKNOWN` warning lists its ref.

*Amended (security review 2026-10-08):* "control characters" means every code point in Unicode
general category Cc, Cf, Zl or Zp. This includes U+0085, the bidi controls U+202A–U+202E and
U+2066–U+2069, and the zero-width characters U+200B–U+200F, U+2060 and U+FEFF. Line-breaking
characters (U+000A–U+000D, U+0085, U+2028, U+2029) and tab become one space. All other control
characters are removed. Runs of spaces then collapse to one and the result is trimmed. THE SYSTEM
SHALL apply this when the license form is saved, on library/bundle import and again at export.
The asset title is 1–128 characters after stripping. VRM meta URLs (author, license and
reference URLs) pre-fill the form only if they pass the REQ-UPL-044 http(s) rule; otherwise
they are dropped with the notice "Ignored a non-web link from the file". Rendered source links
SHALL use `target="_blank"` and `rel="noopener noreferrer"`.

- **AC-UPL-045.3** Given author `Ev‮il​ Name X\u0085Y`, When saved, Then the stored and exported author is `Evil Name X Y`.
- **AC-UPL-045.4** Given a title that is 129 characters after stripping, or empty after stripping (e.g. only `​`), When Save is pressed, Then saving is blocked with `UPL_LICENSE_INCOMPLETE` naming the title field.
- **AC-UPL-045.5** Given a VRM whose meta `licenseUrl` is `javascript:alert(1)`, When the license step opens, Then the source URL field is empty and the notice is shown.
- **AC-UPL-045.6** Given an asset with an `https:` source URL, When the library renders it, Then the link element has `rel="noopener noreferrer"` and `target="_blank"`.

**REQ-UPL-046 [P2]** THE SYSTEM SHALL let the user edit an asset's license data from the library; the rights checkbox must be re-confirmed on every edit.

- **AC-UPL-046.1** Given an asset, When its author is edited and saved, Then the next export's credits show the new author.

### References from CharacterSpec

**REQ-UPL-047 [P1]** THE SYSTEM SHALL reference saved uploads as `user:<uuid>` (`AssetRef`) in `CharacterSpec` (and user clips as `user:<uuid>#<clipName>` in `RenderSettings.animations[].clipId`), resolved through `AssetRegistry` exactly like built-ins.

- **AC-UPL-047.1** Given an equipped user hat, When the `CharacterSpec` is serialized, Then `parts.headwear.ref` matches `/^user:[0-9a-f-]{36}$/`, and loading the JSON re-equips the hat.

**REQ-UPL-048 [P1]** IF a loaded document references a `user:` asset that is not in the local library THEN THE SYSTEM SHALL keep the reference unchanged in the document, show the slot with a "Missing asset" badge (`UPL_ASSET_MISSING`), render a missing body with the default built-in body plus a persistent warning, skip missing parts/clips in the preview, block export until each missing ref is resolved, and offer per ref: "Import file…" (re-link by uploading), "Replace with library asset…" and "Remove from character".

- **AC-UPL-048.1** Given a project JSON with a missing hat ref, When opened, Then the preview renders without the hat, the Headwear slot shows "Missing asset", the Export button is disabled with that reason, and re-saving the project keeps the ref.
- **AC-UPL-048.2** Given "Remove from character" on the missing ref, When chosen, Then the slot becomes empty (undoable, spec 009) and export is enabled.

**REQ-UPL-049 [P1]** THE SYSTEM SHALL never encode `user:` refs or user asset bytes in share URLs; WHEN the user shares a character that uses user assets THE SYSTEM SHALL follow REQ-CMP-026 (share without those parts after confirmation) and additionally offer "Export project bundle" (REQ-UPL-050) in the same dialog.

- **AC-UPL-049.1** Given a character with one user part, When "Copy share link" is chosen, Then the REQ-CMP-026 dialog lists the part and also offers "Export project bundle", and any produced URL contains no `user:` substring.

**REQ-UPL-050 [P2]** THE SYSTEM SHALL export a project bundle `.csgproj.zip` containing `project.json` (`ProjectDocument`) and the user assets it references in the `.csglib.zip` layout, and import it with the same checks as REQ-UPL-042, restoring refs by `id`.

- **AC-UPL-050.1** Given a project with 2 user assets exported as a bundle, When imported in a fresh browser profile, Then the character renders identically (golden image) and the library lists both assets with their licenses.

### Performance

**REQ-UPL-051 [P1]** THE SYSTEM SHALL complete analysis of a 30 MB GLB within budget in ≤ 5 s on the reference machine (constitution P-07) and keep main-thread tasks ≤ 50 ms during analysis, showing step-wise progress (Checking → Validating → Parsing → Analyzing rig → Preparing).

- **AC-UPL-051.1** Given the 30 MB perf fixture, When uploaded in the perf CI profile, Then analysis completes in ≤ 5 s and the Long Tasks API records no main-thread task > 50 ms.

### Stored asset normalization and integrity (security review 2026-10-08)

Decoders (Draco, Meshopt, Basis/KTX2) are the largest attack surface (T10). They run only inside
the upload worker. Stored assets never need them, so the main thread never loads them.

**REQ-UPL-052 [P1]** WHEN an upload or imported asset is saved THE SYSTEM SHALL write `model.glb` with no `KHR_draco_mesh_compression`, `EXT_meshopt_compression` or `KHR_texture_basisu` in `extensionsUsed` or `extensionsRequired`, with every texture stored as PNG.

- **AC-UPL-052.1** Given the `draco.glb`, `meshopt.glb` and `ktx2.glb` fixtures, When saved, Then each stored `model.glb` declares none of the three extensions, every `images[].mimeType` is `image/png`, and the rendered golden matches the source within the existing per-backend tolerance.
- **AC-UPL-052.2** Given a JPEG-textured fixture, When saved, Then the stored texture is PNG with the same dimensions (after the REQ-UPL-013 downscale).

**REQ-UPL-053 [P1]** THE SYSTEM SHALL store the lowercase hex SHA-256 of the saved `model.glb` in `UserAssetRecord.sha256`, and before loading a stored asset SHALL check its size (≤ 50 MB), magic bytes (REQ-UPL-008), structural limits (REQ-UPL-012) and SHA-256; IF any check fails THEN THE SYSTEM SHALL refuse to load it and treat it as missing (`UPL_ASSET_MISSING`, REQ-UPL-048).

- **AC-UPL-053.1** Given a saved asset whose OPFS `model.glb` has 1 byte flipped (test hook), When a project using it opens, Then the asset is not parsed (loader spy: 0 calls), the slot shows "Missing asset", and export is blocked.
- **AC-UPL-053.2** Given a record whose `sha256` is not 64 lowercase hex characters, When the library loads, Then the record fails schema validation (REQ-GEN-013) and the asset is not listed as valid.
- **AC-UPL-053.3** Given a 30 MB stored asset, When it is loaded, Then the hash check adds ≤ 300 ms in the perf CI profile and no main-thread task exceeds 50 ms.

**REQ-UPL-054 [P1]** THE SYSTEM SHALL load stored user assets on the main thread with a glTF loader that has no Draco, Meshopt or KTX2 decoder registered, and IF a stored GLB declares any of the REQ-UPL-052 extensions THEN THE SYSTEM SHALL refuse it with `UPL_ASSET_MISSING`.

- **AC-UPL-054.1** Given an E2E session that equips 3 stored user assets, When network and module loads are recorded, Then no Draco, Basis/KTX2 transcoder or Meshopt decoder file is requested in that page outside the upload worker.
- **AC-UPL-054.2** Given a stored GLB edited (with a matching record `sha256`) to require `KHR_draco_mesh_compression`, When loaded, Then it is refused with `UPL_ASSET_MISSING` and the Draco decoder is not loaded.

## Error codes

Messages are i18n catalog defaults (`upl.error.<CODE>`); `{…}` are placeholders filled with
sanitized values. Codes starting `UPL_W_` are warnings (do not block saving).

| Code | Stage | User message | How to fix (hint) |
|------|-------|--------------|-------------------|
| `UPL_UNSUPPORTED_FORMAT` | pre-check / worker | "{file} isn't a supported format. Use GLB, glTF, VRM, FBX (beta) or OBJ." | Export as GLB from your 3D tool. |
| `UPL_MAGIC_MISMATCH` | pre-check | "{file} doesn't look like a real {format} file." | Re-export the file; don't just rename it. |
| `UPL_TOO_LARGE` | pre-check | "These files are {size} MB. The limit is 50 MB." | Compress textures or use Draco/Meshopt. |
| `UPL_TOO_MANY_FILES` | pre-check | "{count} files selected. The limit is 64 per upload." | Pack the model as a single GLB. |
| `UPL_MISSING_RESOURCE` | worker | "{file} needs {resource}, which wasn't included." | Select or drop the whole folder. |
| `UPL_EXTERNAL_URI` | worker | "{file} links to {uri}. Files outside your upload aren't loaded." | Embed textures (export as GLB). |
| `UPL_VALIDATOR_ERROR` | worker | "The glTF validator found {count} errors, first: {code} at {pointer}." | Fix the export or run it through gltf-transform. |
| `UPL_PARSE_FAILED` | worker | "{file} couldn't be read." | Re-export from your 3D tool. |
| `UPL_TIMEOUT` | worker | "Reading the file took longer than 20 seconds and was stopped." | Reduce file size or complexity. |
| `UPL_WORKER_CRASHED` | worker | "The importer stopped unexpectedly." | Try again; if it repeats, report the file type. |
| `UPL_FBX_VERSION` | worker | "FBX version {version} isn't supported (needs binary 6400+ or ASCII 7.0+)." | Convert to GLB in Blender. |
| `UPL_DECODER_UNAVAILABLE` | worker | "The {decoder} decoder isn't available offline yet." | Go online once, then retry. |
| `UPL_BUDGET_TRIS` | budget | "{count} triangles; the limit for a {kind} is {limit}." | Decimate the mesh. |
| `UPL_BUDGET_TEXTURES` | budget | "{count} textures; the limit is 8." | Atlas textures. |
| `UPL_TEXTURE_TOO_LARGE` | budget | "Texture {name} is {w}×{h}; the limit is 2048 px per side." | Resize the texture. |
| `UPL_BUDGET_BONES` | budget | "{count} bones; the limit is 128." | Remove helper/hair bones. |
| `UPL_BUDGET_MATERIALS` | budget | "{count} materials; the limit is 16." | Merge materials. |
| `UPL_BUDGET_MORPHS` | budget | "{count} morph targets; the limit is 64." | Remove unused shape keys. |
| `UPL_BUDGET_CLIPS` | budget | "{count} clips (longest {seconds} s); limits are 64 clips and 120 s." | Split the file. |
| `UPL_MEMORY_ESTIMATE` | budget | "This model would need about {mb} MB of memory; the limit is 256 MB." | Reduce geometry and textures. |
| `UPL_STRUCTURE_LIMIT` | worker (structural) | "{file} is too complex: {item} is {count}; the limit is {limit}." | Remove unused nodes/animations, or export as GLB. |
| `UPL_NO_MESH` | analysis | "{file} has no mesh to use as a {kind}." | Pick "Animation clip" or include a mesh. |
| `UPL_NO_SKELETON` | analysis | "{file} has no skeleton, so it can't be a {kind}." | Upload as a static prop or rig it. |
| `UPL_BONE_MAP_INCOMPLETE` | mapping | "Required bones not mapped: {bones}." | Map them in the list. |
| `UPL_BIND_POSE_MISMATCH` | mapping | "This part's skeleton doesn't match the base skeleton ({bones})." | Re-skin the part to the base skeleton in Blender. |
| `UPL_LICENSE_INCOMPLETE` | license | "Fill in license, author and confirm your rights." | — |
| `UPL_QUOTA_EXCEEDED` | save | "Not enough browser storage: need {need} MB, {free} MB free." | Delete unused assets or export your library. |
| `UPL_STORAGE_UNAVAILABLE` | save | "This browser can't store files here. Uploads will be lost when you close this tab." | Use a normal (non-private) window. |
| `UPL_ASSET_MISSING` | load | "{count} uploaded assets used by this project aren't in your library." | Import the files or replace them. |
| `UPL_LIBRARY_IMPORT_INVALID` | import | "{file} isn't a valid library archive: {reason}." | Re-export the library. |
| `UPL_W_INFLUENCES_PRUNED` | warning | "{count} vertices had more than 4 bone influences; extras were removed." | — |
| `UPL_W_BLEND_TO_MASK` | warning | "Transparent materials were converted to cut-out (alpha 0.5)." | — |
| `UPL_W_FBX_BETA` | warning | "FBX support is in beta. For best results convert to GLB in Blender." | — |

## Threat model (STRIDE-lite)

Assets: the user's device and browser session, the user's local library and projects, the user's
privacy (no network leakage), and editor availability. Attacker: author of a file the user is
tricked into uploading (or a library/project zip). There is no server, so server-side threats do
not apply.

| # | STRIDE | Threat | Mitigations (REQ) | Residual risk |
|---|--------|--------|-------------------|---------------|
| T1 | Spoofing | File disguised by extension/MIME (e.g. executable or SVG named `.glb`) | Magic bytes + allowlist (REQ-UPL-007, -008, -013) | Low |
| T2 | Spoofing | Fake license metadata (VRM meta, zip records) | Pre-fill only; user confirms rights (REQ-UPL-036, -044, -046) | Accepted: user responsibility |
| T3 | Tampering | Crafted `library.json`/record in imported zip (bad refs, overwrite existing ids, path traversal) | Schema validation, id collision rule, path checks, re-analysis (REQ-UPL-042, -050) | Low |
| T4 | Tampering / EoP | Prototype pollution via `__proto__`/`constructor`/`prototype` keys in glTF `extras`/JSON, or via upload names used as object keys | Reject those keys at any depth (REQ-GEN-011); `__proto__`/`constructor`/`prototype` names suffixed and name-keyed data in `Map`/null-prototype objects (REQ-UPL-014); `extras` ignored except allowlisted VRM fields (REQ-UPL-010, -036) | Medium until M4 (all loaders adopt REQ-GEN-011), then Low (raised by security review 2026-10-08) |
| T5 | Info disclosure | External URI fetch (tracking pixel, IP leak, intranet probing/SSRF-in-browser) | URL modifier limited to session-created `blob:` URLs and allowlisted `data:` MIME types, external URI rejection, session-scoped resolution, CSP `connect-src 'self'` (REQ-GEN-010), bundled decoders (REQ-UPL-005, -011) | Low |
| T6 | Info disclosure | User assets leaking via share URLs or telemetry | No user refs in URLs, no telemetry (REQ-UPL-049, REQ-GEN-003) | Low |
| T7 | DoS | Oversized files, zip bombs, huge declared textures (decompression bombs) | 50 MB cap, file count cap, header-first texture dims, zip streaming limits and ratio (REQ-UPL-007, -013, -042) | Low |
| T8 | DoS | Memory exhaustion via giant accessor counts, Draco/Meshopt expansion, keyframe floods | Header-based memory estimate before decode, budgets (REQ-UPL-012) | Medium: worker can still OOM the tab on browser bugs |
| T9 | DoS | Parser hang / infinite loop | Worker isolation, 20 s timeout + terminate, crash recovery (REQ-UPL-009) | Low |
| T10 | EoP | Decoder vulnerabilities (Draco/Basis WASM, image decoders, FBX parser) | Validator first, budgets before decode, worker isolation, pinned versions with Dependabot/audit, FBX/OBJ off-by-default flag possible (REQ-UPL-002, -009, -010, -011.3); header checks for KTX2/APNG/animated WebP (REQ-UPL-013); decoders only in the upload worker, stored assets decoder-free (REQ-UPL-052, -054); hash-checked decoder files (REQ-GEN-010) | Medium: relies on browser sandbox |
| T11 | EoP | XSS via node/material/bone names, author, URLs, error messages | Name sanitization, text-only rendering, lint ban on `innerHTML`, http(s)-only URLs, CSP `script-src 'self' 'wasm-unsafe-eval'` (REQ-UPL-014, -015, -044) | Low |
| T12 | Tampering | `CREDITS.txt` injection (newlines forging entries) | Control-char/newline stripping (REQ-UPL-045) | Low |
| T13 | DoS | Filling storage quota | Pre-write quota check, usage display, delete (REQ-UPL-038, -040), up-front import quota check (REQ-UPL-042) | Low |
| T14 | Tampering / Info disclosure | Same-origin co-tenants (other apps on a shared origin) and persisted-data tampering (edited IndexedDB/OPFS/localStorage, forged `BroadcastChannel` messages) | Dedicated origin or storage disabled (REQ-GEN-009, AC-UPL-043.2); persisted data validated like imports (REQ-GEN-013); `model.glb` SHA-256 + structural re-check before load (REQ-UPL-053); no decoders on the main thread (REQ-UPL-054); CSP (REQ-GEN-010) | Medium until the production domain is decided (REQ-GEN-009 open question), then Low |
| T15 | DoS | Share-link or graph bombs, GPU hang from hostile graphs or meshes, crash loop when a hostile item is autosaved and reloaded | Fragment and inflate limits (specs 001, 007), graph limits (spec 007), crash recovery / safe mode (spec 009), structural limits (REQ-UPL-012), autosave flush before analysis (REQ-UPL-009) | Medium: GPU driver hangs are outside the browser sandbox's control |
| T16 | Spoofing / Tampering | Clickjacking: a hostile page frames the editor to trick clicks (e.g. delete library, export) | Frame guard: framed editor shows only "Open in a new tab" and touches no storage (REQ-GEN-012); `frame-ancestors` is unavailable on static hosting without headers | Low |

The malicious-fixture suite (`packages/engine/test/fixtures/upload/malicious/`, each < 200 KB,
generated in code where possible) covers T1, T3, T4, T5, T7, T8, T9, T10, T11, T12, T13 and T14,
and runs in CI. T10 fixtures are malformed Draco/Meshopt/KTX2 payloads and KTX2/APNG/animated WebP
headers within budget (AC-UPL-013.4, -013.5). T12 fixtures cover bidi and line-separator
injection (AC-UPL-045.3). T13 uses a mocked quota (AC-UPL-038.1, AC-UPL-042.10). T14 uses tampered
records and stored GLBs (AC-GEN-013.1, AC-UPL-053.1, AC-UPL-054.2). T15 and T16 fixtures belong to
specs 001, 007 and 009 and to AC-GEN-012.1.

## Edge cases

- Empty file (0 bytes) → REQ-UPL-008 (`UPL_MAGIC_MISMATCH`).
- Same file uploaded twice → saved as two assets with different uuids; library shows both (no dedupe in v1).
- GLB with several skins → all joints count toward the bone budget (REQ-UPL-012); the skin with the most joints is the rig for mapping.
- Multiple scenes in a glTF → only the default `scene` (or scene 0) is used; a warning names the ignored scenes.
- Mesh with no UVs and no texture → kept; tint slots still work (REQ-UPL-035).
- Animation channels targeting unmapped bones → dropped on retarget (REQ-UPL-021, -023).
- Non-uniform scale on bones in rest pose → normalized during GLB normalization; if not possible, `UPL_BIND_POSE_MISMATCH` for parts.
- Offline upload needing Draco/KTX2 decoder not yet cached → `UPL_DECODER_UNAVAILABLE` (REQ-GEN-004).
- WebGL2 backend → upload, preview and retarget behave identically; only goldens differ per backend.
- Deleting an asset equipped in the open character → REQ-UPL-048 applies immediately.
- Undo across upload: equipping is undoable (spec 009); saving/deleting library assets is not.
- Another tab deletes an asset → the open tab receives a `BroadcastChannel` message, validates it (REQ-GEN-013) and applies REQ-UPL-048.
- Embedded `.gltf` with base64 buffers over 8 MB → `UPL_STRUCTURE_LIMIT` (REQ-UPL-012); the hint says to export as GLB.
- Names that are only zero-width or bidi characters → stripped to empty, so the name becomes `unnamed` (REQ-UPL-014) and an empty author/title blocks saving (REQ-UPL-045).
- Stripping Cf removes U+200D (zero-width joiner), so some emoji sequences and scripts in author/title display differently. This is accepted for credits text.
- Record without `sha256` → fails the v1 schema (REQ-GEN-013). Uploads ship in M5 with `sha256` required, so no earlier records exist to migrate.
- Library import interrupted (tab closed) → the staging directory is removed by the startup orphan cleanup (REQ-UPL-037, -042).

## Data & contracts

Refines architecture §3.6. Changes below must be applied to `docs/architecture.md` §3.6 and the
`@csg/parts-schema` Zod schemas in the same PR that implements them.

```ts
/** Defaults for analyzeUpload; values are part of this spec (REQ-UPL-007, -009, -012). */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxBytes: 52_428_800,
  maxFiles: 64,                 // added
  maxTrisCharacter: 50_000,
  maxTrisPart: 10_000,
  maxTextures: 8,
  maxTextureSize: 2048,         // stored textures downscaled to 1024
  maxBones: 128,
  maxInfluences: 4,             // extras pruned with warning
  maxMaterials: 16,             // added
  maxMorphTargets: 64,          // added
  maxClips: 64,                 // added
  maxClipSeconds: 120,          // added
  maxDecodedBytes: 268_435_456, // added
  timeoutMs: 20_000,
  // Structural limits, checked after JSON parse and before gltf-validator (REQ-UPL-012,
  // security review 2026-10-08):
  maxJsonBytes: 8_388_608,            // added
  maxNodes: 10_000,                   // added
  maxAccessors: 20_000,               // added
  maxAnimationChannels: 8_192,        // added
  maxKeyframes: 2_000_000,            // added
  maxStringLength: 4_096,             // added; data: URIs exempt
  maxRawNameLength: 256,              // added; truncation before sanitizing
  maxAnalysisMessageBytes: 2_097_152, // added; worker -> main payload
};

/** Library / bundle import limits (REQ-UPL-042, security review 2026-10-08). */
export const DEFAULT_ARCHIVE_LIMITS = {
  maxEntries: 2_000,
  maxInflatedBytes: 1_073_741_824, // counted on actual inflated bytes
  maxEntryRatio: 100,
  maxModelBytes: 52_428_800,       // per assets/<id>/model.glb
  maxRecordBytes: 65_536,          // per record.json
  maxProjectJsonBytes: 1_048_576,  // bundle project.json (spec 001 document limit)
  thumbSize: 128,                  // thumb.png must be exactly 128×128
  streamChunkBytes: 1_048_576,
  allowedMethods: [0, 8],          // stored, deflate
} as const;

/** URL modifier allowlist (REQ-UPL-011). */
export const ALLOWED_DATA_URI_MIME = [
  'application/octet-stream', 'application/gltf-buffer',
  'image/png', 'image/jpeg', 'image/webp', 'image/ktx2',
] as const;

/** Names that get a trailing '_' after sanitization (REQ-UPL-014). Name-keyed data uses
 *  Map or Object.create(null), never {} literals. */
export const RESERVED_NAMES = ['__proto__', 'constructor', 'prototype'] as const;

/** Upload error codes (EngineError.code). */
export type UploadErrorCode =
  | 'UPL_UNSUPPORTED_FORMAT' | 'UPL_MAGIC_MISMATCH' | 'UPL_TOO_LARGE' | 'UPL_TOO_MANY_FILES'
  | 'UPL_MISSING_RESOURCE' | 'UPL_EXTERNAL_URI' | 'UPL_VALIDATOR_ERROR' | 'UPL_PARSE_FAILED'
  | 'UPL_TIMEOUT' | 'UPL_WORKER_CRASHED' | 'UPL_FBX_VERSION' | 'UPL_DECODER_UNAVAILABLE'
  | 'UPL_BUDGET_TRIS' | 'UPL_BUDGET_TEXTURES' | 'UPL_TEXTURE_TOO_LARGE' | 'UPL_BUDGET_BONES'
  | 'UPL_BUDGET_MATERIALS' | 'UPL_BUDGET_MORPHS' | 'UPL_BUDGET_CLIPS' | 'UPL_MEMORY_ESTIMATE'
  | 'UPL_STRUCTURE_LIMIT'
  | 'UPL_NO_MESH' | 'UPL_NO_SKELETON' | 'UPL_BONE_MAP_INCOMPLETE' | 'UPL_BIND_POSE_MISMATCH'
  | 'UPL_LICENSE_INCOMPLETE' | 'UPL_QUOTA_EXCEEDED' | 'UPL_STORAGE_UNAVAILABLE'
  | 'UPL_ASSET_MISSING' | 'UPL_LIBRARY_IMPORT_INVALID';

/** UploadAnalysis.kind gains 'clip'; per-bone confidence is added. */
export interface UploadAnalysisV1Additions {
  kind: 'character' | 'skinned-part' | 'static-part' | 'clip';
  boneConfidence: Record<string, number>; // canonical bone -> 0.5 | 0.7 | 0.9 | 1.0
  clips: Array<{ name: string; durationSec: number }>;
  warnings: Array<{ code: `UPL_W_${string}`; message: string; details?: Record<string, unknown> }>;
}

/** UserAssetRecord v1 (architecture §3.6) plus: */
export interface UserAssetRecordV1Additions {
  assetKind: 'character' | 'skinned-part' | 'static-part' | 'clip';
  /** For assetKind 'clip' (entry is then omitted) – stored in the same model.glb. */
  clips?: Array<{ name: string; durationSec: number; inPlace: boolean }>;
  restPose: 'T' | 'A' | 'unknown';
  stats: { triangles: number; textures: number; bones: number; bytes: number };
  /** Lowercase hex SHA-256 of model.glb, /^[0-9a-f]{64}$/ (REQ-UPL-053). Recomputed on import. */
  sha256: string;
}
/** Tightened AssetLicense rules for user assets (architecture §3.1; REQ-UPL-042, -044, -045):
 *  author and title 1–128 chars and notes ≤ 500 chars after control-character stripping
 *  (for user assets `title` is required); sourceUrl http(s) only, ≤ 2,048 chars, enforced in
 *  the Zod schema; rightsConfirmed from an imported record is ignored (REQ-UPL-042). */

/** User bone-map preset (REQ-UPL-025), IndexedDB store 'bone-map-presets'. */
export interface BoneMapPreset {
  format: 'sprite-bone-map';
  version: 1;
  id: string;
  name: string;
  map: Record<string, string | null>; // sanitized source bone -> canonical bone; in memory a Map or null-prototype object (REQ-UPL-014)
}
```

Only the entry names below are accepted; any other name is skipped and reported (REQ-UPL-042).
`<uuid>` matches the lowercase UUID regex of REQ-UPL-042.

Library archive `.csglib.zip` (REQ-UPL-041/042) and project bundle `.csgproj.zip` (REQ-UPL-050):

```
library.json            { "format": "sprite-user-library", "version": 1, "assets": ["<uuid>", …] }
assets/<uuid>/record.json   UserAssetRecord
assets/<uuid>/model.glb
assets/<uuid>/thumb.png
project.json            (bundle only) ProjectDocument
```

## Non-functional

- Privacy: P-03, REQ-GEN-003; CSP per REQ-GEN-010 (`connect-src 'self'`); decoders bundled and hash-checked (REQ-UPL-011, REQ-GEN-010).
- Security: dedicated origin (REQ-GEN-009), frame guard (REQ-GEN-012), persisted data treated as untrusted (REQ-GEN-013), stored assets decoder-free and hash-verified (REQ-UPL-052..054).
- Performance: REQ-UPL-051; upload code and `gltf-validator` are lazy-loaded and excluded from the 400 KB initial JS budget (P-07).
- Accessibility: wizard is a modal dialog with focus trap, step headings, errors linked via `aria-describedby`, and every drag interaction has a keyboard alternative (P-06, REQ-UPL-004, -020, -028).
- Determinism: uploads are normalized once at save; rendering a saved upload is deterministic per backend (P-04). `createdAt` never affects rendering.
- Tests: fixtures < 200 KB under `packages/engine/test/fixtures/upload/`; perf fixture generated at test time.

## Open questions

- [NEEDS CLARIFICATION: canonical bone names and axes depend on the M1 rig spike (spec 011). Blocks final preset tables and REQ-UPL-026 offsets.]
- [NEEDS CLARIFICATION: VRoid exports often use 4096² textures and > 128 bones (hair/skirt). Should textures up to 4096 be accepted and downscaled, and should unmapped secondary bones be collapsed into their parent to fit the 128-bone budget? Owner: project owner. Blocks VRM fixture choice, not M5 start.]
- [NEEDS CLARIFICATION: Should FBX/OBJ parse in the worker or on the main thread after worker checks (architecture §2.2)? Proposal: worker; fall back only if three's FBXLoader proves worker-incompatible. Owner: asset-pipeline-engineer during M5.]
- [NEEDS CLARIFICATION: REQ-UPL-048 keeps missing `user:` refs in the document and falls back to the default body for a missing user body, while REQ-CMP-024 empties missing slots and fails on a missing body (`CMP_BODY_MISSING`). Proposal: amend REQ-CMP-024 to apply to `builtin:` refs only and defer `user:` refs to REQ-UPL-048. Owner: spec 001 owner.]
- [NEEDS CLARIFICATION: `UploadLimits`/`UploadAnalysis`/`UserAssetRecord` additions above need an architecture.md §3.6 update. Owner: architect.]
- [NEEDS CLARIFICATION: three.js `DRACOLoader`/`KTX2Loader` start `blob:` workers, which REQ-GEN-010's `worker-src 'self'` blocks. Proposal: the upload worker calls the decoder WASM modules directly (no nested workers). Owner: asset-pipeline-engineer, before M5. Blocks AC-UPL-001.1 for `draco.glb`/`ktx2.glb` under the production CSP.]
- [NEEDS CLARIFICATION: this spec is now about 760 lines, above the roughly 600-line split threshold. Proposal: move the validation pipeline, archive rules, stored-asset integrity and threat model into a new spec `012-upload-security.md`. The area prefix stays UPL and the IDs move unchanged. Owner: PM/spec owner.]

## References

- ADR-0005 Local-first custom model upload; `docs/architecture.md` §2.2, §3.6, §4.6
- `.tagconn/work/research.md` (Custom model upload)
- glTF 2.0 specification, GLB header: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html (accessed 2026-10-08)
- glTF-Validator: https://github.com/KhronosGroup/glTF-Validator (accessed 2026-10-08)
- three-vrm (`VRMLoaderPlugin`, `VRMUtils.rotateVRM0`): https://github.com/pixiv/three-vrm (accessed 2026-10-08)
- VRM 1.0 humanoid required bones: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md (accessed 2026-10-08)
- KTX 2.0 file identifier: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html (accessed 2026-10-08)
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html (accessed 2026-10-08)
- WCAG 2.2 SC 2.5.7 Dragging Movements: https://www.w3.org/TR/WCAG22/#dragging-movements
- StorageManager `persist()` / `estimate()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
- Security review 2026-10-08 (origin of the amendments to REQ-UPL-009, -011..014, -042, -045 and of REQ-UPL-052..054, T14–T16)
- PKWARE APPNOTE.TXT (local/central headers, external attributes, methods): https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (accessed 2026-10-08)
- APNG `acTL` chunk: https://www.w3.org/TR/png-3/#apng-frame-based-animation (accessed 2026-10-08)
- WebP container (`VP8X` animation flag, `ANIM`/`ANMF`): https://developers.google.com/speed/webp/docs/riff_container (accessed 2026-10-08)
- Unicode general categories (Cc, Cf, Zl, Zp) and bidi controls: https://www.unicode.org/reports/tr9/ (accessed 2026-10-08)
- OWASP Prototype Pollution Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html (accessed 2026-10-08)
