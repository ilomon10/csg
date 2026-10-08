---
id: ANA
title: Anatomy (proportions)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 004-animation, 011-asset-pipeline]
last_updated: 2026-10-08
---

# 002 – Anatomy

## Rules for IDs

`REQ-ANA-NNN` and `AC-ANA-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused.

## Context

Realistic 3D proportions read badly at 32–64 px. Heads become 4 px blobs, forearms vanish and faces disappear (ADR-0001 "Bad" consequence). Anatomy controls let users push proportions toward readable stylizations (chibi, heroic) and vary characters. Proportions are applied as **bone scales with child compensation** on the shared skeleton, plus morph targets where the body provides them. All parts skinned to the skeleton and all socketed props follow automatically.

**Dependency:** bone names, bone axes and `anatomyBones` mapping come from the `RigDefinition` produced and verified by the M1 asset spike (spec 011). Items marked *(M1-gated)* assume the shared Quaternius rig exists and that bone length runs along a single local axis. *(Amended 2026-10-08 (M1-01c): the committed rig `packages/parts-schema/rigs/quaternius-ue5-65.json` also carries the joint hierarchy (`parents`) and the fallback skeleton group (`defaultSkeletonGroup`), see REQ-ANA-021 and Data & contracts.)*

## Goals

- G1: Nine proportion controls that work on every body and every equipped part with no per-part authoring.
- G2: Scaling one segment never distorts unrelated segments (child compensation).
- G3: Proportions keep working under every animation clip, with feet staying on the ground.
- G4: One-click presets that improve pixel readability.

## Non-goals

- NG1: Free per-bone editing or a pose editor.
- NG2: Sculpting, mesh deformation brushes or generating new morph targets.
- NG3: Physically correct muscle or volume preservation.
- NG4: IK foot locking during animation. Grounding (REQ-ANA-008) is a vertical offset only.

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | a "chibi" preset | my 32 px character has a readable head and face |
| US-2 | P1 | pixel artist | sliders for head, limbs, hands and feet | I control the silhouette precisely |
| US-3 | P2 | indie game dev | to vary NPC proportions | crowds don't look cloned |
| US-4 | P2 | pixel artist | a warning when limbs get thinner than 2 px | I can fix readability before export |

## Requirements

### Parameters

**REQ-ANA-001 [P1]** THE SYSTEM SHALL expose exactly the anatomy parameters in the table below, as unitless multipliers of the authored size, with the given range, default and step. Stored values SHALL be quantized to 0.01.

| Param | Range | Default | Step | Randomize range | Affects (via `RigDefinition.anatomyBones`) | Scale mode |
|-------|-------|---------|------|-----------------|---------------------------------------------|------------|
| `height` | 0.80–1.25 | 1.00 | 0.01 | 0.92–1.08 | root bone | uniform, whole character |
| `head` | 0.80–2.00 | 1.00 | 0.01 | 0.95–1.15 | `head` | uniform, propagates to head children |
| `torsoWidth` | 0.80–1.40 | 1.00 | 0.01 | 0.90–1.15 | `spine_01..03` | lateral + depth axes, compensated |
| `shoulders` | 0.80–1.40 | 1.00 | 0.01 | 0.90–1.15 | `clavicle_l/r` | length axis, compensated |
| `armLength` | 0.75–1.25 | 1.00 | 0.01 | 0.95–1.05 | `upperarm_*`, `lowerarm_*` | length axis, compensated |
| `legLength` | 0.70–1.30 | 1.00 | 0.01 | 0.92–1.08 | `thigh_*`, `calf_*` | length axis, compensated |
| `hands` | 0.75–1.75 | 1.00 | 0.01 | 0.95–1.10 | `hand_*` | uniform, propagates to fingers |
| `feet` | 0.75–1.75 | 1.00 | 0.01 | 0.95–1.10 | `foot_*` | uniform, propagates to `ball_*` |
| `limbThickness` | 0.75–1.75 | 1.00 | 0.01 | 0.90–1.15 | `upperarm_*`, `lowerarm_*`, `thigh_*`, `calf_*` | cross-section axes, compensated |

Bone names in the "Affects" column are descriptive, written in UE5 style. The engine uses only the joint names listed in `RigDefinition.anatomyBones`, which keep the exact source spelling and case (REQ-ANA-020); for example `head` stands for joint `Head` in the Quaternius rig. *(Note added 2026-10-08 (M1 D1).)*

- **AC-ANA-001.1** Given the `AnatomyParams` schema, When `head = 2.01` or `legLength = 0.69` is validated, Then validation fails naming the field and its range.
- **AC-ANA-001.2** Given a slider value of 1.234 from the UI, When stored, Then the spec holds `1.23`.
- **AC-ANA-001.3** Given a new `CharacterSpec`, When it is created, Then every anatomy value is 1.00 and the rendered body matches the unmodified body pixel-exactly (golden image).

**REQ-ANA-002 [P1]** THE SYSTEM SHALL resolve which bones each parameter affects from `RigDefinition.anatomyBones` (data), not from bone names hard-coded in the engine. *(M1-gated)*

- **AC-ANA-002.1** Given a fixture rig whose `anatomyBones.hands` lists `Hand_L` and `Hand_R`, When `hands = 1.5`, Then exactly those bones (and their uncompensated children) change scale.
- **AC-ANA-002.2** Given a `RigDefinition` missing an anatomy key, When validated, Then validation fails naming the key; the UI never shows a slider that would affect no bone.

### Child compensation

**REQ-ANA-003 [P1]** WHEN a compensated parameter scales a bone THE SYSTEM SHALL scale only the geometry skinned to that bone, and child bones SHALL keep their world scale and orientation while their joint positions follow the parent's changed length (segment-scale-compensate semantics).

- **AC-ANA-003.1** Given `armLength = 1.2`, When the bind pose is evaluated, Then `lowerarm_l` is 1.2× farther from `upperarm_l` (± 1e-4 m), and the world scale of `lowerarm_l` and `hand_l` is unchanged (± 1e-4).
- **AC-ANA-003.2** Given `torsoWidth = 1.4`, When evaluated, Then `neck_01`, `Head` (the joint in `anatomyBones.head`), `clavicle_l` and `clavicle_r` keep world scale 1 (± 1e-4) and the head shows no shear (all three world axes stay orthogonal within 1e-4). *(Amended 2026-10-08 (M1 D1): joint `head` → `Head`, the source name.)*
- **AC-ANA-003.3** Given `limbThickness = 1.5`, When evaluated, Then hand and foot world scales stay 1 and the limb vertices' distance from the bone axis grows 1.5× (± 1 %).

**REQ-ANA-004 [P1]** WHEN a propagating parameter (`height`, `head`, `hands`, `feet`) scales a bone THE SYSTEM SHALL scale that bone's subtree uniformly, so hair, headwear, fingers and toes grow with it.

- **AC-ANA-004.1** Given `head = 1.8` and a skinned hairstyle, When rendered, Then the hair bounding box grows 1.8× (± 2 %) around the head joint (`anatomyBones.head`, `Head` in the Quaternius rig) and does not intersect the neck region more than at `head = 1`. *(Amended 2026-10-08 (M1 D1): joint named.)*

**REQ-ANA-005 [P1]** THE SYSTEM SHALL use each bone's length axis and cross-section axes from `RigDefinition` (`lengthAxis`, default `'y'`) for length and thickness scaling. *(M1-gated: axis confirmed by verify-rig)*

- **AC-ANA-005.1** Given a fixture rig with `lengthAxis: 'x'`, When `legLength = 1.3`, Then scaling happens along local X and the cross-section is unchanged.

### Attached parts and sockets

**REQ-ANA-006 [P1]** THE SYSTEM SHALL deform all skinned parts with the same anatomy as the body, with no per-part data.

- **AC-ANA-006.1** Given a torso part and `torsoWidth = 1.3`, When rendered, Then torso part vertices and body torso vertices move by the same transform (no gap wider than 0.5 output pixel appears at 64 px versus `torsoWidth = 1`).

**REQ-ANA-007 [P1]** THE SYSTEM SHALL keep static props at their socket bone's world position and orientation under any anatomy, and SHALL apply the socket bone's anatomy scale to the prop only where `socket.inheritScale` is true (default: true for socket `head`, false for all others). Socket names here are socket IDs; the joint is `RigDefinition.socketBones[socketId]` (REQ-ANA-019). *(Amended 2026-10-08 (M1 D1): socket ID vs joint clarified.)*

- **AC-ANA-007.1** Given a sword on socket `hand_r` and `hands = 1.75`, When rendered, Then the sword's world scale is unchanged and its grip stays at the hand socket joint `socketBones.hand_r` (± 1e-4 m plus the authored offset scaled by 1.0).
- **AC-ANA-007.2** Given a static hat on socket `head` and `head = 1.5`, When rendered, Then the hat's world scale is 1.5× and its offset from the joint `socketBones.head` (`Head` in the fixture and Quaternius rigs) is scaled 1.5×. *(Amended 2026-10-08 (M1 D1): joint named.)*

### Grounding and animation

**REQ-ANA-008 [P1]** WHEN anatomy changes THE SYSTEM SHALL shift the character vertically so that, in the bind pose, the lowest point of the feet stays at the ground plane (y = 0).

- **AC-ANA-008.1** Given `legLength = 0.7` and `feet = 1.5`, When the bind pose is rendered, Then the lowest foot vertex is at y = 0 (± 1e-3 m) and the feet pivot row in the output equals `pivotRowPx` (spec 003).

**REQ-ANA-009 [P1]** THE SYSTEM SHALL apply anatomy after animation sampling on every frame: clip rotation tracks are kept, clip translation of non-root bones is scaled by the parent's length factor, and clip scale tracks on anatomy bones are multiplied by the anatomy scale.

- **AC-ANA-009.1** Given `armLength = 1.2` and a clip with position tracks on `lowerarm_l`, When frame 3 is sampled, Then the elbow-to-wrist distance is 1.2× the distance at `armLength = 1` (± 1e-4 m).
- **AC-ANA-009.2** Given the same spec, When the same frame is sampled twice, Then the bone matrices are bit-identical (P-04).

**REQ-ANA-010 [P1]** THE SYSTEM SHALL scale the root/pelvis vertical translation from animation clips by the leg-length factor `legLength`, and horizontal root translation (when root motion is kept, spec 004) by the same factor.

- **AC-ANA-010.1** Given `legLength = 1.3` and the `walk` clip, When frames 0–7 are sampled, Then feet do not go below y = −0.01 m or float above the frame-0 ground contact by more than 0.02 m at contact frames, relative to `legLength = 1`.

**REQ-ANA-011 [P1]** WHEN an anatomy value changes THE SYSTEM SHALL update the preview on the next rendered frame without reloading or rebinding parts and in < 16 ms of CPU time.

- **AC-ANA-011.1** Given 8 equipped parts, When the `head` slider is dragged for 2 s, Then the p95 update time per change is < 16 ms and the registry `resolve` call count does not change.

### Morph targets

**REQ-ANA-012 [P2]** WHERE the equipped body provides morph targets THE SYSTEM SHALL show one slider per morph target (range 0–1, step 0.01, default 0), store weights in `CharacterSpec.morphs`, and apply the same named morph to skinned parts that have a morph of the same name.

- **AC-ANA-012.1** Given a body without morph targets, When the anatomy panel renders, Then no morph section is shown.
- **AC-ANA-012.2** Given a fixture body and shirt with morph `belly`, When `belly = 1`, Then both meshes apply weight 1.
- **AC-ANA-012.3** Given `morphs` containing a name the body lacks, When loaded, Then the entry is kept on round trip and ignored for rendering.

### Presets

**REQ-ANA-013 [P1]** THE SYSTEM SHALL ship anatomy presets as data files, including at least `default`, `chibi`, `heroic` and `realistic`, and applying a preset SHALL set all nine values as one undoable command.

| Preset | height | head | torsoWidth | shoulders | armLength | legLength | hands | feet | limbThickness |
|--------|--------|------|------------|-----------|-----------|-----------|-------|------|---------------|
| `default` | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| `chibi` | 0.90 | 1.80 | 1.10 | 0.90 | 0.85 | 0.75 | 1.40 | 1.40 | 1.40 |
| `heroic` | 1.05 | 0.90 | 1.10 | 1.25 | 1.00 | 1.10 | 1.10 | 1.05 | 1.15 |
| `realistic` | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

`realistic` equals `default` on purpose: it means "authored proportions" and is meant for 96–128 px. Values are initial tuning targets, adjustable in data without a spec change once golden images are reviewed.

- **AC-ANA-013.1** Given the `chibi` preset, When applied, Then the nine values equal the table row and one undo restores the previous values.
- **AC-ANA-013.2** Given a new preset JSON file added to the presets data (no code change), When the app builds, Then it appears in the preset menu.

**REQ-ANA-014 [P2]** WHEN the user edits any value after applying a preset THE SYSTEM SHALL show the preset as "modified" and offer a reset to that preset.

- **AC-ANA-014.1** Given `chibi` applied and `head` changed to 1.6, When the panel renders, Then the preset label reads "Chibi (modified)" and "Reset" restores `head = 1.80`.

### Pixel readability

**REQ-ANA-015 [P2]** WHILE the output resolution is ≤ 64 px THE SYSTEM SHALL estimate the projected width of the forearms, shins and head at the current camera and SHALL show a non-blocking hint when a forearm or shin is narrower than 2 output pixels, or the head is shorter than 6 output pixels.

- **AC-ANA-015.1** Given resolution 32 px, side camera, default anatomy on a fixture body whose forearm projects to 1.2 px, When the panel renders, Then a hint says "Arms are thinner than 2 px at 32 px. Try Limb thickness or the Chibi preset." and links focus to the `limbThickness` slider.
- **AC-ANA-015.2** Given the `chibi` preset on the same fixture, When the panel renders, Then no readability hint is shown.

**REQ-ANA-016 [P2]** WHERE the character has a face decal (`CharacterSpec.face.decal`) THE SYSTEM SHALL let the user choose a decal from data-driven face decals and nudge it by whole output pixels (`offsetPx`, each axis −4…+4). Drawing and pixel snapping of the decal are owned by spec 003.

- **AC-ANA-016.1** Given a decal selected, When the user presses the nudge-right control twice, Then `face.offsetPx` is `[2, 0]` and the decal moves exactly 2 output pixels in the preview.
- **AC-ANA-016.2** Given `offsetPx = [5, 0]` in a loaded file, When validated, Then validation fails naming `face.offsetPx`.

### UI

**REQ-ANA-017 [P1]** THE SYSTEM SHALL present each parameter as a labelled slider with a numeric input, keyboard steps of 0.01 (arrow keys) and 0.10 (Page Up/Down), a per-slider reset, and one undo step per completed drag or keyboard burst (spec 009 coalescing).

- **AC-ANA-017.1** Given keyboard focus on `head`, When the user presses Page Up twice, Then `head` increases by 0.20 and one undo restores the prior value.
- **AC-ANA-017.2** Given the numeric input, When the user types `3`, Then the value is clamped to 2.00 and the field announces "Maximum 2.00".

**REQ-ANA-018 [P3]** WHERE spec 001 randomize runs with anatomy unlocked THE SYSTEM SHALL pick each value uniformly from its randomize range (REQ-ANA-001 table) using the randomize PRNG, then quantize to 0.01.

- **AC-ANA-018.1** Given seeds 0–999, When randomize runs, Then every value lies inside its randomize range and results are reproducible per seed.

### Joint names and sockets (M1 amendments 2026-10-08)

**REQ-ANA-019 [P1]** THE SYSTEM SHALL resolve the joint of every socket through `RigDefinition.socketBones`, which maps each semantic socket ID (`hand_r`, `hand_l`, `head`, `spine_03`, `pelvis`) to a joint in `bones`, and SHALL never use a socket ID as a joint name. `RigDefinition` validation SHALL fail when a socket ID is missing from `socketBones` or maps to a name that is not in `bones`. *(Added 2026-10-08, M1 D1.)*

- **AC-ANA-019.1** Given the fixture rig with joint `Head` (no joint named `head`) and `socketBones.head = 'Head'`, When a static hat with socket `head` is attached, Then the hat's parent is joint `Head` and its world position equals `Head`'s world position plus the authored offset (± 1e-6 m).
- **AC-ANA-019.2** Given a `RigDefinition` whose `socketBones` lacks `pelvis`, or maps `head` to `head` while `bones` contains only `Head`, When validated, Then validation fails naming `socketBones.pelvis` or `socketBones.head` respectively.

**REQ-ANA-020 [P1]** THE SYSTEM SHALL keep joint names exactly as in the source files (case-sensitive, no renaming or normalization) in `RigDefinition.bones`, `rootBone`, `anatomyBones`, `regionBones`, `socketBones` and every engine lookup, and SHALL match joint names case-sensitively. *(Added 2026-10-08, M1 D1: the Quaternius source joint is `Head`; renaming it at build time would break AC-AST-010.1, user clips and verify-rig.)*

- **AC-ANA-020.1** Given the fixture rig with joint `Head`, When `anatomyBones.head` lists `head`, Then `RigDefinition` validation fails naming `anatomyBones.head` and the value `head`.
- **AC-ANA-020.2** Given the fixture rig and a part whose skin uses joint `Head`, When the part is rebound to the body skeleton, Then it binds to `Head` and `AST_RIG_MISMATCH` is not reported.

**REQ-ANA-021 [P1]** WHEN a `RigDefinition` is validated THE SYSTEM SHALL require that (a) `parents` has exactly the joints of `bones` as keys; (b) exactly one value of `parents` is `null` and its key is `rootBone`; (c) every non-null parent is a joint in `bones` at a lower index than its child; (d) `skeletonGroups` IDs are unique and every group's `restPose` has exactly the joints of `bones` as keys; and (e) `defaultSkeletonGroup` equals the ID of one entry in `skeletonGroups`; and SHALL otherwise fail with an issue whose path names the offending field (and joint or group, where one applies). The hip joint SHALL be `socketBones.pelvis`; no `hipBone` or top-level `joints` field is part of the contract. *(Added 2026-10-08 (M1-01c), PM decision after the verify-rig skeleton-group work.)*

- **AC-ANA-021.1** Given the committed rig `packages/parts-schema/rigs/quaternius-ue5-65.json`, When it is validated with `@csg/parts-schema`, Then validation passes, `parents.root` is `null`, `parents.Head` is `neck_01`, and `defaultSkeletonGroup` is `superhero-m`.
- **AC-ANA-021.2** Given the fixture rig with `parents.pelvis` changed to `null` (two `null` values), or with `parents.root` changed to `pelvis` (no `null` value), When validated, Then validation fails with an issue whose path starts with `parents` and whose message states that exactly one root is required.
- **AC-ANA-021.3** Given the fixture rig with `rootBone: 'pelvis'` while `parents.root` is `null`, When validated, Then validation fails naming `rootBone`.
- **AC-ANA-021.4** Given the fixture rig with `parents.spine_01` set to `spine_02` (a later joint in `bones`), or to `Spine_02` (not in `bones`), When validated, Then validation fails with path `parents.spine_01`.
- **AC-ANA-021.5** Given the fixture rig with the `parents` entry for `hand_l` removed, or with an extra entry `parents.tail_01`, When validated, Then validation fails with path `parents.hand_l` or `parents.tail_01` respectively.
- **AC-ANA-021.6** Given the fixture rig with skeleton groups `g-a` and `g-b`, When `defaultSkeletonGroup` is `g-c`, or the field is missing, Then validation fails with path `defaultSkeletonGroup`.
- **AC-ANA-021.7** Given the fixture rig with `g-b.restPose` lacking `lowerarm_l`, or with two groups both named `g-a`, When validated, Then validation fails with a path naming `skeletonGroups`, the group index and `lowerarm_l` (first case) or the duplicate ID (second case).
- **AC-ANA-021.8** Given a fixture rig with no `hipBone` field and `socketBones.pelvis = 'pelvis'`, When the spec 004 REQ-ANM-023 retarget plan is built, Then the hip joint it uses for `k = L_t / L_s` is `pelvis`; and given the same rig with `socketBones.pelvis = 'spine_01'`, Then the hip joint is `spine_01`.

## Edge cases

- All parameters at extremes simultaneously → no NaN, no inverted geometry; AC-ANA-003.2 shear check runs at all-min and all-max (REQ-ANA-003).
- Body swap → anatomy values are kept and re-applied to the new skeleton (REQ-ANA-002).
- Clip with scale tracks on anatomy bones → multiplied (REQ-ANA-009).
- Root motion clips with long legs → stride scaled (REQ-ANA-010).
- Props on scaled hands → not scaled (REQ-ANA-007).
- User-uploaded character with its own rig → anatomy uses the bone map to canonical names (spec 008); unmapped anatomy bones disable that slider with a reason.
- Morph names that collide across parts → same name, same weight (REQ-ANA-012).
- Source joint names with mixed case (`Head` next to `hand_r`) → kept as-is and matched case-sensitively (REQ-ANA-020); sockets resolve through `socketBones` (REQ-ANA-019).
- Body and outfits from different skeleton groups (bind poses differ, spec 011 REQ-AST-026) → anatomy works on the character skeleton (spec 001 REQ-CMP-037); bind-pose scaling (REQ-ANA-003/008) uses that skeleton's rest pose.
- Body that declares no skeleton group (e.g. its rest pose matched none, spec 011 AC-AST-026.4) → the character skeleton uses `RigDefinition.defaultSkeletonGroup` (REQ-ANA-021, spec 001 REQ-CMP-037). *(Added 2026-10-08 (M1-01c).)*
- Rig JSON with a stale `hipBone` or top-level `joints` field (pre-M1-01c drafts) → not part of the contract and never read; the hip is `socketBones.pelvis` and rest poses come from `skeletonGroups[].restPose` (REQ-ANA-021). *(Added 2026-10-08 (M1-01c).)*
- Auto camera framing (spec 003) normalizes overall size, so `height` is visible only with fixed framing or when comparing characters. The slider shows a hint about this when framing is `auto`.

## Data & contracts

```ts
/** Refines architecture §3.3. Unitless multipliers, quantized to 0.01. */
export interface AnatomyParams {
  height: number;        // 0.80..1.25
  head: number;          // 0.80..2.00
  torsoWidth: number;    // 0.80..1.40
  shoulders: number;     // 0.80..1.40
  armLength: number;     // 0.75..1.25
  legLength: number;     // 0.70..1.30
  hands: number;         // 0.75..1.75
  feet: number;          // 0.75..1.75
  limbThickness: number; // 0.75..1.75
}

