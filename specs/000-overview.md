---
id: GEN
title: Product overview, roadmap, prefix registry and glossary
status: draft
owner: spec-writer
depends_on: [constitution]
last_updated: 2026-10-09
---

# 000 – Overview

## Context

Character Sprite Generator is an open-source, browser-based tool. Users build a game character from modular 3D parts, adjust its anatomy and animate it. They then render it through a pixel-art shader pipeline into sprite sheets for side-view (platformer) or top-down / 3/4 / isometric (RPG) games. Advanced users can edit materials and post-processing in a node-based shader graph and upload their own models. A website hosts a landing page and a user guide built from Markdown.

Fixed decisions are in `.tagconn/work/research.md` and `docs/adr/*`. This file is the entry point to every feature spec. It owns the **area-prefix registry** and the **glossary**.

## Vision

> "Pick parts, pick a camera, press export: game-ready, pixel-perfect sprite sheets in minutes, free, private, and in your browser."

- **3D → pixel art**, not hand-drawn: one character can be rendered in any number of directions, animations and resolutions (32–128 px).
- **Local-first and free**: no account and no server. Bundled assets are CC0 (constitution P-02, P-03).
- **Hackable**: data-driven parts, editable shader graphs, Markdown docs and a spec-first workflow (P-01, P-11).

## Personas

| Persona | Needs | Primary features |
|---------|-------|------------------|
| **Indie game dev** (main persona) | Consistent character sprites fast, without art skills; engine-ready sheets + metadata | Composer, animation, export |
| **Pixel artist** | A clean, controllable base to paint over; palette control; readable silhouettes at small sizes | Pixel pipeline, palettes, anatomy, export of layers |
| **Modder / contributor** | Add parts, palettes, node types and presets without touching engine code; clear docs and specs | Parts manifest/schema, graph format, docs |
| **Tech artist** | Change the look (toon bands, outlines, dithering, custom effects) with a node graph | Shader graph editor + format |

## Goals

- G1: Produce game-ready sprite sheets from modular 3D characters entirely in the browser.
- G2: Treat side-view and top-down/3/4/isometric cameras as equals.
- G3: Make the look editable through a node-based shader graph that non-experts can tune with blackboard sliders.
- G4: Accept user models (GLB/glTF, VRM) safely and locally.
- G5: Be a welcoming open-source project: specs, Markdown docs and data-driven content.

## Non-goals

- NG1: Hand-drawn or LPC-style 2D sprite layering.
- NG2: A full 3D modelling, sculpting or weight-painting tool. We point users to Blender.
- NG3: Server-side rendering, accounts, cloud storage or a public asset marketplace (for now).
- NG4: Native desktop/mobile apps. The browser is the platform. Mobile is view-friendly but not a target for editing.
- NG5: AI image generation of sprites.

## Roadmap

| Milestone | Scope | Specs |
|-----------|-------|-------|
| **M1: Asset spike + engine core** (done, 2026-10-09) | Verify that the Quaternius assets share one skeleton (`tools/verify-rig.ts`, spec 011). Parts schema + manifest. Engine loads base body, rebinds skinned parts by bone name, attaches props to sockets. `CharacterSpec` save/load. Anatomy bone scales. Animation playback. Headless tests. | 001, 002, 004 (core), 011 |
| **M2: Pixel pipeline** (done, 2026-10-09) | Low-res render target, toon ramp + rim, outlines (depth/normal/part-ID), palette LUT + Bayer dither, alpha cutoff, texel snapping, camera presets (side, 3/4, isometric) and 1/2/4/8 directions. | 003 |
| **M3: Editor shell, composer + export** | ~~React editor shell, part picker, tints, anatomy sliders, animation picker, live preview. Sprite-sheet export (PNG + JSON metadata + `CREDITS.txt`), deterministic output.~~ Editor shell with home screen, new-avatar wizard, Easy and Pro workspaces, composer, realistic and chibi styles, export (PNG + JSON metadata + `CREDITS.txt`, deterministic). `CharacterSpec` v2 (style, species). *(Amended 2026-10-09 (STY), PM decision.)* | 001, 002, 005, 009 |
| **M3.5: Styles & species** | Stickman and voxel (blocky) styles, body composition (weight, muscle), animal and monster species (heads, tails, ears, horns), wizard and editor gating. *(Added 2026-10-09 (STY), PM decision.)* | 013, 002 (composition hooks) |
| **M4: Shader graph** | Graph model and compiler to TSL, material and post-process graphs, built-in stages as editable subgraphs, React Flow editor, blackboard, presets. | 006, 007 |
| **M5: Custom upload** | GLB/glTF + VRM upload in a worker, validation and budgets, bone auto-map + manual mapping, retargeting, socket props, OPFS storage, license capture. FBX/OBJ beta. | 008 |
| **Website track** (parallel, from M1) | Next.js landing page, Fumadocs user guide built from `docs/guide/**`, perf/a11y bars. | 010 |
| **M6: 2D lighting maps** | Auxiliary maps for dynamic lighting in 2D engines, from the same single scene render. Depends on M3 export; independent of M4/M5. P1 scope: normal map (`_n`), albedo (unlit) colour sheet and their metadata. Later: mask, specular, UV lookup map, engine presets (P2); depth, emission, options (P3). *(Added 2026-10-09 (LIT).)* | 012 |

*(Note 2026-10-09 (STY), PM decision.)* M1 and M2 are done: the M1 rig spike reported `mapped` (ADR-0008) and the M2 pixel pipeline is merged. "Done" means the milestone's scope shipped. P1 ACs that still lack tests are listed by `pnpm spec:trace`. M3 now also covers the home screen, the new-avatar wizard, the Easy and Pro workspaces (spec 009) and the realistic and chibi styles (specs 001, 002). The other styles, species and body composition move to the new M3.5 (spec 013). Later milestones keep their numbers.

## Feature map

