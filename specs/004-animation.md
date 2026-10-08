---
id: ANM
title: Animation (clip library, playback, frame sampling)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 003-pixel-render-pipeline, 005-export, 008-custom-model-upload, 011-asset-pipeline]
last_updated: 2026-10-08
---

# 004 – Animation

## Rules for IDs

`REQ-ANM-NNN` and `AC-ANM-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused.

## Context

Sprites need animations: idle, walk, run, attack, hurt, death and more. The bundled source is the CC0 Quaternius **Universal Animation Library** (UAL). It has 120+ clips in the full set and 45 in the free Standard tier, covering 8-direction locomotion, jog, sprint, combat, deaths and emotes. It ships with root motion and without root motion. UAL v2.0 switched to a bone naming scheme that matches Quaternius' outfits and base characters. The research brief claims one shared 65-joint skeleton across all packs; this is **unverified until the M1 spike** (spec 011). Items marked *(M1-gated)* depend on it.

This spec covers the clip library (data), choosing clips for export, deterministic frame sampling, per-direction behavior, root motion and preview playback. Uploaded and retargeted clips come from spec 008 through the hook in REQ-ANM-016. The camera, texel snapping and union-bounds framing belong to spec 003. Sheet layout and metadata files belong to spec 005.

## Goals

- G1: Pick clips from a searchable library and preview them on the composed character.
- G2: Turn each selected clip into a fixed number of frames with exact, reproducible sample times (P-04).
- G3: In-place sprites by default, with root motion available as metadata.
- G4: The preview can show exactly the frames that will be exported.

## Non-goals

- NG1: Animation authoring, keyframe editing, IK or blending between clips.
- NG2: Per-direction different clips by default. Every direction renders the same clip from a rotated model. A per-direction override is P3 (REQ-ANM-012).
- NG3: Mirroring directions to save render time. Owned by spec 003 (`mirrorWest`, REQ-PIX-006); it does not change sample times.
- NG4: Physics, cloth or hair simulation.

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to pick idle, walk and attack from a list | my sheet has the animations my game needs |
| US-2 | P1 | indie game dev | to set frame count and fps per clip | sprites fit my engine's timing |
| US-3 | P1 | pixel artist | in-place clips | frames are aligned and easy to edit |
| US-4 | P2 | indie game dev | root-motion offsets in the metadata | my game moves the sprite like the source clip |
| US-5 | P2 | any user | to scrub and step frames in the preview | I check poses before export |
| US-6 | P2 | tech artist | to use my own retargeted clips | I am not limited to the bundled library |

## Requirements

### Clip library

**REQ-ANM-001 [P1]** THE SYSTEM SHALL load bundled clips from a clip manifest (`ClipManifest`, see Data & contracts) validated by `@csg/parts-schema`, and list each clip with its name, category, duration and default loop mode.

- **AC-ANM-001.1** Given the bundled UAL clip manifest, When the animation panel opens, Then clips are grouped by category (`locomotion`, `combat`, `reaction`, `death`, `emote`, `misc`) and each shows its duration in seconds with 2 decimals.
- **AC-ANM-001.2** Given a clip manifest entry with `durationSec <= 0` or a duplicate `id`, When validated, Then validation fails naming the clip ID.

**REQ-ANM-002 [P1]** THE SYSTEM SHALL list only clips whose `rig` equals the current body's rig, or clips that have a bone map to it (spec 008). *(M1-gated)*

- **AC-ANM-002.1** Given a body on rig `quaternius-ue5-65` and a clip on rig `other`, with no bone map, When the panel lists clips, Then the clip is hidden by default; with "Show incompatible" on, it is shown disabled with the reason "Different skeleton".

**REQ-ANM-003 [P2]** WHEN the user types in the clip search field THE SYSTEM SHALL filter clips by case-insensitive match on name, id and tags within 100 ms for 500 clips.

- **AC-ANM-003.1** Given 500 clips, When the user types "sword", Then only matching clips are listed within 100 ms of the last keystroke.

### Selecting clips for export

**REQ-ANM-004 [P1]** THE SYSTEM SHALL let the user select 1–32 clips for export and store each selection in `RenderSettings.animations` in the user's order, with `clipId` (a `ClipRef`), `label`, `frameCount`, `fps`, `loop`, optional `pingPong`, optional `range` and `timing`.

- **AC-ANM-004.1** Given `idle` and `walk` selected, When settings are serialized, Then `animations` holds two entries in selection order, each with manifest defaults for `frameCount`, `fps` and `loop`.
- **AC-ANM-004.2** Given 32 clips selected, When the user tries to add a 33rd, Then the add control is disabled with the text "Maximum 32 animations per export".
- **AC-ANM-004.3** Given the selection list, When the user reorders with keyboard (Alt+Up/Down) or drag, Then `animations` order changes and the change is one undo step (spec 009).

**REQ-ANM-005 [P1]** THE SYSTEM SHALL validate per-clip settings: `frameCount` integer 1–64, `fps` integer 1–60, `range` within `[0, durationSec]` with `start < end`.

- **AC-ANM-005.1** Given `frameCount = 65`, When entered, Then the value is rejected with "Frames must be 1–64" and the previous value is kept.
- **AC-ANM-005.2** Given `range = [1.2, 0.8]`, When validated, Then validation fails naming `range`.

**REQ-ANM-006 [P2]** WHEN the user adds the same clip twice THE SYSTEM SHALL allow it and require a unique `label` per entry for metadata naming.

- **AC-ANM-006.1** Given `attack-1` added twice, When the second is added, Then its label defaults to `attack-1-2` and export metadata uses the labels as animation names.

### Frame sampling (deterministic)

**REQ-ANM-007 [P1]** THE SYSTEM SHALL compute sample times only from the clip settings, with no wall-clock input. Let `s, e` be the range (default `[0, durationSec]`), `D = e − s` and `N = frameCount`. Times SHALL be:
- `timing: 'fit'` (default), `loop: true`: `t_i = s + i·D/N` for `i = 0…N−1` (the last frame does not repeat the first);
- `timing: 'fit'`, `loop: false`: `t_i = s + i·D/(N−1)` for `N ≥ 2` (first and last poses included); `t_0 = s` for `N = 1`;
- `timing: 'fixed-fps'`: `t_i = s + i/fps`, clamped to `e`.

- **AC-ANM-007.1** Given `durationSec = 1.0`, loop, `fit`, `N = 8`, When times are computed, Then they are `[0, 0.125, 0.25, …, 0.875]` exactly (IEEE-754 double).
- **AC-ANM-007.2** Given the same clip, `loop: false`, `N = 5`, When computed, Then the times are `[0, 0.25, 0.5, 0.75, 1.0]`.
- **AC-ANM-007.3** Given `fixed-fps`, `fps = 10`, `N = 15`, `durationSec = 1.0`, When computed, Then `t_10…t_14` equal `1.0` and a warning "15 frames at 10 fps exceed the clip (1.00 s)" is shown.
- **AC-ANM-007.4** Given the sampler module, When statically checked, Then it does not read `Date.now`, `performance.now`, `Math.random` or the `AnimationMixer` accumulated time.

**REQ-ANM-008 [P1]** THE SYSTEM SHALL evaluate each sample by setting the clip time directly (absolute seek), never by accumulating deltas, so that the pose at `t_i` does not depend on previously sampled frames.

- **AC-ANM-008.1** Given frames sampled in order 0…7 and in order 7…0, When the bone matrices for frame 3 are compared, Then they are bit-identical.

**REQ-ANM-009 [P1]** WHEN `timing` is `fit` THE SYSTEM SHALL default `fps` to `round(N / D)` clamped to 1–60, so playback speed matches the source clip, and SHALL show the effective speed when the user overrides `fps`.

- **AC-ANM-009.1** Given `D = 1.2 s`, `N = 8`, When the clip is added, Then `fps = 7`; When the user sets `fps = 14`, Then the UI shows "Plays at 2.1× source speed" (speed = `fps · D / N`, 1 decimal).

**REQ-ANM-010 [P2]** WHERE `pingPong` is true THE SYSTEM SHALL sample frames once (forward) and mark the animation's playback direction as `pingpong` in export metadata (spec 005, Aseprite `frameTags[].direction`); WHERE `bakePingPong` is also true THE SYSTEM SHALL append frames `N−2…1` to the sequence.

- **AC-ANM-010.1** Given `N = 5`, `pingPong: true`, `bakePingPong: false`, When exported, Then 5 frames are rendered and the metadata direction is `pingpong`.
- **AC-ANM-010.2** Given `bakePingPong: true`, When exported, Then 8 frames are emitted with source indices `[0,1,2,3,4,3,2,1]`, and frames 5–7 are pixel-identical to frames 3, 2, 1.

### Per-direction behavior

**REQ-ANM-011 [P1]** THE SYSTEM SHALL render every direction of an animation with identical sample times and identical anatomy, changing only the model yaw (spec 003).

- **AC-ANM-011.1** Given 8 directions and `walk` with `N = 8`, When rendered, Then each direction has 8 frames, and frame `i` uses sample time `t_i` in every direction (asserted through the sampler's frame log).

**REQ-ANM-012 [P3]** WHERE the user sets a per-direction clip override THE SYSTEM SHALL use the override clip for that direction with the same `frameCount`, `fps` and timing mode.

- **AC-ANM-012.1** Given 8 directions and `walk` with an override `walk-back` for direction index 2 (label `n`, facing away from the camera per spec 003 `DIRECTION_ORDER`), When exported, Then direction `n` frames come from `walk-back` and the frame count equals the other directions.

### Root motion

**REQ-ANM-013 [P1]** THE SYSTEM SHALL render clips in place by default (`rootMotion: 'in-place'`): the root bone's horizontal (X/Z) translation is removed relative to frame 0, and vertical (Y) translation is kept.

- **AC-ANM-013.1** Given a root-motion `run` clip, When 8 frames are rendered in place, Then the root bone X/Z world position equals its frame-0 position (± 1e-6 m) in every frame.
- **AC-ANM-013.2** Given a `jump` clip, When rendered in place, Then the root's Y position follows the clip (rises above frame 0 by the authored height × `legLength`, spec 002).
- **AC-ANM-013.3** Given the fixture clip with documented root motion (spec 011 AC-AST-021.2) and no `inPlaceVariant`, When 8 frames are sampled with `rootMotion: 'in-place'`, Then the root bone X/Z world position equals its frame-0 position (± 1e-6 m) in every frame while its Y follows the documented keyframes (± 1e-6 m). *(Added 2026-10-08, M1 D5: bundled UAL clips are in place, so runtime stripping is tested on the fixture.)*

**REQ-ANM-014 [P1]** WHERE the clip manifest provides an in-place variant (`inPlaceVariant`) THE SYSTEM SHALL use it for in-place rendering instead of stripping translation.

- **AC-ANM-014.1** Given `walk` with `inPlaceVariant: 'walk-ip'`, When rendered in place, Then the sampler logs clip `walk-ip` as the source.

**REQ-ANM-015 [P2]** WHERE `rootMotion: 'metadata'` is selected THE SYSTEM SHALL render in place and record each frame's root displacement from frame 0 in output pixels (after texel snapping, spec 003) for export metadata (spec 005).

- **AC-ANM-015.1** Given a `walk` clip moving 1.0 m per cycle at 32 px/m, When exported with 8 frames and `rootMotion: 'metadata'`, Then the per-frame `rootOffsetPx[0]` values are integers, non-decreasing, and frame 7 is within ±1 px of 28.

### Custom clips hook

**REQ-ANM-016 [P2]** THE SYSTEM SHALL accept clips from user uploads as `user:<uuid>#<clipName>` refs (spec 008 REQ-UPL-047) registered through the asset registry by spec 008, and treat them like bundled clips for listing, selection, sampling and root motion.