/** Source joint name, exact spelling and case (REQ-ANA-020), e.g. 'Head'. */
export type JointName = string;

/** Semantic socket IDs (M1 D1). Not joint names; resolved through RigDefinition.socketBones. */
export type SocketId = 'hand_r' | 'hand_l' | 'head' | 'spine_03' | 'pelvis';
/** Kept for spec 001 and architecture §3.2; same set as SocketId. */
export type SocketBone = SocketId;

/** Local rest transform of one joint (parent space). */
export interface RestTransform {
  t: [number, number, number];          // meters
  r: [number, number, number, number];  // unit quaternion x, y, z, w
  s: [number, number, number];
}

/**
 * Refines RigDefinition (architecture §3.2). Produced by spec 011 and stored as
 * `packages/parts-schema/rigs/<rigId>.json`. Amended 2026-10-08 (M1-01c): `parents` and
 * `defaultSkeletonGroup` added, validated by REQ-ANA-021. The contract has NO `hipBone` field
 * (the hip joint is `socketBones.pelvis`) and NO top-level `joints` array (rest poses live only
 * in `skeletonGroups[].restPose`).
 */
export interface RigDefinition {
  id: RigId;
  /** Free-form note written by verify-rig (derivation + overlay comment). Informational. */
  comment?: string;
  /** Joint names in hierarchy order: every joint's parent appears earlier (REQ-ANA-021). */
  bones: JointName[];
  /**
   * Added 2026-10-08 (M1-01c). Parent of every joint in `bones` (same key set), used for FK and
   * parent checks. Exactly one value is `null`, the one for `rootBone`.
   */
  parents: Record<JointName, JointName | null>;
  rootBone: JointName;
  /** Local axis along which each bone's length runs. */
  lengthAxis: 'x' | 'y' | 'z';
  /** Reference skeleton height in meters (verify-rig unit-scale check, spec 011). Informational. */
  skeletonHeightM?: number;
  anatomyBones: Record<keyof AnatomyParams, JointName[]>;
  /** Bone → body region, used for hides (spec 001) and region attributes (spec 011). */
  regionBones: Record<BodyRegion, JointName[]>;
  /** Added 2026-10-08 (M1 D1). Every SocketId → a joint in `bones` (REQ-ANA-019). */
  socketBones: Record<SocketId, JointName>;
  /**
   * Added 2026-10-08 (M1 PM rig update a). Skeleton groups (spec 011 REQ-AST-026): rest poses that
   * differ between source files with the same names and hierarchy. Each group has a rest transform
   * for every joint in `bones`. Group IDs match [a-z0-9-]{1,32}.
   */
  skeletonGroups: Array<{ id: string; restPose: Record<JointName, RestTransform> }>;
  /**
   * Added 2026-10-08 (M1-01c). ID of the entry in `skeletonGroups` used when a body declares
   * neither `characterSkeletonGroup` nor `skeletonGroup` (spec 001 REQ-CMP-037). It is the group
   * of the verify-rig reference file (spec 011 REQ-AST-005).
   */
  defaultSkeletonGroup: string;
}