| # | Spec | Area | Summary |
|---|------|------|---------|
| 001 | [001-character-composer.md](./001-character-composer.md) | CMP | Slots, parts, sockets, `hides`, tint slots, `CharacterSpec`, randomize |
| 002 | [002-anatomy.md](./002-anatomy.md) | ANA | Bone-scale sliders with child compensation, morph targets, chibi/readability controls |
| 003 | [003-pixel-render-pipeline.md](./003-pixel-render-pipeline.md) | PIX | Low-res rendering, cameras, directions, framing/pivot, toon, outlines, palette/dither, stability, backends, `RenderSettings` |
| 004 | [004-animation.md](./004-animation.md) | ANM | Clip library, clip selection (`RenderSettings.animations`), deterministic frame sampling, ping-pong, root motion, preview playback |
| 005 | [005-export.md](./005-export.md) | EXP | Sprite sheets, layouts, scales, metadata JSON, engine presets, previews, credits, determinism |
| 006 | [006-shader-graph-editor.md](./006-shader-graph-editor.md) | EDT | Node editor UX, search, groups, previews, blackboard, Look panel and presets, error display, v1 node catalog |
| 007 | [007-shader-graph-format.md](./007-shader-graph-format.md) | SGF | Versioned graph JSON, migrations, validation, type system, TSL compiler, reserved built-in param IDs |
| 008 | [008-custom-model-upload.md](./008-custom-model-upload.md) | UPL | Upload formats, security, retargeting, bone maps, OPFS storage, licensing |
| 009 | [009-editor-shell-ux.md](./009-editor-shell-ux.md) | UX | Layout, panels, canonical shortcut registry, command palette, single shared undo history, projects/autosave, multi-tab policy, notifications, theming, a11y, crash recovery. Easy, home and wizard moved to 014 *(2026-10-09)* |
| 010 | [010-website.md](./010-website.md) | WEB | Landing page, Fumadocs guide, docs IA, perf/a11y |
| 011 | [011-asset-pipeline.md](./011-asset-pipeline.md) | AST | Source packs, `verify-rig` (M1 spike), `build-parts`, manifests, thumbnails, licensing, fixtures, contributions |
| 012 | [012-lighting-maps.md](./012-lighting-maps.md) | LIT | Normal, albedo, mask, specular, UV lookup, depth and emission maps for 2D engine lighting; map metadata; Godot/Unity/Phaser lighting presets *(added 2026-10-09 (LIT))* |
| 013 | [013-body-styles-and-species.md](./013-body-styles-and-species.md) | STY | Stickman and voxel (blocky) styles, body composition (weight, muscle), animal and monster species, tails, style gating, licensing limits *(added 2026-10-09 (STY))* |
| 014 | [014-easy-home-wizard.md](./014-easy-home-wizard.md) | UX | Easy and Pro workspaces, Easy workspace, home screen and view routing, new-character wizard, their accessibility, M3 home presets; split from 009, same UX prefix and IDs *(added 2026-10-09)* |

## Area-prefix registry

Each prefix is owned by exactly one spec file. You can only add a new prefix by editing this table. Prefixes are never reused.

| Prefix | Area | Owning spec | Notes |
|--------|------|-------------|-------|
| GEN | Cross-cutting / general | 000-overview.md | Browser support, offline, i18n, global NFRs, origin/CSP hardening |
| CMP | Character composer | 001-character-composer.md | Slots, parts, sockets, tints, `CharacterSpec` |
| ANA | Anatomy | 002-anatomy.md | Bone scales, morphs, proportions |
| PIX | Pixel render pipeline | 003-pixel-render-pipeline.md | Render settings, cameras, directions |
| ANM | Animation | 004-animation.md | Clips, playback, frame sampling |
| EXP | Export | 005-export.md | Sprite sheets, metadata, credits |
| EDT | Shader graph editor (UI) | 006-shader-graph-editor.md | React Flow UI, blackboard |
| SGF | Shader graph format + compiler | 007-shader-graph-format.md | JSON format, migrations, TSL compilation |
| UPL | Custom model upload | 008-custom-model-upload.md | Import, validation, retarget, storage |
| UX | Editor shell UX | 009-editor-shell-ux.md, 014-easy-home-wizard.md | Layout, shortcuts, undo, persistence |
| WEB | Website | 010-website.md | Landing, docs site |
| AST | Asset pipeline | 011-asset-pipeline.md | Bundled asset ingestion, rig verification, manifests, licensing records (PM decision 2026-10-08) |
| LIT | 2D lighting maps | 012-lighting-maps.md | Auxiliary export maps (normal, albedo, mask, specular, UV, depth, emission) and their metadata/presets (PM decision 2026-10-09; added 2026-10-09 (LIT)) |
| STY | Body styles and species | 013-body-styles-and-species.md | Procedural stickman and voxel styles, body composition, animal and monster species, style/species gating (PM decision 2026-10-09; added 2026-10-09 (STY)) |

## Glossary