- **AC-ANM-016.1** Given a retargeted Mixamo clip registered by spec 008, When the panel lists clips, Then it appears under "My clips" with its license badge, and exporting it follows REQ-ANM-007.
- **AC-ANM-016.2** Given a selected user clip whose upload was deleted, When the project loads, Then that animation entry is disabled with "Clip not found" and other entries still export.

### Preview playback

**REQ-ANM-017 [P1]** THE SYSTEM SHALL provide preview controls: play/pause, a timeline scrubber, step to previous/next sampled frame, loop toggle, speed (0.25×, 0.5×, 1×, 2×) and a direction selector, all operable by keyboard. Key bindings are defined only in the spec 009 shortcut registry (`animation.*`, `viewport.prevDir`/`nextDir`).

- **AC-ANM-017.1** Given keyboard focus in the preview, When the user presses Space, Then playback toggles; When `,` or `.` is pressed, Then the preview pauses and moves one sampled frame back or forward.
- **AC-ANM-017.2** Given the scrubber, When it is moved with arrow keys, Then it steps by one sampled frame and announces "Frame 3 of 8".

**REQ-ANM-018 [P1]** WHILE "Show export frames" is on (default) THE SYSTEM SHALL play the preview by cycling the export sample times at the configured `fps` (stepped), so the preview shows exactly the frames that will be exported; WHILE it is off THE SYSTEM SHALL play continuously at wall-clock time.