/** Data file: presets/anatomy/<id>.json */
export interface AnatomyPreset {
  format: 'sprite-anatomy-preset';
  version: 1;
  id: string;
  label: string;
  /** Suggested output resolutions for the readability hint. */
  recommendedPx?: [number, number];
  values: AnatomyParams;
}
```

Application order per frame (contract for engine and tests): 1) sample clip (spec 004), including the rest-pose correction of spec 004 REQ-ANM-023 onto the character's skeleton group *(added 2026-10-08, M1 PM rig update b)*; 2) apply root-motion policy (spec 004); 3) apply anatomy (`height` → length/width/thickness with compensation → propagating `head`/`hands`/`feet`); 4) apply grounding offset (computed once per anatomy change in bind pose); 5) update socket props; 6) skinning.

## Non-functional

- NFR-1 (P-07): anatomy update < 16 ms CPU; no part reload.
- NFR-2 (P-04): anatomy math uses no time or randomness and runs in a fixed order; equal inputs give bit-identical bone matrices on the same platform.
- NFR-3 (P-06): sliders have visible labels, numeric equivalents and keyboard steps; hints are announced via a polite live region.
- NFR-4 (P-10): anatomy math lives in DOM-free `packages/engine/src/anatomy/` and is unit-testable in Node with fixture rigs.

## Open questions

- [NEEDS CLARIFICATION: Do the Quaternius bodies ship morph targets? The vendor pages do not mention shape keys. If none exist, REQ-ANA-012 applies only to uploads. Answered by the M1 spike.]
- [NEEDS CLARIFICATION: Final bone lists per parameter and `lengthAxis` for the Quaternius rig. Blocks REQ-ANA-002/005 data, not the engine code. Answered by M1 `verify-rig`. Partly answered 2026-10-08: names, hierarchy and `lengthAxis` are identical across all 36 checked files (outcome `mapped` only for bind poses); the overlay lists remain to be committed (M1-14) and confirmed in the M1-33 pass.]
- [NEEDS CLARIFICATION: Does spec 003 own drawing the face decal layer (snapping, palette interaction)? This spec assumes yes and owns only selection and offset.]

## References

- ADR-0001 (readability risk); `docs/architecture.md` §2.1 (assembly order), §3.2–3.3
- `.tagconn/work/research.md` (anatomy and readability notes, 2026-10-08)
- Autodesk Maya joint attribute "Segment Scale Compensate" (concept reference for child compensation; Maya documentation, joint attributes)
- three.js `SkinnedMesh` / `Skeleton` docs (r186): https://threejs.org/docs/#api/en/objects/SkinnedMesh (accessed 2026-10-08)
- Quaternius Universal Base Characters: https://quaternius.itch.io/universal-base-characters (accessed 2026-10-08)
- `.tagconn/work/m1-plan.md` §2.1, §5 (D1) and the M1 verify-rig PM update (2026-10-08)
- Committed rig `packages/parts-schema/rigs/quaternius-ue5-65.json` and overlay `tools/rigs/quaternius-ue5-65.overlay.json` (shape of `parents`, `defaultSkeletonGroup`, `skeletonGroups`; read 2026-10-08, M1-01c)