| Term | Definition |
|------|-----------|
| **Slot** | A named place on a character that holds at most one part at a time (e.g. `hair`, `torso`, `legs`, `feet`, `prop-main-hand`). Defined in the slot registry (spec 001 REQ-CMP-001). |
| **Part** | One selectable asset (skinned mesh or static prop) that fills a slot. It has an ID, a slot, tint slots, `hides` flags and license info. |
| **Socket** | A skeleton joint that static props attach to, with an offset transform. Parts name it by its socket ID (`hand_r`, `hand_l`, `head`, `spine_03`, `pelvis`), not by the joint name (spec 002 REQ-ANA-019). |
| **Socket ID** | Semantic, rig-independent name of a socket (`hand_r`, `hand_l`, `head`, `spine_03`, `pelvis`) used in part manifests and the slot registry. `RigDefinition.socketBones` maps each socket ID to an exact source joint name, e.g. socket `head` → joint `Head` in the Quaternius rig (spec 002 REQ-ANA-019/020). *(Added 2026-10-09 (M1-33).)* M3.5 adds socket `tail` → joint `pelvis` (spec 013 REQ-STY-019). *(Added 2026-10-09 (STY).)* |
| **Skeleton group** | A set of bundled files (bodies, parts, clips) that share one rig (same joint names and hierarchy) **and** the same rest pose within the verify-rig tolerances. One rig has one or more groups, stored in `RigDefinition.skeletonGroups` with their rest poses. The character skeleton uses the body's group (spec 001 REQ-CMP-037); meshes from other groups keep their own inverse bind matrices, and clips from other groups are rest-pose retargeted (spec 004 REQ-ANM-023). The group does not affect part compatibility (spec 001 REQ-CMP-008). Classified by spec 011 REQ-AST-026. *(Added 2026-10-09 (M1-33).)* |
| **Style** | The body style of a character, `CharacterSpec.style`: `realistic` (authored proportions), `chibi` (big head, short limbs; an anatomy preset), `stickman` (procedural lines) or `voxel` (procedural boxes, labelled "Voxel" and described "Blocky, built from cubes" in the UI). Specs 001, 002, 013. *(Added 2026-10-09 (STY).)* |
| **Species** | `CharacterSpec.species`: `human`, `animal` (anthropomorphic, human posture, animal head, tail, ears) or `monster` (humanoid body with horns, spikes, tail, monster head). Spec 013. *(Added 2026-10-09 (STY).)* |
| **Body composition** | `CharacterSpec.composition`: `weight` and `muscle` (−1..1), applied as a CPU-baked bind-space normal inflation of body and outfit meshes. Spec 013 (M3.5). *(Added 2026-10-09 (STY).)* |
| **Hides flags** | A part's list of body regions hidden while it is equipped, to avoid clipping. |
| **Tint slot** | A named recolorable channel (skin, hair, eyes, primary, secondary, metal, leather) mapped to material regions of parts. |
| **Parts manifest** | Data file (validated by `packages/parts-schema`) that lists slots, parts, sockets and tint slots. |
| **Shared skeleton** | The single 65-joint UE5-style rig (`quaternius-ue5-65`) that bundled bodies, outfits and clips share. M1 result (amended 2026-10-09 (M1-33)): joint names, hierarchy and length axis are shared; bind poses differ and form skeleton groups (outcome `mapped`, spec 011 REQ-AST-007, ADR-0008). |
| **Rebind** | Binding a skinned part to the character's shared skeleton by matching bone names. |
| **CharacterSpec** | Versioned, serializable JSON that is the source of truth for a character: name, seed, body, parts per slot, tints, anatomy and morph values, face decal, and from version 2 (2026-10-09 (STY)) style, species and optional body composition. It does **not** contain clip selection; selected clips live in the render settings (`RenderSettings.animations`, spec 004). Used for save, load, share and randomize. |
| **Anatomy** | User-adjustable proportions (height, head/chibi, torso, shoulders, limbs, hands, feet), applied as bone scales with child compensation and/or morph targets. |
| **Child compensation** | Applying the inverse scale on child bones so that scaling a bone does not cascade down the hierarchy. |
| **Render settings** | Output resolution (32–128 px), camera preset, direction count, selected clips (`animations`, spec 004), lighting, toon bands, outline, palette, dither and pipeline graphs (spec 003). Serialized with the project and recorded in the export manifest. |
| **Camera preset** | Orthographic camera setup: `side` (elevation 0°), `three-quarter` (35°), `isometric` (30°, 2:1 pixels) or `custom` (0–90°). Spec 003 REQ-PIX-003/004. |
| **Direction** | One facing of the character produced by model yaw. A sheet has 1, 2, 4 or 8 directions, labelled and ordered by `DIRECTION_ORDER` = `e, ne, n, nw, w, sw, s, se` (spec 003). |
| **Clip** | A named skeletal animation (e.g. `walk`, `attack-1`) from the animation library, referenced by a `ClipRef`. Each selected clip has a unique `label` used in export names (spec 004). |
| **Frame** | One sampled pose of a clip at a given time, rendered to one sprite cell. |
| **Sprite sheet** | Exported PNG atlas of frames (clips × directions × frames) plus metadata JSON and `CREDITS.txt`. |
| **Texel snapping** | Rounding camera/model translation to whole low-res pixels to prevent shimmer. |
| **Palette LUT** | A lookup texture that maps colors to a fixed palette (PICO-8, Endesga-32, custom). |
| **Shader graph** | A node graph (pure TS model in `packages/shader-graph`) compiled to three.js TSL. |
| **Material graph** | A shader graph that defines per-part surface/toon lighting. |
| **Post graph** | A shader graph that defines post-process stages (outline, palette, dither) on the MRT outputs. |
| **MRT** | Multiple render targets: color, normal, depth and part-ID written in one scene pass. |
| **Node type** | A versioned node definition (`type@ver`) with typed input/output sockets with stable string IDs. |
| **Blackboard** | The panel of exposed graph parameters (min/max/default) shown as sliders to non-experts. |
| **Subgraph** | A reusable node group with Group Input/Output nodes. The built-in pipeline stages ship as editable subgraphs. |
| **Preset** | A saved graph or `CharacterSpec`, shared as a file or a compressed URL. |
| **Bone map** | A mapping from a source rig's bone names to the shared skeleton's names (presets: Mixamo, VRM humanoid, UE5; auto-map + manual). |
| **Retarget** | Transferring animation from the shared skeleton to an uploaded rig (or the reverse) using the bone map and rest-pose correction. |
| **Budget** | Upload limits (tris, textures, bones, influences, file size) enforced before a model is accepted. |
| **OPFS** | Origin Private File System: browser-local storage for uploaded binaries. Metadata lives in IndexedDB. |
| **Lighting map** | An auxiliary export image with the same layout and alpha as the colour sheet that carries data for runtime 2D lighting or recolouring instead of final colour (normal `_n`, albedo `_albedo`, mask `_m`, specular `_s`, UV lookup `_uv`, depth `_d`, emission `_e`). Spec 012. *(Added 2026-10-09 (LIT).)* |
| **Credits** | Auto-generated `CREDITS.txt` that lists the license, author and source of every asset in an export. |
| **Backend** | The active renderer path: WebGPU, or the WebGL2 fallback of `WebGPURenderer`. |
| **Dedicated origin** | A scheme + host + port that serves only this project's deploy artifact, so no other site can read its browser storage (REQ-GEN-009). |