- **AC-ANM-018.1** Given "Show export frames" on and the preview paused on frame 3, When the export of that clip's frame 3 (same direction) is rendered, Then the preview canvas and the exported cell are pixel-identical at scale 1.
- **AC-ANM-018.2** Given "Show export frames" off, When playing, Then wall-clock time drives the preview, and the export output is unchanged (P-04: wall clock only in `play()`).

**REQ-ANM-019 [P1]** WHERE the user prefers reduced motion THE SYSTEM SHALL not autoplay the preview, and SHALL show the first sampled frame with a visible Play control.

- **AC-ANM-019.1** Given `prefers-reduced-motion: reduce`, When the editor loads, Then the preview is paused on frame 0 (P-06).

**REQ-ANM-020 [P1]** WHEN the selected clip or its settings change THE SYSTEM SHALL update the preview within 150 ms for a cached clip and keep showing the previous clip while an uncached clip loads.

- **AC-ANM-020.1** Given a cached clip, When the user selects it, Then the preview shows its first frame within 150 ms.

### Clip loading and retargeting (M1 amendments 2026-10-08)

**REQ-ANM-021 [P1]** THE SYSTEM SHALL load clips only through `AssetRegistry.resolveClip(ref: ClipRef): Promise<Result<LoadedClip, EngineError>>` (see Data & contracts), which loads the clip GLB from the registered pack base URL, picks the animation named `sourceName`, and caches the result keyed by file URL and `sha256`, so resolving the same clip again makes no network request. *(Added 2026-10-08, M1 plan R6: adopts the architecture §3.6 clip API, backlog F5.)*

- **AC-ANM-021.1** Given the fixture clip manifest registered with `registerClips`, When `resolveClip('builtin:<packId>/<clipId>')` is called, Then the result is `ok: true`, `value.entry.id` equals the clip ID, and `value.durationSec` equals the manifest `durationSec` (± 1e-6).
- **AC-ANM-021.2** Given that clip resolved once, When it is resolved again, Then the loader's fetch count does not increase and both results reference the same cached clip data.

**REQ-ANM-022 [P1]** IF a clip cannot be loaded THEN THE SYSTEM SHALL return `ok: false` with `EngineError.code` `ANM_CLIP_LOAD_FAILED` and `details: { ref, reason }`, where `reason` is one of `'not-registered'`, `'network'`, `'parse'`, `'animation-missing'` or `'extension-not-allowed'` (spec 011 REQ-AST-029), and SHALL keep the previously playing clip and pose unchanged. *(Added 2026-10-08, M1 plan R6.)*

- **AC-ANM-022.1** Given a registered clip whose file returns HTTP 404, When it is resolved, Then the result is `ANM_CLIP_LOAD_FAILED` with `reason: 'network'` and the `ref`.
- **AC-ANM-022.2** Given a clip entry whose `sourceName` is not an animation in its GLB, When resolved, Then the result is `ANM_CLIP_LOAD_FAILED` with `reason: 'animation-missing'`; Given an unregistered ref, Then `reason` is `'not-registered'`; Given a truncated GLB, Then `reason` is `'parse'`.
- **AC-ANM-022.3** Given clip A playing and a selection change to clip B that fails to load, When the renderer's `play()` continues, Then the clip player's log still names clip A as the source and the pose at the next sample time equals clip A's pose (bit-identical).