## Requirements (cross-cutting)

**REQ-GEN-001 [P1]** THE SYSTEM SHALL run the editor in the latest stable Chrome, Edge and Firefox, and in the latest stable Safari plus the previous major Safari version, using WebGPU where available and the WebGL2 fallback otherwise.

- **AC-GEN-001.1** Given the latest stable Chrome, Edge, Firefox and Safari, and the previous major Safari version, When the editor loads the default character, Then the preview renders with no console errors in each browser (CI E2E matrix: Chromium, Firefox, WebKit; the previous Safari major is checked in the release smoke test).
- **AC-GEN-001.2** Given the renderer is forced to WebGL2 (`forceWebGL: true`), When the default character is exported at 64 px, Then export succeeds and the pixel output matches the WebGL2 golden image exactly.
- **AC-GEN-001.3** Given a browser with neither WebGPU nor WebGL2, When the editor loads, Then a readable message names the missing capability and links to supported browsers, and no blank canvas is shown.

**REQ-GEN-002 [P1]** THE SYSTEM SHALL show which renderer backend is active (WebGPU or WebGL2) in the editor's About/diagnostics view.

- **AC-GEN-002.1** Given the editor is running, When the user opens diagnostics, Then the backend name and the three.js version (r186) are shown.

**REQ-GEN-003 [P1]** THE SYSTEM SHALL NOT send user-created or user-uploaded content over the network (constitution P-03).

- **AC-GEN-003.1** Given an E2E session that uploads a model, edits a character and exports, When all network requests are recorded, Then no request goes to a host other than the app's own origin, and no request body contains user file bytes.

**REQ-GEN-004 [P2]** WHEN the app has been loaded once successfully THE SYSTEM SHALL work offline, including the editor, bundled assets that have been cached, and export.

- **AC-GEN-004.1** Given the editor was loaded once online, When the browser goes offline and the page reloads, Then the editor loads, the default character renders and an export completes.
- **AC-GEN-004.2** Given an offline session, When the user picks a bundled part that was never cached, Then a non-blocking message says it is unavailable offline, and the current character is unchanged.

**REQ-GEN-005 [P2]** WHEN a new app version is deployed THE SYSTEM SHALL tell the user an update is available and apply it only after the user confirms or reloads.

- **AC-GEN-005.1** Given an open editor and a new deployment, When the service worker detects the update, Then a toast offers "Reload to update", and unsaved state is not discarded without confirmation.

**REQ-GEN-006 [P3]** THE SYSTEM SHALL source all user-facing UI strings from locale message catalogs, with English (`en`) as the default and fallback.

- **AC-GEN-006.1** Given the source of `apps/web`, When the i18n lint check runs, Then no JSX text node or user-visible attribute (`aria-label`, `title`, `placeholder`) contains a hard-coded string literal.
- **AC-GEN-006.2** Given a pseudo-locale that expands strings by 40 %, When the editor renders, Then no essential control text is clipped or overlaps at 1280×800.

**REQ-GEN-007 [P1]** THE SYSTEM SHALL meet the performance budgets in constitution P-07 on the reference machine.

- **AC-GEN-007.1** Given the production build, When Lighthouse CI runs on the editor, Then LCP ≤ 2.5 s and initial gzipped JS ≤ 400 KB.
- **AC-GEN-007.2** Given 8 equipped parts at 64 px with the default pipeline, When the preview runs for 10 s, Then p95 frame time ≤ 16.7 ms.
- **AC-GEN-007.3** Given the production build of `apps/web`, When the bundle is analysed, Then (a) the gzipped sizes of the entry chunk plus every chunk in its static import graph (including `modulepreload`ed chunks) sum to ≤ 400 KB, (b) none of those chunks contains a module from `three` or `@csg/engine`, and (c) in a Chromium trace of a cold load the request for the engine chunk starts after first contentful paint.

Reading of P-07 "initial JS before 3D assets load" (amended 2026-10-09 (M2-19), PM decision): "initial JS" is the JavaScript loaded before first paint, i.e. the entry chunk and its static imports. The engine/three chunk, fetched through a dynamic `import()` after first paint, counts as a 3D asset and is outside the 400 KB budget; it still counts toward LCP and the ≤ 5 s interactive budget of P-07. Measured at M2-19 (2026-10-09): initial JS 104.6 kB gzipped; lazy engine chunk 307 kB gzipped. This note clarifies the constitution wording and does not change it; moving the reading into P-07 itself needs the constitution amendment process.

**REQ-GEN-008 [P1]** THE SYSTEM SHALL record the license of every bundled asset in the parts manifest and reject a manifest entry that has no license, author or source URL (constitution P-02).

- **AC-GEN-008.1** Given a manifest entry missing `license`, When `parts-schema` validation runs, Then validation fails and names the entry's ID and the missing field.

### Origin and browser hardening (security review 2026-10-08)

The app has no server, so the browser origin is the only security boundary around the user's
library, projects and preferences. Anything else served from the same origin (another GitHub
Pages project of the same owner, a demo, a preview deploy) can read and rewrite IndexedDB, OPFS
and localStorage, and talk on the same `BroadcastChannel`s. GitHub Pages cannot set response
headers. So the CSP below is delivered as a `<meta http-equiv>` element, and directives that only
work as headers (`frame-ancestors`, `sandbox`, `report-uri`) are unavailable. REQ-GEN-012
replaces `frame-ancestors`.