**REQ-ANM-023 [P1]** THE SYSTEM SHALL retarget every sampled clip pose onto the character skeleton (spec 001 REQ-CMP-037) before the root-motion policy and anatomy (spec 002 application order), using the clip's source rest pose (the local joint transforms stored in the clip GLB) and the character's rest pose: for every animated joint the local rotation SHALL be `q_t = q_tRest · q_sRest⁻¹ · q_s`; translation tracks SHALL be applied only to `rootBone` and to the joint `socketBones.pelvis` as `t_t = t_tRest + (t_s − t_sRest) · k`, where `k = L_t / L_s` and `L` is the rest-pose world height of the pelvis joint above the lowest joint listed in `anatomyBones.feet`; every other joint SHALL keep its target rest translation; scale tracks SHALL pass through unchanged. The math SHALL live in the DOM-free module `packages/engine/src/retarget/`, which imports neither `three` nor DOM APIs, so that tools and the spec 008 retargeter reuse it. *(Added 2026-10-08, M1 PM rig update b: rest-pose-corrected retargeting moves into M1 because bind poses form 4 skeleton groups, max delta 0.107 m / 13.4°.)*

- **AC-ANM-023.1** Given the fixture clip authored on skeleton group `g-a` and a character on `g-b` whose `lowerarm_l` rest rotation differs by 10° about local Z, When `t = 0.5 s` is sampled, Then `lowerarm_l`'s local rotation equals `q_tRest · q_sRest⁻¹ · q_s` computed from the documented keyframe (each quaternion component ± 1e-6, sign-normalized).
- **AC-ANM-023.2** Given `g-b`'s pelvis rest translation 0.05 m higher than `g-a`'s, When frames 0–7 are sampled, Then the pelvis local translation equals `t_tRest + (t_s − t_sRest) · k` with `k = L_t / L_s` (± 1e-6 m).
- **AC-ANM-023.3** Given a character whose rest pose equals the clip's source rest pose, When any frame is sampled, Then the retargeted local transforms equal the raw sampled ones (± 1e-6).
- **AC-ANM-023.4** Given the `retarget/` module, When its imports are statically checked and its tests run in Node, Then it imports no `three` module and no DOM global, and the tests pass.

## Edge cases

- `frameCount = 1` → single pose at `s` (REQ-ANM-007).
- Very short clip (< 1/60 s) with many frames → valid; repeated poses allowed and reported as a warning by spec 005.
- `fixed-fps` exceeding the duration → clamp and warn (AC-ANM-007.3).
- Clip on a different rig → hidden or disabled (REQ-ANM-002); retargeted via spec 008.
- Root motion with rotation (turn clips) → root yaw is kept; only translation is stripped (REQ-ANM-013).
- Body swap with clips selected → clips stay selected if still compatible; otherwise they are disabled with a reason and listed in a notice.
- Anatomy changes leg length → root Y and stride scale (spec 002 REQ-ANA-010).
- Missing user clip → REQ-ANM-016.
- Reduced motion → REQ-ANM-019.
- Clip file missing, corrupt or without the named animation → `ANM_CLIP_LOAD_FAILED`, previous clip kept (REQ-ANM-022).
- Clip rest pose differs from the character skeleton (different skeleton group) → rest-pose-corrected retargeting (REQ-ANM-023).
- Bundled clips are already in place (M1 D5) → stripping is a no-op on them and is exercised by the fixture clip (AC-ANM-013.3).