**REQ-GEN-009 [P1]** THE SYSTEM SHALL be served from an origin (scheme + host + port) that hosts no other site or app; WHERE the deploy is configured as not dedicated (`DEDICATED_ORIGIN=false`, e.g. a shared `<owner>.github.io` project path or a preview deploy), THE SYSTEM SHALL disable persistent upload storage and behave as in spec 008 when storage is unavailable (`UPL_STORAGE_UNAVAILABLE`). Origin: security review 2026-10-08.
[NEEDS CLARIFICATION: production domain. Custom domain (e.g. `sprites.example.org`) or a dedicated GitHub org whose `<org>.github.io` Pages hosts only this project? Also confirm that the project's own static site (spec 010, built in the same artifact) counts as "this app" and may share the origin. Owner: maintainers. Blocks the M5 release with persistent uploads, not M1–M4.]

- **AC-GEN-009.1** Given a production build with `DEDICATED_ORIGIN=false`, When a GLB is uploaded and saved, Then nothing is written to OPFS or IndexedDB, the asset works for the session, and the `UPL_STORAGE_UNAVAILABLE` banner is visible.
- **AC-GEN-009.2** Given the deploy workflow for the production target, When it runs, Then it fails unless `DEDICATED_ORIGIN` is set explicitly (`true` or `false`) and, if `true`, the target host is on the maintained allowlist in the workflow (0 unlisted hosts).

**REQ-GEN-010 [P1]** THE SYSTEM SHALL ship the editor's `index.html` with this Content Security Policy as a `<meta http-equiv="Content-Security-Policy">` element that is the first element in `<head>` (only `<meta charset>` may precede it; no `<script>`, `<link>`, `<style>` or `<base>` before it):
~~`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'`.~~ (superseded 2026-10-09 (M2-23s): `trusted-types` directive appended, see below)
`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types csg-worker-url`.
Amended 2026-10-09 (M2-23s), PM decision B: the policy gains `; trusted-types csg-worker-url` at the end and nothing else changes. It limits policy creation to the single REQ-GEN-014 policy name, forbids a `default` policy, and forbids creating `csg-worker-url` twice (no `'allow-duplicates'`).
WASM decoders (Draco, Basis/KTX2, Meshopt) and `gltf-validator` SHALL be copied at build time from version-pinned npm packages and checked against SHA-256 hashes committed in the repository. Runtime code SHALL never reference a CDN decoder path. Origin: security review 2026-10-08.

- **AC-GEN-010.1** Given the production build, When `dist/app/index.html` is parsed, Then the first element in `<head>` other than `<meta charset>` is the CSP meta element and its `content` equals the policy above, byte for byte. Amended 2026-10-09 (M2-23s): the expected string is the current (non-struck) REQ-GEN-010 policy, ending in `require-trusted-types-for 'script'; trusted-types csg-worker-url`; the superseded string without `trusted-types` fails this AC.
- **AC-GEN-010.2** Given the E2E suite (all specs, Chromium, Firefox and WebKit) running against the production build, When any `securitypolicyviolation` event fires or the console logs a CSP violation, Then the test fails (0 violations allowed).
- **AC-GEN-010.3** Given a decoder file whose bytes differ from its committed SHA-256 hash, When the build runs, Then the build fails and names the file.
- **AC-GEN-010.4** Given the built JS bundles, When scanned, Then they contain 0 occurrences of `gstatic.com`, `unpkg.com`, `jsdelivr.net` or any other absolute `https://` decoder path, and the three.js `setDecoderPath` calls use same-origin relative paths only.

**REQ-GEN-011 [P1]** IF any JSON parsed from a document, clip, user asset record, preference, share-link fragment or import archive contains an object key `__proto__`, `constructor` or `prototype` at any depth THEN THE SYSTEM SHALL reject the whole input with the owning area's validation error (spec 001, 004, 007, 008 or 009) before schema validation or migration runs. Origin: security review 2026-10-08.

- **AC-GEN-011.1** Given one fixture per input type (`CharacterSpec`, `ProjectDocument`, graph document, user clip record, `UserAssetRecord`, `BoneMapPreset`, preference blob, `#c=` share fragment, `library.json`), each with `{"__proto__": {"polluted": 1}}` nested 3 levels deep, When each is loaded, Then each is rejected with its area's error, and afterwards `({}).polluted === undefined` and `Object.prototype` has no new own keys.
- **AC-GEN-011.2** Given the same fixtures with key `constructor` or `prototype` at the top level, When loaded, Then each is rejected.
- **AC-GEN-011.3** Given a document with a key `__proto__` inside a string value (not a key), When loaded, Then it is accepted.

**REQ-GEN-012 [P2]** IF the editor is loaded inside a frame (`window.self !== window.top`, or reading `window.top` throws) THEN THE SYSTEM SHALL render only an "Open in a new tab" link (to the current URL, `target="_blank"`, `rel="noopener noreferrer"`) and SHALL NOT open IndexedDB or OPFS, read or write localStorage or sessionStorage, open a `BroadcastChannel`, or register a service worker. Origin: security review 2026-10-08.

- **AC-GEN-012.1** Given a cross-origin test page that embeds `<basePath>/app/` in an `<iframe>`, When it loads, Then the frame shows only the "Open in a new tab" link, and spies record 0 calls to `indexedDB.open`, `navigator.storage.getDirectory`, `localStorage`/`sessionStorage` access, `new BroadcastChannel` and `navigator.serviceWorker.register`.
- **AC-GEN-012.2** Given the same page embedded same-origin, When it loads, Then the result is the same as AC-GEN-012.1.
- **AC-GEN-012.3** Given the editor in a top-level tab, When it loads, Then the frame guard adds ≤ 5 ms to startup and the editor renders normally.

**REQ-GEN-013 [P1]** THE SYSTEM SHALL treat everything read from IndexedDB, OPFS, localStorage, sessionStorage and `BroadcastChannel` as untrusted input and validate it with the same schema, migrations and limits as the matching file import (specs 001, 004, 007, 008, 009) before use; IF an item fails validation THEN THE SYSTEM SHALL not use it, keep the editor running, and report the owning area's error. Origin: security review 2026-10-08.

- **AC-GEN-013.1** Given an IndexedDB `UserAssetRecord` edited to `sourceUrl: "javascript:alert(1)"`, When the library opens, Then that asset is not listed as valid, the area's error is shown, no dialog event fires, and the other assets load.
- **AC-GEN-013.2** Given an autosaved project in storage whose graph has 4,001 flattened nodes (one above the spec 007 limit), When the editor starts, Then the project is not loaded, the editor shows the default project, and the error is spec 007's limit error naming "4,000 flattened nodes".
- **AC-GEN-013.3** Given a `BroadcastChannel` message that is not valid JSON, has unknown fields, or is larger than 64 KB, When received, Then it is ignored with a debug log entry and no state changes.
- **AC-GEN-013.4** Given a localStorage preference value of the wrong type (e.g. `"theme": 42`), When the editor starts, Then the default for that preference is used and the other preferences still apply.

**REQ-GEN-014 [P1]** ~~THE SYSTEM SHALL install, before any module worker is created, a Trusted Types policy (named or default) whose only factory is `createScriptURL`, which returns a `TrustedScriptURL` only for URLs that resolve to the editor's own origin and rejects (throws for) every other URL, including cross-origin, `blob:` and `data:` URLs; the policy SHALL define no `createHTML` and no `createScript`, and THE SYSTEM SHALL NOT relax or otherwise change the REQ-GEN-010 policy (in particular `worker-src 'self'` and `require-trusted-types-for 'script'` stay as written). [NEEDS CLARIFICATION: exact policy shape, `default` policy versus a named policy passed explicitly at each `new Worker()` call site, and the policy name if named. Per security review M2-23s; owner: security-engineer. Does not block the behaviour below, which holds for either shape.]~~ (superseded 2026-10-09 (M2-23s): policy shape resolved by PM decision A; the clarification is closed.)
THE SYSTEM SHALL create one named Trusted Types policy, `csg-worker-url`, before any other application module runs, and SHALL start every worker only with a `TrustedScriptURL` produced by this policy. The policy's only factory is `createScriptURL`; it defines no `createHTML` and no `createScript`, and THE SYSTEM SHALL NOT create a `default` policy. `createScriptURL(input)` SHALL return a `TrustedScriptURL` only when all of these hold for `new URL(input, document.baseURI)`:
(a) the scheme is `https:` or `http:`;
(b) the origin equals the editor's origin (`self.origin`);
(c) `username` and `password` are empty;
(d) there is no fragment (`hash` is empty and the input contains no `#`);
(e) the serialized URL (`href`) equals, byte for byte, one entry of the module-worker URL allowlist that the editor build emits (a fixed list generated at build time from the bundler's module-worker outputs, resolved against the deploy base path; nothing is added at runtime).
For every other input the factory SHALL throw a `TypeError` and return nothing, including `blob:` and `data:` URLs, cross-origin and protocol-relative URLs, other same-origin paths and other projects' paths on a shared origin (REQ-GEN-009), and any input that contains a backslash, a `.` or `..` path segment, or a percent-encoded dot (`%2e`, `%2E`), even when it would normalize onto an allowlisted URL.
Engine packages (`@csg/engine` and any other `packages/*`) SHALL NOT construct workers from URL strings in browser builds; they SHALL receive worker factories (`() => Worker`) from the host app (`apps/web`), which creates them through this policy. THE SYSTEM SHALL NOT relax the REQ-GEN-010 policy beyond its amended text (the 2026-10-09 (M2-23s) `trusted-types csg-worker-url` addition is part of that policy, not a relaxation).
Purpose: start same-origin module workers, such as the palette LUT worker (spec 003 REQ-PIX-021), under REQ-GEN-010. Added 2026-10-09 (M2-19), PM decision; amended 2026-10-09 (M2-23s), PM decision A (security review M1, L3).

- **AC-GEN-014.1** Given the production build in Chromium with the REQ-GEN-010 CSP, When the editor loads and the palette LUT worker starts and returns a LUT, Then 0 `securitypolicyviolation` events fire and 0 CSP or Trusted Types violations are logged to the console. Amended 2026-10-09 (M2-23s), security review M3: the E2E SHALL force a palette LUT build (select a palette whose LUT is not cached, e.g. switch from `pico-8` to `endesga-32`) and SHALL assert that the LUT came from the worker path, i.e. exactly 1 worker was created through `csg-worker-url` and returned the LUT, and the main-thread fallback builder ran 0 times; a silent fallback to the main thread fails this AC.
- **AC-GEN-014.2** Given the installed policy, When it is asked for a script URL for a cross-origin URL (e.g. `https://example.org/w.js`), a `blob:` URL or a `data:text/javascript,` URL, Then it throws, no `TrustedScriptURL` is returned, and no worker is started.
- **AC-GEN-014.3** Given the installed policy, When its `createHTML` or `createScript` is invoked (or, for a default policy, a string is assigned to `innerHTML` or passed to `eval`), Then the call throws a `TypeError` and the sink is not reached. Amended 2026-10-09 (M2-23s): no `default` policy exists, so a string assigned to `innerHTML` or passed to `eval` is blocked by `require-trusted-types-for 'script'` (a `TypeError`, sink not reached), and `trustedTypes.createPolicy('default', …)` (or a second `csg-worker-url`) throws under `trusted-types csg-worker-url`. These negative probes trigger `securitypolicyviolation` events by design, so they run in a dedicated test that expects exactly those events and are excluded from the AC-GEN-010.2 zero-violation count.
- **AC-GEN-014.4** Given the production build, When `dist/app/index.html` is parsed, Then the CSP meta `content` still equals the REQ-GEN-010 policy byte for byte ~~(AC-GEN-010.1 unchanged)~~. Amended 2026-10-09 (M2-23s): the expected string is the amended REQ-GEN-010 policy ending in `require-trusted-types-for 'script'; trusted-types csg-worker-url` (as in AC-GEN-010.1), and no other directive differs from REQ-GEN-010.
- **AC-GEN-014.5** Given the installed `csg-worker-url` policy on origin `<origin>` and the build allowlist containing the palette worker URL `<origin><base>/assets/<palette-worker>.js`, When `createScriptURL` is called with each of: `<origin><base>/assets/other.js` (same origin, not allowlisted); `<origin>/<other-project>/assets/<palette-worker>.js` (another project's path on a shared origin); `blob:<origin>/<uuid>`; `//evil.example/w.js`; `https://<host>@evil.example/w.js`; `https://<user>:<pass>@<host><base>/assets/<palette-worker>.js`; the allowlisted URL with `#x` appended; and a traversal such as `<origin><base>/assets/%2e%2e/assets/<palette-worker>.js` or `<origin><base>/x/%2e%2e/assets/<palette-worker>.js`, Then every call throws a `TypeError`, no `TrustedScriptURL` is returned, and 0 workers start; and When it is called with the allowlisted URL itself (absolute, or relative to `document.baseURI`), Then it returns a `TrustedScriptURL` whose string value equals the allowlisted URL. *(Added 2026-10-09 (M2-23s).)*
- **AC-GEN-014.6** Given the production build, When it is loaded with a module-load spy, Then the module that creates `csg-worker-url` evaluates before every other application module (it is the first import of the entry chunk), `trustedTypes.getPolicyNames()` (where available) is exactly `["csg-worker-url"]`, and a static check of the built `packages/*` browser code and their sources finds 0 `new Worker(` or `new SharedWorker(` calls taking a string or `URL` argument (workers come only from host-supplied factories). *(Added 2026-10-09 (M2-23s).)*

**REQ-GEN-015 [P1]** THE SYSTEM SHALL NOT call `fetch`, `importScripts`, dynamic `import()`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `new Function` or `eval` in any worker script (source files matching `**/*.worker.ts`), and SHALL enforce this with an ESLint rule that runs in `pnpm lint`; WHERE the host serving the editor can set HTTP response headers, THE SYSTEM SHALL serve every worker script with the REQ-GEN-010 policy as a `Content-Security-Policy` response header. Rationale: a module worker loaded from a same-origin URL does not inherit the document's `<meta>` CSP, so on a host without headers (GitHub Pages, REQ-GEN-009) this lint rule is the worker's only network and eval guard. Whether the production host can set headers follows the REQ-GEN-009 domain decision (see Open questions). Added 2026-10-09 (M2-23s), PM decision B (security review M2).

- **AC-GEN-015.1** Given a lint fixture `fixtures/lint/bad.worker.ts` that calls `fetch('/x')`, When ESLint runs with the project config, Then it reports 1 error from the worker-hygiene rule on that line; and given one fixture per other banned API (`importScripts`, `import()`, `new WebSocket`, `new EventSource`, `new XMLHttpRequest`, `new Function`, `eval`), Then each reports 1 error.
- **AC-GEN-015.2** Given the palette LUT worker source (spec 003 REQ-PIX-021) and its built bundle, When `pnpm lint` runs and the built worker chunk is scanned for the banned identifiers, Then lint reports 0 worker-hygiene errors and the scan finds 0 occurrences of `fetch(`, `importScripts(`, `import(`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `Function(` or `eval(`.
- **AC-GEN-015.3** Given a deploy target configured as able to set headers, When a worker script URL from the REQ-GEN-014 allowlist is requested, Then the response carries a `Content-Security-Policy` header equal, byte for byte, to the REQ-GEN-010 policy. [NEEDS CLARIFICATION: which production host (REQ-GEN-009) and whether it can set headers; until decided this AC is checked against the E2E static server only. Owner: maintainers.]

**REQ-GEN-016 [P2]** WHEN the main thread receives a message from a worker THE SYSTEM SHALL validate it before use (known `type`, `id` equal to a pending request, payload size and shape as the request expects, e.g. a palette LUT of exactly 512 × 512 × 4 = 1,048,576 bytes for spec 003 REQ-PIX-021), SHALL ignore and debug-log a message that fails validation, SHALL fail a request that gets no valid response within its timeout, and SHALL handle `messageerror` and `error` events by failing the pending requests of that worker. A failed request SHALL keep the previous state (for the palette LUT: the preview keeps the previous palette, AC-PIX-021.2) and report the owning area's error; it SHALL NOT silently fall back to another code path without that error being observable (AC-GEN-014.1). Added 2026-10-09 (M2-23s), security review L1.

- **AC-GEN-016.1** Given a stub worker that replies with an unknown `type`, an `id` that is not pending, and a LUT of 1,048,575 bytes, When each reply arrives, Then each is ignored with a debug log entry and the pending request stays pending until a valid reply or its timeout.
- **AC-GEN-016.2** Given a stub worker that never replies, When a palette LUT build is requested, Then the request fails after its timeout (default 5,000 ms, i.e. 20× the 250 ms budget of AC-PIX-021.2; mockable clock), the previous palette stays active, and the owning area's error is reported once.
- **AC-GEN-016.3** Given a worker that fires `messageerror` (or `error`), When it happens with 2 pending requests, Then both fail with the owning area's error within 1 task and no unhandled promise rejection occurs.

## Edge cases

- WebGPU available but adapter request fails → fall back to WebGL2 (REQ-GEN-001, AC-GEN-001.2).
- Storage quota exceeded or persistence denied → covered in 008 / 009 (UPL, UX).
- Different backends produce different pixels → determinism is guaranteed per backend only (P-04). Goldens are kept per backend.
- Local dev server (`vite dev`) needs inline scripts and HMR sockets → the CSP of REQ-GEN-010 applies to production builds only; E2E (AC-GEN-010.2) always runs against the production build.
- Browser without Trusted Types support → it ignores `require-trusted-types-for`; the other CSP directives and the `innerHTML` lint ban (spec 008 REQ-UPL-014) still apply.
- Browser without the `trustedTypes` global → REQ-GEN-014 installs no policy and workers start from plain same-origin URL strings; `worker-src 'self'` still blocks cross-origin, `blob:` and `data:` workers. Added 2026-10-09 (M2-19). Amended 2026-10-09 (M2-23s): ~~workers start from plain same-origin URL strings~~ the host still runs the same `csg-worker-url` validation (REQ-GEN-014 (a)–(e)) and starts the worker from the validated string; inputs it rejects start no worker.
- Shared origin (`DEDICATED_ORIGIN=false`, REQ-GEN-009) → another project's worker on the same origin passes `worker-src 'self'` but fails the REQ-GEN-014 build-time allowlist (AC-GEN-014.5). Added 2026-10-09 (M2-23s).
- Worker script served without a CSP header (e.g. GitHub Pages) → the document's `<meta>` CSP does not apply inside the worker; REQ-GEN-015's lint rule is the guard. Added 2026-10-09 (M2-23s).
- Module worker URL that the bundler emits as a `blob:` or `data:` URL (e.g. an inlined worker) → rejected by REQ-GEN-014 and `worker-src 'self'`; workers must be emitted as same-origin files. Added 2026-10-09 (M2-19).
- Preview deploys (pull-request previews) → they share a host with other previews, so they are built with `DEDICATED_ORIGIN=false` (REQ-GEN-009).
- Editor opened in a frame by a legitimate embedder (e.g. the spec 010 landing demo) → the demo must link to the editor, not embed it (REQ-GEN-012).

## Non-functional

See constitution P-03 (privacy), P-04 (determinism), P-05 (stability), P-06 (accessibility, WCAG 2.2 AA) and P-07 (performance budgets).

## Open questions

- ~~[NEEDS CLARIFICATION: Is the shared 65-joint skeleton across Quaternius packs real? Blocks the final 001/002/004 contracts. Resolved by the M1 asset spike `tools/verify-rig.ts`.]~~ Resolved 2026-10-09 (M1-33): outcome `mapped`. Names, hierarchy and length axis are shared across all checked files; bind poses form skeleton groups, handled by rebinding with per-mesh inverse bind matrices and runtime rest-pose retargeting (spec 011 REQ-AST-007/026, spec 004 REQ-ANM-023, ADR-0008).
- ~~Does the AST area get its own spec?~~ Resolved 2026-10-08 (PM): yes, `011-asset-pipeline.md`.
- ~~Which Safari version is the minimum?~~ Resolved 2026-10-08 (PM): latest stable plus the previous major. REQ-GEN-001 and AC-GEN-001.1 updated.
- [NEEDS CLARIFICATION: Exact specification of the reference mid-range machine for perf CI. Partly resolved 2026-10-08 (PM): CI uses software throttling (e.g. Chromium 4× CPU throttling, as in AC-EDT-053.1 and AC-SGF-025.2); runs on real reference hardware are deferred, so this question stays open.]
- [NEEDS CLARIFICATION: production domain for REQ-GEN-009 (custom domain or dedicated org Pages), and whether the spec 010 site may share the editor origin. Spec 010 currently deploys site + editor as one artifact under `<basePath>/app/`, which is compatible only if the whole origin is dedicated to this project. Owner: maintainers; spec 010 owner to align.]
- [NEEDS CLARIFICATION: three.js `DRACOLoader` and `KTX2Loader` start their decoders in `blob:` workers, which `worker-src 'self'` (REQ-GEN-010) blocks and Trusted Types flags. Proposal: call the decoder WASM modules directly inside the spec 008 upload worker, with no nested `blob:` workers. Owner: asset-pipeline-engineer, before M5.]
- [NEEDS CLARIFICATION: Does the spec 010 landing demo (AC-WEB-027.x) embed the editor in an iframe? If so it conflicts with REQ-GEN-012. Owner: spec 010 owner.]
- ~~[NEEDS CLARIFICATION: REQ-GEN-014 Trusted Types policy shape (`default` policy versus a named policy used explicitly at each worker call site) and name. Per security review M2-23s; owner: security-engineer. Non-blocking for M2: AC-GEN-014.1..4 hold for either shape.]~~ Resolved 2026-10-09 (M2-23s), PM decision A: one named policy `csg-worker-url` with a build-time worker URL allowlist, no `default` policy, enforced by `trusted-types csg-worker-url` in REQ-GEN-010; engine packages receive worker factories from the host.
- [NEEDS CLARIFICATION: whether the production host (REQ-GEN-009 domain decision) can set response headers, so that worker scripts get the REQ-GEN-010 policy as a header (REQ-GEN-015, AC-GEN-015.3). Owner: maintainers. Non-blocking for M2: the lint rule of REQ-GEN-015 applies on every host.]

## References

- `.tagconn/work/research.md` (research brief, 2026-10-08)
- `specs/constitution.md`
- `docs/architecture.md`, `docs/adr/*` (in progress)
- EARS: Mavin et al., "Easy Approach to Requirements Syntax", RE'09
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- three.js WebGPURenderer / TSL: https://threejs.org/docs/
- Security review 2026-10-08 (origin of REQ-GEN-009..013)
- MDN, CSP via `<meta>` (`frame-ancestors`, `report-uri`, `sandbox` not supported): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy (accessed 2026-10-08)
- Trusted Types and browser support: https://web.dev/articles/trusted-types (accessed 2026-10-08)
- MDN, Trusted Types API (`createPolicy`, default policy, `TrustedScriptURL` for `Worker`): https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API (accessed 2026-10-09)
- M2-19 performance measurements and PM decisions, 2026-10-09 (origin of REQ-GEN-014 and AC-GEN-007.3)
- Security review M2-23s and PM decisions A+B, 2026-10-09 (origin of the REQ-GEN-010/014 amendments and REQ-GEN-015/016)
- PM decision 2026-10-09 (STY): styles and species, M3 scope, M3.5 milestone, STY prefix, M1/M2 done
- MDN, CSP `trusted-types` directive (policy-name allowlist, `'allow-duplicates'`): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/trusted-types (accessed 2026-10-09)
- MDN, CSP for workers (workers get their own policy from the worker script's response headers): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP (accessed 2026-10-09)
- `require-trusted-types-for` reference: https://next.centralcsp.com/en/docs/web-security/policies/content-security-policy/directives/require-trusted-types-for (accessed 2026-10-08)
- OWASP Prototype Pollution Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html (accessed 2026-10-08)