## Data & contracts

```ts
/** Clip reference. Bundled: builtin:<packId>/<clipId>. User: user:<uuid>#<clipName> (spec 008). */
export type ClipRef = `builtin:${string}/${string}` | `user:${string}#${string}`;

export type ClipCategory = 'locomotion' | 'combat' | 'reaction' | 'death' | 'emote' | 'misc';

export interface ClipEntry {
  id: string;                    // stable, never reused (spec 011 retired-ids)
  name: string;
  category: ClipCategory;
  file: string;                  // GLB relative to pack base URL
  sourceName: string;            // animation name inside the GLB
  rig: RigId;
  durationSec: number;           // > 0, from the source
  loop: boolean;                 // default loop mode
  defaultFrameCount: number;     // 1..64
  hasRootMotion: boolean;
  inPlaceVariant?: string;       // clip id of the in-place variant
  tags: string[];
  license?: AssetLicense;        // overrides pack license
  /** Added 2026-10-08 (M1 R6). Lowercase hex SHA-256 of `file`, written by build-parts (spec 011 REQ-AST-013); cache key with the URL. */
  sha256: string;
  /** Added 2026-10-08 (M1). Computed skeleton group of the clip file (spec 011 REQ-AST-026); informational, retargeting reads the rest pose from the file. */
  skeletonGroup?: string;
}

export interface ClipManifest {
  format: 'sprite-clips-manifest';
  version: 1;
  packId: string;                // e.g. 'quaternius-ual'
  name: string;
  license: AssetLicense;
  clips: ClipEntry[];
}

/** Refines RenderSettings.animations (architecture §3.4). */
export interface AnimationSelection {
  clipId: ClipRef;               // was `string` in architecture §3.4
  /** Unique within the export; [a-z0-9-]{1,48}. Used by spec 005 for frame/tag/file names. */
  label: string;
  frameCount: number;            // 1..64
  fps: number;                   // 1..60
  loop: boolean;
  pingPong?: boolean;            // default false
  bakePingPong?: boolean;        // default false; only with pingPong
  timing?: 'fit' | 'fixed-fps';  // default 'fit'
  range?: { startSec: number; endSec: number };
  rootMotion?: 'in-place' | 'metadata'; // default 'in-place'
  directionOverrides?: Record<number, ClipRef>; // P3; key = direction index (spec 003 REQ-PIX-005)
}
```

Asset registry clip API (added 2026-10-08, M1 plan R6; adopts architecture §3.6 and backlog F5, so this section now governs):

```ts
export interface AssetRegistry {
  // ...part methods: architecture §3.6 / spec 001
  /** Registers a bundled clip manifest (REQ-ANM-001). Clip refs are builtin:<packId>/<clipId>. */
  registerClips(manifest: ClipManifest, baseUrl: string): void;
  /** REQ-ANM-002 filter. */
  listClips(filter?: { rig?: RigId }): ClipEntryView[];
  /** REQ-ANM-021/022. Never throws for load failures; returns ANM_CLIP_LOAD_FAILED. */
  resolveClip(ref: ClipRef): Promise<Result<LoadedClip, EngineError>>;
}
export type ClipEntryView = ClipEntry & { ref: ClipRef; source: 'builtin' | 'user' };

/** Opaque to apps; holds the three.js AnimationClip and the source rest pose inside the engine. */
export interface LoadedClip {
  readonly ref: ClipRef;
  readonly entry: ClipEntry;
  readonly durationSec: number;
}

/** EngineError codes owned by this spec. */
export type AnimationErrorCode = 'ANM_CLIP_LOAD_FAILED';
export interface ClipLoadFailedDetails {
  ref: ClipRef;
  reason: 'not-registered' | 'network' | 'parse' | 'animation-missing' | 'extension-not-allowed';
}
```

User clip refs (`user:<uuid>#<clipName>`) resolve through the same method once spec 008 lands (M5); until then `resolveClip` returns `ANM_CLIP_LOAD_FAILED` with `reason: 'not-registered'` for them.

Contract changes to architecture §3.4 (to be synced in the implementing PR): `clipId` is typed as `ClipRef`; new fields `label`, `pingPong`, `bakePingPong`, `timing`, `range`, `rootMotion`, `directionOverrides`. `RenderedFrame.clipId` carries the `label`, so file-safe names reach spec 005 (a `ClipRef` contains `:` and `/`). Clip selection stays in `RenderSettings`, not in `CharacterSpec` (see spec 001, refinement 4).

Per-frame metadata handed to spec 005: `{ label, direction, frame, sourceFrame, timeSec, durationMs: 1000/fps, rootOffsetPx?: [x, y] }`.

## Non-functional

- NFR-1 (P-04): sampling is a pure function of settings; the same inputs give identical times and bone matrices.
- NFR-2 (P-07): a 4-clip × 8-direction × 8-frame sampling run contributes ≤ 2 s of the 10 s export budget at 64 px; clip switch in preview ≤ 150 ms when cached.
- NFR-3 (P-06): playback controls are keyboard-operable; reduced motion respected.
- NFR-4 (P-10): sample-time math lives in a DOM-free module testable in Node.

## Open questions

- [NEEDS CLARIFICATION: Do all UAL clips use the same skeleton and bind pose as the base characters and outfits? *(M1-gated)* Blocks REQ-ANM-002 data and the `rig` field values.]
- [NEEDS CLARIFICATION: Bundle only the free Standard tier (45 clips) or the full CC0 library (120+)? Shared with spec 011.]
- ~~[NEEDS CLARIFICATION: Should UAL's separate "root motion disabled" export be the in-place source (REQ-ANM-014), or should we strip translation from one root-motion set to halve download size? Proposal: strip at build time in spec 011, keep `inPlaceVariant` for user packs.]~~ Resolved 2026-10-08 (M1 D5): M1 bundles only the in-place UAL file (`UAL1_Standard.glb`); the root-motion `_RM` file and bundled `inPlaceVariant` links are deferred with REQ-ANM-015 (P2). Runtime X/Z stripping (REQ-ANM-013) stays required and is tested on the fixture clip (AC-ANM-013.3); REQ-ANM-014 stays for packs that provide variants.
- The first open question (shared skeleton) is partly answered 2026-10-08: UAL clips share bone names and hierarchy with the base characters and outfits but form their own bind-pose group; they are retargeted at runtime (REQ-ANM-023).

## References

- ADR-0001, ADR-0003; `docs/architecture.md` §2.1 (frame sampler), §3.4, §3.6, §4.1
- `.tagconn/work/research.md` (2026-10-08)
- Quaternius Universal Animation Library: https://quaternius.itch.io/universal-animation-library (accessed 2026-10-08): 120+ clips (45 in the Standard tier), CC0, root motion and root-motion-disabled variants, v2.0 bone naming matches the outfits and base characters
- three.js `AnimationMixer.setTime` / `AnimationAction.time` (r186): https://threejs.org/docs/#api/en/animation/AnimationMixer (accessed 2026-10-08)
- Aseprite JSON export (`direction: pingpong` in frame tags): https://www.aseprite.org/docs/cli/ (accessed 2026-10-08)
- `.tagconn/work/m1-plan.md` §2.2, §5 (D5, R6) and the M1 verify-rig PM update (2026-10-08, rest-pose-corrected retargeting)
