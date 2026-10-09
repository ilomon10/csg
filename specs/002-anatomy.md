---
id: ANA
title: Anatomy (proportions)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 004-animation, 011-asset-pipeline]
last_updated: 2026-10-09
---

# 002 – Anatomy

## Rules for IDs

`REQ-ANA-NNN` and `AC-ANA-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused.

## Context

Realistic 3D proportions read badly at 32–64 px. Heads become 4 px blobs, forearms vanish and faces disappear (ADR-0001 "Bad" consequence). Anatomy controls let users push proportions toward readable stylizations (chibi, heroic) and vary characters. Proportions are applied as **bone scales with child compensation** on the shared skeleton, plus morph targets where the body provides them. All parts skinned to the skeleton and all socketed props follow automatically. *(Amended 2026-10-09 (FX-CHIBI): only the uniform factors are bone scales; the compensated factors scale each segment's skin through its inverse bind matrices, see REQ-ANA-003.)*

**Dependency:** bone names, bone axes and `anatomyBones` mapping come from the `RigDefinition` produced and verified by the M1 asset spike (spec 011). Items marked *(M1-gated)* assume the shared Quaternius rig exists and that bone length runs along a single local axis. *(Amended 2026-10-08 (M1-01c): the committed rig `packages/parts-schema/rigs/quaternius-ue5-65.json` also carries the joint hierarchy (`parents`) and the fallback skeleton group (`defaultSkeletonGroup`), see REQ-ANA-021 and Data & contracts.)* *(Amended 2026-10-09 (M1-33): the spike confirmed one shared rig with `lengthAxis: 'y'` across all bundled files and committed the anatomy, region and socket lists (outcome `mapped`, ADR-0008); the *(M1-gated)* items REQ-ANA-002 and REQ-ANA-005 hold as written.)*

## Goals

- G1: Nine proportion controls that work on every body and every equipped part with no per-part authoring.
- G2: Scaling one segment never distorts unrelated segments (child compensation).
- G3: Proportions keep working under every animation clip, with feet staying on the ground.
- G4: One-click presets that improve pixel readability.

## Non-goals

- NG1: Free per-bone editing or a pose editor.
- NG2: Sculpting, mesh deformation brushes or generating new morph targets. *(Amended 2026-10-09 (STY), PM decision: spec 013 body composition (milestone M3.5, REQ-STY-011..017) adds one procedural mesh deformation, a CPU-baked bind-space normal inflation driven by `weight` and `muscle`. Brushes, sculpting and new morph targets stay out of scope; no other mesh deformation is added by this spec.)*
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

*(Amended 2026-10-09 (FX-CHIBI), mechanism, a contract for the engine, export and tests.)* Anatomy factors are split in two:

- **Uniform factors** (`height`, `head`, `hands`, `feet`, REQ-ANA-004) multiply the joint's `Bone.scale`. A uniform scale is inherited without shear at any rotation, so the subtree grows with it.
- **Compensated factors** (`torsoWidth`, `shoulders`, `armLength`, `legLength`, `limbThickness`) never enter the bone hierarchy. Per joint they form an own-frame factor `skin(j)` (the factor on the joint's length axis and/or cross-section axes, REQ-ANA-005; (1, 1, 1) elsewhere), returned by `anatomySkinScales`. It acts in two places only: (a) each child's local translation is multiplied by its parent's `skin`, so the child joint follows the segment's new length and cross-section; (b) the joint's own skin: for every skinned mesh of the character, each inverse bind matrix becomes `S(skin(j)) · B⁻¹(j)` (`applyAnatomyToSkins`). The engine writes these into per-skeleton copies, so the registry's shared source matrices are never modified, and at `skin = (1, 1, 1)` it restores the original matrix exactly (default anatomy is bit-identical to no anatomy, AC-ANA-001.3).

This replaces the M1 diagonal child compensation (each joint's `Bone.scale` divided by its parent's per local axis), which sheared every child whose rest or animated rotation differs from its parent's. On the Quaternius rig the foot sits 70° from the calf, the upper arm 93° from the clavicle and the thigh 164° from the pelvis; at chibi values the old method produced feet stretched 1.9× ("plank" feet) and folded legs. The grounding offset (REQ-ANA-008) uses the same forward kinematics: translations scaled by the parent's `skin`, rest scales times the uniform factor.

- **AC-ANA-003.1** Given `armLength = 1.2`, When the bind pose is evaluated, Then `lowerarm_l` is 1.2× farther from `upperarm_l` (± 1e-4 m), and the world scale of `lowerarm_l` and `hand_l` is unchanged (± 1e-4). *(Amended 2026-10-09 (FX-CHIBI): "world scale of a joint" means the world scale of the geometry skinned to it, that is the column lengths of the bone's world matrix times `S(skin(j))`; the bone's own `matrixWorld` no longer carries the compensated factor. With that reading, on both fixture groups `g-a` and `g-b` (arm rotated 10°), `lowerarm_l` is 1.2 along its length axis and 1 on the cross-section axes, and `hand_l` is 1 on all axes, each ± 1e-4. The ± 1e-2 tolerance for rotated rest poses in the M1-33 note below is withdrawn.)* *(Amended 2026-10-09 (M1-33): this text contradicted the parameter table, which lists `lowerarm_*` under `armLength`. Resolved to match the M1 implementation: each listed joint carries only its own factor, never its parent's on top. So `lowerarm_l`'s world scale is 1.2 along the length axis and 1 on the cross-section axes (not 1.44 and not 1), and `hand_l`, which is not listed, keeps world scale 1 on all axes. ~~Tolerances: ± 1e-4 where the rest rotations of `upperarm_l`, `lowerarm_l` and `hand_l` relative to their parents are the identity; ± 1e-2 where they are not, see the residual-shear limitation under REQ-ANA-003.~~ (struck 2026-10-09 (FX-CHIBI): no residual shear remains, ± 1e-4 applies everywhere.))*
- **AC-ANA-003.2** Given `torsoWidth = 1.4`, When evaluated, Then `neck_01`, `Head` (the joint in `anatomyBones.head`), `clavicle_l` and `clavicle_r` keep world scale 1 (± 1e-4) and the head shows no shear (all three world axes stay orthogonal within 1e-4). *(Amended 2026-10-08 (M1 D1): joint `head` → `Head`, the source name.)*
- **AC-ANA-003.3** Given `limbThickness = 1.5`, When evaluated, Then hand and foot world scales stay 1 and the limb vertices' distance from the bone axis grows 1.5× (± 1 %).

~~*Known limitation (added 2026-10-09 (M1-33), accepted by the PM for M1 in M1-22):* compensation divides each joint's target world scale by its parent's per local axis, and a joint's scale is a diagonal (per-axis) scale. This is exact when a child's rest rotation relative to its parent is the identity. Where it is not (several Quaternius arm and leg joints, and fixture group `g-b`'s arms rotated 10°), a residual shear of about 0.5–0.7 % of the scaled length remains at the child. It is revisited if it becomes visible in the M2 golden images; a fix needs non-diagonal compensation (for example a scale applied in the parent's frame) and a spec amendment.~~ *(Struck 2026-10-09 (FX-CHIBI): the limitation is removed. The 0.5–0.7 % estimate held for small rest rotations only; at chibi values on the Quaternius rig it reached 1.9× feet. Compensation through the skin matrices (REQ-ANA-003 FX-CHIBI note) is exact at any rotation.)*

- **AC-ANA-003.4** ~~Given fixture group `g-b` (arm joints rotated 10° about local Z at rest) and `armLength = 1.25`, When the bind pose is evaluated, Then every world-scale component of `hand_l` is within 1 ± 1e-2, and the angle between any two of its world axes differs from 90° by ≤ 1°.~~ Given fixture groups `g-a` and `g-b`, the `chibi` preset values (REQ-ANA-013), and a pose that rotates both calves 90° about local X (bent knees), both feet a further 70° about local X and both upper arms 60° about local Z on top of the rest pose, When anatomy is applied, Then for every joint the three world axes of its skinned geometry (bone world matrix × `S(skin(j))`, AC-ANA-003.1) are orthogonal (each pairwise |cos| ≤ 1e-9); `foot_l`, `foot_r`, `ball_l` and `ball_r` have a uniform world scale of `height × feet` = 0.85 × 1.4 on every axis (± 1e-9); and `calf_l` and `thigh_r` have world scale (0.85 × 1.4, 0.85 × 0.70, 0.85 × 1.4) on (cross-section, length, cross-section) (± 1e-9). *(Added 2026-10-09 (M1-33): bounds the accepted residual shear.)* *(Amended 2026-10-09 (FX-CHIBI): the residual shear is gone, so the AC asserts none at 1e-9 instead of bounding it at ± 1e-2 / 1°, and covers bent knees and turned feet at chibi values. The `g-b` arm case at the old 10° rest rotation is covered by AC-ANA-003.1.)*

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

*(Clarified 2026-10-09 (M1-33), PM decision in M1-24.)* "Anatomy scale" here is the socket joint's full anatomy world scale, which includes `height` (the uniform scale on `rootBone`). So a prop with `inheritScale: false` also keeps its world scale and its unscaled offset when `height` changes; only its position follows the joint. A scale applied to the whole character's container object (outside the skeleton, for example by framing or a caller's transform) is not anatomy and scales every prop, inheriting or not.

*(Amended 2026-10-09 (FX-CHIBI).)* The socket joint's anatomy world scale is its **uniform** factor: the product of the `height`, `head`, `hands` and `feet` factors of the joint and its ancestors (REQ-ANA-004). The compensated factors only skin each joint's own geometry (REQ-ANA-003) and never reach a prop parented to the joint, so for example `torsoWidth` does not widen a prop on socket `spine_03`. `socketPropScale` returns (1, 1, 1) where the prop inherits scale and `1 / uniform` on every axis where it does not; the prop's local scale and authored offset are multiplied by it. AC-ANA-007.1..4 are unchanged.

- **AC-ANA-007.3** Given a sword on socket `hand_r` (`inheritScale` absent, so false) and `height = 1.2`, When rendered, Then the sword's world scale is 1 (± 1e-4) and its grip is at the joint `socketBones.hand_r` plus the authored offset scaled by 1.0 (± 1e-4 m); Given a hat on socket `head` with `height = 1.2`, Then the hat's world scale is 1.2 (± 1e-4). *(Added 2026-10-09 (M1-33).)*
- **AC-ANA-007.4** Given the character container object scaled by 2 and default anatomy, When rendered, Then both the sword and the hat have world scale 2 (± 1e-4). *(Added 2026-10-09 (M1-33).)*

### Grounding and animation

**REQ-ANA-008 [P1]** WHEN anatomy changes THE SYSTEM SHALL shift the character vertically so that, in the bind pose, the ~~lowest point of the feet~~ sole of the feet (the lowest feet joint lowered by the character skeleton group's `soleOffsetM`, scaled with the feet) stays at the ground plane (y = 0). *(Amended 2026-10-09 (M3-00), user decision on issue #10: the ground is the sole, not the joint; formula in the M3-00 note below.)*

- **AC-ANA-008.1** Given `legLength = 0.7` and `feet = 1.5`, When the bind pose is rendered, Then the lowest foot vertex is at y = 0 (± 1e-3 m) and the feet pivot row in the output equals `pivotRowPx` (spec 003). *(Amended 2026-10-09 (M1-33), see the note below: "lowest foot vertex" reads "lowest feet joint".)* *(Amended 2026-10-09 (M3-00): for a character skeleton group with `soleOffsetM`, "lowest foot vertex" again means the lowest vertex of the meshes measured for that group by spec 011 REQ-AST-030 (the body's `feet` region and the `feet`-slot parts); for a group without `soleOffsetM` the M1-33 reading "lowest feet joint" still applies.)*

*(Amended 2026-10-09 (M1-33), PM-accepted in M1-22.)* "The lowest point of the feet" is joint-based: it is the lowest world-space joint origin among the joints in `RigDefinition.anatomyBones.feet` and their descendants (e.g. `ball_*`), evaluated on the character skeleton's rest pose (spec 001 REQ-CMP-037) with the anatomy scales applied. It is never read from mesh vertices, so it does not depend on which parts are equipped, costs no vertex pass, and stays within the < 16 ms budget (REQ-ANA-011). ~~Consequence: the sole of a shoe or foot mesh can sit a few millimetres below or above y = 0 by the distance between the lowest joint and the lowest vertex of the source art; that distance is constant per body and is absorbed by `pivotRowPx` framing (spec 003).~~ *(Consequence superseded 2026-10-09 (M3-00): on the Quaternius rig the distance is about 2 cm, which renders the character 1 px low at 64 px and fails AC-PIX-008.1; it is now corrected by `soleOffsetM`, below.)*

*(Amended 2026-10-09 (M3-00), user decision on issue #10, fixed in M3.)* The ground offset added to the character's root in the bind pose is

`groundOffsetY = −jointMinY(A) + soleOffsetM(G) × height × feet`

where `jointMinY(A)` is the M1-33 joint term above (lowest world Y among `anatomyBones.feet` joints and their descendants, character skeleton rest pose, anatomy `A` applied); `G` is the character skeleton group (spec 001 REQ-CMP-037); `soleOffsetM(G)` is the value stored in `RigDefinition.skeletonGroups[G].soleOffsetM` (metres, the height of the group's lowest feet joint above the lowest sole vertex at default anatomy, measured by the build, spec 011 REQ-AST-030), or 0 when the field is absent; and `height`, `feet` are the anatomy values of `A`. Positive `soleOffsetM` moves the character up. Rules:

- The sole term scales with `height × feet`, which is the uniform world scale of the `anatomyBones.feet` joints (REQ-ANA-004: `feet` propagates uniformly to `ball_*`; `height` is the uniform root scale; `legLength` and `limbThickness` are compensated and leave the feet's world scale at 1, AC-ANA-003.3). Sole geometry weighted to the feet subtree therefore lands on y = 0 for every anatomy, not only the default. `legLength`, `limbThickness` and the other parameters enter only through `jointMinY(A)`.
- The per-anatomy cost stays joint-only: the inputs are the `RigDefinition`, `G` and `A`. Mesh vertices are never read at runtime; they are read only by the build (spec 011 REQ-AST-030).
- The sole term does not depend on which parts are equipped: one value per skeleton group serves bare feet and every shoe. A `feet` part whose sole is thinner than the lowest measured mesh hovers by the difference (bounded by the build warning `AST_SOLE_SPREAD`, spec 011).
- Values below 1e-9 m in magnitude still snap to 0, and equal inputs give a bit-identical offset (AC-ANA-008.3, P-04).
- Groups without `soleOffsetM` (the fixture rig, rigs of user uploads (spec 008), groups that drive no bundled body) keep the M1-33 joint-only behaviour, so AC-ANA-008.2 and AC-ANA-008.3 are unchanged for them.
- *(Added 2026-10-09 (FX-CHIBI).)* `jointMinY(A)` uses the same forward kinematics as the posed skeleton (REQ-ANA-003 FX-CHIBI note): each rest translation multiplied by the parent's own-frame `skin` factor and each rest scale by the joint's uniform factor. The compensated factors never scale a bone, so the feet joints' world scale is exactly `height × feet` and the sole term above stays exact.

- **AC-ANA-008.2** Given the fixture rig in groups `g-a` and `g-b`, `legLength = 0.7` and `feet = 1.5`, When the ground offset is computed and added to the bind pose, Then the lowest world Y among `foot_l`, `foot_r` and their descendants is 0 (± 1e-3 m), and the offset is negative (shorter legs move the character down). *(Added 2026-10-09 (M1-33).)*
- **AC-ANA-008.3** Given the fixture rig, whose lowest feet joint rests at y = 0, and default anatomy, When the ground offset is computed, Then it is exactly 0 (values below 1e-9 m snap to 0); Given the same anatomy twice, Then the same offset is returned (bit-identical). *(Added 2026-10-09 (M1-33). On the Quaternius rig the default offset is minus the rest height of its lowest feet joint, typically the `ball_leaf_*` toe tip.)* *(Amended 2026-10-09 (M3-00): this holds for groups without `soleOffsetM`; on the Quaternius groups `male` and `female` the default offset is that value plus the group's `soleOffsetM`.)*
- **AC-ANA-008.4** Given a fixture rig variant whose group `g-a` has `soleOffsetM: 0.02` (lowest feet joint at rest y = 0) and default anatomy, When the ground offset is computed, Then it is +0.02 m (± 1e-9 m); Given `height = 1.2` and `feet = 1.5` on the same variant, Then it is `−jointMinY(A) + 0.036` m (± 1e-9 m), where `jointMinY(A)` is the value AC-ANA-008.2 computes for that anatomy without `soleOffsetM`. *(Added 2026-10-09 (M3-00).)*
- **AC-ANA-008.5** ~~Given the fixture rig variant of AC-ANA-008.4 and a fixture body in `g-a` whose `feet`-region vertices are weighted 1.0 to `foot_*` or `ball_*` and whose lowest rest vertex is 0.02 m below the lowest feet joint,~~ Given the fixture rig variant of AC-ANA-008.4 (`g-a.soleOffsetM: 0.02`) and a feet mesh built in the test on a `g-a` character, with per foot joint one vertex 0.02 m below the joint's rest position and one 0.05 m above it, each weighted 1.0 to that joint (so its lowest rest vertex is exactly `soleOffsetM` below the lowest feet joint), When `legLength = 0.7`, `feet = 1.5` and `height = 0.8` are applied and the ground offset is added to the bind pose, Then the lowest of those vertices is at y = 0 (± 1e-4 m); and with the joint-only offset of the same rig without `soleOffsetM` it is at y = −0.02 × 0.8 × 1.5 = −0.024 m (± 1e-6 m). *(Added 2026-10-09 (M3-00).)* *(Amended 2026-10-09 (M3 PM decision): restated to the measured fixture. The shared fixture body `pack/parts/fixture-body.glb` is not used here: its foot boxes reach 0.04 m below the foot joint (box padding), not 0.02 m, so the test builds the feet mesh in code with the offset equal to `soleOffsetM`.)*
- **AC-ANA-008.6** Given the committed rig and the default character (spec 001 Data & contracts; body `superhero-m`, character skeleton group `male`) at default anatomy and no clip, When the ground offset is added to the bind pose, Then the lowest vertex over the default body's `feet` region and every `feet`-slot part measured for group `male` (spec 011 REQ-AST-030) is at y = 0 (± 1e-3 m), and no vertex of the equipped `feet` part is below y = −1e-3 m; the same holds for body `superhero-f` and group `female`. *(Added 2026-10-09 (M3-00).)*
- **AC-ANA-008.7** Given the default character, When the ground offset is computed once with every mesh loaded and once from a skeleton-only input (the same `RigDefinition`, group and anatomy, no mesh), Then the two offsets are bit-identical, and a spy on the vertex position attributes records no read during the computation. *(Added 2026-10-09 (M3-00): the offset stays joint-only at runtime.)*
- **AC-ANA-008.8** Given the default character with body `superhero-m`, and again with body `superhero-f` and every part that is then incompatible removed (spec 001 REQ-CMP-010, so the body's own feet show), the `idle` clip, side view, resolution 64×64, `pivotRowPx = 2`, outer and inner outline off, 2 directions × 8 frames, When rendered on WebGPU and on WebGL2 (`forceWebGL`), Then in each of the 16 frames per body the lowest opaque pixel row is row 2 from the bottom (never 1, never 3). *(Added 2026-10-09 (M3-00): the anatomy-side counterpart of spec 003 AC-PIX-008.1, which covers the male default only.)*

**REQ-ANA-009 [P1]** THE SYSTEM SHALL apply anatomy after animation sampling on every frame: clip rotation tracks are kept, clip translation of non-root bones is scaled by the parent's length factor, and clip scale tracks on anatomy bones are multiplied by the anatomy scale.

*(Amended 2026-10-09 (FX-CHIBI).)* "Sampled scale × anatomy scale" holds for the **effective** scale of the joint's skinned geometry (bone world matrix × `S(skin(j))`, AC-ANA-003.1). For uniform factors the product is written into `Bone.scale`; for compensated factors `Bone.scale` keeps the clip's sampled value and the factor is applied through the skin matrices (REQ-ANA-003). "Scaled by the parent's length factor" means the parent's own-frame `skin` factor, applied to the child's local translation. Example: a clip scale (1, 2, 1) on `upperarm_l` with `armLength = 1.2` leaves `Bone.scale` = (1, 2, 1) and gives the upper-arm geometry the world scale (1, 2.4, 1) (± 1e-9).

- **AC-ANA-009.1** Given `armLength = 1.2` and a clip with position tracks on `lowerarm_l`, When frame 3 is sampled, Then the elbow-to-wrist distance is 1.2× the distance at `armLength = 1` (± 1e-4 m).
- **AC-ANA-009.2** Given the same spec, When the same frame is sampled twice, Then the bone matrices are bit-identical (P-04).

**REQ-ANA-010 [P1]** THE SYSTEM SHALL scale the root/pelvis vertical translation from animation clips by the leg-length factor `legLength`, and horizontal root translation (when root motion is kept, spec 004) by the same factor.

- **AC-ANA-010.1** Given `legLength = 1.3` and the `walk` clip, When frames 0–7 are sampled, Then feet do not go below y = −0.01 m or float above the frame-0 ground contact by more than 0.02 m at contact frames, relative to `legLength = 1`.

*(Clarified 2026-10-09 (M1-33), matching the M1 implementation.)* The factor is `legLength` only; `height` does not enter it. In detail: (1) the `rootBone`'s horizontal (X/Z) clip translation is multiplied by `legLength`; (2) the vertical clip translation of `rootBone` and of the joint `socketBones.pelvis` is scaled by `legLength` as a delta from its rest value: `v' = v_rest + (v − v_rest) · legLength`, where `v` is the component of the joint's local translation along the world up axis (+Y) expressed in the parent's space at rest (local Y on the fixture rig; local Z for `pelvis` on the Quaternius rig, whose `root` rest rotation is −90° about X); (3) `height` is the uniform scale on `rootBone` (REQ-ANA-001), so it scales everything below the root, including the pelvis translation, through the hierarchy, but not the root's own translation. A stride kept as root motion therefore grows with `legLength` but not with `height`; with the default in-place policy (spec 004 REQ-ANM-013) the root's horizontal translation is removed before this step and (1) has no visible effect. [NEEDS CLARIFICATION: should a kept root-motion stride also scale with `height` (factor `height · legLength`), so a taller character covers proportionally more ground? Matters only for `rootMotion: 'metadata'` (spec 004 REQ-ANM-015, P2). Owner: PM; not blocking M1.]

- **AC-ANA-010.2** Given `legLength = 1.3`, `height = 1.2` and a fixture clip whose root moves +1.0 m in Z between frames 0 and 7, When the clip is sampled with root motion kept, Then the root's local Z displacement between frames 0 and 7 is 1.3 m (± 1e-6 m), and the pelvis's vertical local component at each frame equals `v_rest + (v_clip − v_rest) · 1.3` (± 1e-6 m); Given a fixture variant whose `root` rest rotation is −90° about X (Quaternius layout), Then the same holds with `v` = the pelvis local Z component, and the pelvis local Y component is the clip value unscaled. *(Added 2026-10-09 (M1-33).)*

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
| ~~`chibi`~~ | ~~0.90~~ | ~~1.80~~ | ~~1.10~~ | ~~0.90~~ | ~~0.85~~ | ~~0.75~~ | ~~1.40~~ | ~~1.40~~ | ~~1.40~~ |
| `chibi` | 0.85 | 1.80 | 1.10 | 0.90 | 0.75 | 0.70 | 1.40 | 1.40 | 1.40 |
| `heroic` | 1.05 | 0.90 | 1.10 | 1.25 | 1.00 | 1.10 | 1.10 | 1.05 | 1.15 |
| `realistic` | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

`realistic` equals `default` on purpose: it means "authored proportions" and is meant for 96–128 px. Values are initial tuning targets, adjustable in data without a spec change once golden images are reviewed.

*(Amended 2026-10-09 (STY), PM decision.)* The `chibi` preset ships in M3 as data and is the anatomy preset of style `chibi` (spec 001 REQ-CMP-042, REQ-ANA-024). Its row is now fixed: `height` 0.90 → 0.85, `armLength` 0.85 → 0.75, `legLength` 0.75 → 0.70; the other six values are unchanged (`head` stays 1.80, inside the requested 1.6–1.8). Every value is inside its REQ-ANA-001 range, so no range widens. `armLength` 0.75 and `legLength` 0.70 sit exactly on their range minimums, so a body-shape preset (REQ-ANA-023) cannot shorten chibi arms or legs further; widening `armLength` below 0.75 or `legLength` below 0.70 would need an amendment of REQ-ANA-001. Unlike the other rows, the `chibi` row changes only with a spec amendment, because the chibi golden images and the clip exclusion list (REQ-ANA-025) depend on it.

*(Note 2026-10-09 (FX-CHIBI).)* The skin-matrix compensation of REQ-ANA-003 changes how the values are applied, not the values: every row of this table, including `chibi`, is unchanged. Chibi renders made before the fix (plank feet, folded legs) are not a reference for these values; golden images are regenerated with the fix.

- **AC-ANA-013.1** Given the `chibi` preset, When applied, Then the nine values equal the table row and one undo restores the previous values.
- **AC-ANA-013.2** Given a new preset JSON file added to the presets data (no code change), When the app builds, Then it appears in the preset menu.
- **AC-ANA-013.3** Given the shipped `presets/anatomy/chibi.json`, When it is validated, Then its values are exactly `height 0.85, head 1.80, torsoWidth 1.10, shoulders 0.90, armLength 0.75, legLength 0.70, hands 1.40, feet 1.40, limbThickness 1.40`, and each value passes the REQ-ANA-001 range check. *(Added 2026-10-09 (STY).)*

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

*(Amended 2026-10-09 (M3-00), issue #10.)* Rule (f): a skeleton group MAY carry `soleOffsetM` (REQ-ANA-008); when present it SHALL be a finite number in −0.1…0.1 m that is a whole multiple of 0.0001 m (`|v × 10000 − round(v × 10000)| < 1e-6`), and otherwise validation fails with path `skeletonGroups.<index>.soleOffsetM`. An absent field is valid and means 0.

- **AC-ANA-021.9** Given the fixture rig with `g-a.soleOffsetM` set to `0.0213`, `0`, or absent, When validated, Then validation passes; Given `0.15`, `-0.2`, `0.02134`, `NaN` or the string `"0.02"`, Then validation fails with path `skeletonGroups.0.soleOffsetM`. *(Added 2026-10-09 (M3-00).)*

### Body shapes, styles and clip exclusions (added 2026-10-09 (STY), PM decision)

Body-shape presets serve the "Body shape" step of the Easy workspace and the new-avatar wizard (spec 014). They are **relative**: each gives a factor per parameter that multiplies the anatomy preset of the current style, so the same "Stocky" works on Realistic and on Chibi.

**REQ-ANA-022 [P1]** THE SYSTEM SHALL ship body-shape presets as data files (`presets/body-shapes/<id>.json`, `BodyShapePreset` in Data & contracts), at least the six below in this menu order, where each factor is in 0.50–1.50, quantized to 0.01, and an absent factor means 1.00.

| Preset | height | head | torsoWidth | shoulders | armLength | legLength | hands | feet | limbThickness |
|--------|--------|------|------------|-----------|-----------|-----------|-------|------|---------------|
| `average` | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| `slim` | 1.00 | 1.00 | 0.90 | 0.95 | 1.00 | 1.00 | 0.95 | 0.95 | 0.85 |
| `athletic` | 1.02 | 1.00 | 1.05 | 1.15 | 1.00 | 1.03 | 1.00 | 1.00 | 1.10 |
| `stocky` | 0.95 | 1.00 | 1.20 | 1.10 | 1.00 | 0.95 | 1.05 | 1.05 | 1.25 |
| `tall` | 1.10 | 1.00 | 0.97 | 1.00 | 1.04 | 1.08 | 1.00 | 1.00 | 1.00 |
| `petite` | 0.90 | 1.00 | 0.94 | 0.92 | 1.00 | 1.00 | 0.92 | 0.92 | 0.92 |

The factors are initial tuning targets: they can change in data without a spec amendment once the M3 golden images are reviewed. Labels: Average, Slim, Athletic, Stocky, Tall, Petite.

*(Note 2026-10-09 (FX-CHIBI).)* The body-shape factors above are unchanged by the skin-matrix compensation of REQ-ANA-003; it changes how anatomy values are applied, not the values.

- **AC-ANA-022.1** Given the shipped body-shape files, When they are validated, Then there are at least 6, the first six IDs are the table's in order, and every factor equals the table.
- **AC-ANA-022.2** Given a body-shape file with factor `limbThickness: 1.51`, or with an unknown key `neck`, When validated, Then validation fails naming the file ID and the field.
- **AC-ANA-022.3** Given a new body-shape JSON file added to the presets data (no code change), When the app builds, Then it appears after the six shipped presets in the Body shape choices.

**REQ-ANA-023 [P1]** WHEN the user applies a body-shape preset THE SYSTEM SHALL set each of the nine anatomy values `p` to `clamp(q(base[p] × factor[p]), min[p], max[p])` as one undoable command, where `base` is the anatomy preset named by the current style's data file (REQ-ANA-024; the `default` preset if it names none), `min`/`max` are the REQ-ANA-001 range, and `q` rounds to 0.01 in integer hundredths: `q = floor((B × F + 50) / 100) / 100` with `B = round(100 · base[p])` and `F = round(100 · factor[p])`.

- **AC-ANA-023.1** Given style `realistic` and any current anatomy values, When the user applies `stocky`, Then the nine values equal the `stocky` factors exactly (base all 1.00), and one undo restores the previous values.
- **AC-ANA-023.2** Given style `chibi`, When the user applies `stocky`, Then `torsoWidth` is 1.32 (110 × 120 → 1.32), `limbThickness` 1.75, `legLength` 0.70 (0.665 rounds to 0.67, clamped to the 0.70 minimum) and `head` 1.80.
- **AC-ANA-023.3** Given style `chibi`, When the user applies `petite`, Then `height` is 0.80 (0.765 → 0.77, clamped to 0.80).
- **AC-ANA-023.4** Given the same style and preset applied twice on two platforms (Node and Chromium), When the values are compared, Then they are identical (integer arithmetic, P-04).

**REQ-ANA-024 [P1]** THE SYSTEM SHALL read, for each `CharacterStyle`, one style data file (`presets/styles/<style>.json`, `StyleDefinition` in Data & contracts) that names the style's anatomy preset (optional) and lists the clips excluded for that style (`excludedClips`, each a `ClipRef` with a reason), and SHALL fail validation for a file whose `anatomyPreset` is not a shipped anatomy preset ID, that lists a default clip of spec 004 (`builtin:quaternius-ual/idle` or `builtin:quaternius-ual/walk`), or that duplicates another file's `style`.

- **AC-ANA-024.1** Given the shipped style files, When validated, Then `realistic.json` names `realistic`, `chibi.json` names `chibi`, and every file passes.
- **AC-ANA-024.2** Given a fixture `chibi.json` naming `anatomyPreset: 'chubby'` (no such preset), or listing `builtin:quaternius-ual/walk`, When validated, Then validation fails naming the file and the field (`anatomyPreset` or `excludedClips.<index>`).
- **AC-ANA-024.3** Given a style file that lists a clip ref not registered in any loaded pack, When the app starts, Then the entry is ignored without an error (packs can be absent offline), and the other entries apply.

**REQ-ANA-025 [P1]** WHILE the character's `style` is S THE SYSTEM SHALL hide every clip in S's `excludedClips` from the clip picker and clip search (spec 004 REQ-ANM-001/003), and show every other compatible clip.

- **AC-ANA-025.1** Given a fixture `chibi.json` with `excludedClips` = [`builtin:fixture/hands-to-face`] and style `chibi`, When the clip picker opens or the user searches "face", Then `hands-to-face` is not listed; When the style changes to `realistic`, Then it is listed again.
- **AC-ANA-025.2** Given the shipped `chibi.json`, When the M3 visual review of all bundled clips at the `chibi` preset is done, Then every clip it lists has a written reason and every clip it does not list renders without an arm or hand intersecting the head volume by more than 1 output pixel at 64 px in the side and three-quarter cameras. [NEEDS CLARIFICATION: the initial chibi exclusion list comes from that review. Candidates to check first among the 43 UAL clips: `hit-head`, `idle-talking`, `pistol-aim-up`, `pistol-aim-neutral`, `pistol-reload`, `spell-simple-idle`, `swim-fwd`, `swim-idle`. Owner: graphics-engineer with the PM, during M3. Does not block the mechanism (AC-ANA-025.1).]

**REQ-ANA-026 [P3]** WHERE spec 001 randomize runs with anatomy unlocked THE SYSTEM SHALL draw each factor uniformly from the parameter's REQ-ANA-001 randomize range (as REQ-ANA-018) and set the value to `clamp(q(base[p] × factor))` with `base` and `q` as in REQ-ANA-023, so randomized characters keep their style's proportions. For style `realistic` (base all 1.00) the result equals REQ-ANA-018.

- **AC-ANA-026.1** Given style `chibi`, anatomy unlocked and seeds 0–999, When randomize runs, Then every `head` value is within `q(1.80 × 0.95) = 1.71` … `q(1.80 × 1.15) = 2.00` (2.07 clamped), every value is inside its REQ-ANA-001 range, and results are reproducible per seed.
- **AC-ANA-026.2** Given style `realistic` and seed `42`, When randomize runs, Then the anatomy values equal the REQ-ANA-018 result for seed 42.

**REQ-ANA-027 [P2]** WHEN the character's style changes to a style whose `excludedClips` contains clips already selected in `RenderSettings.animations` THE SYSTEM SHALL keep those selections and show a non-blocking warning naming them ("<clip> may look broken in Chibi style"), and SHALL NOT block export.

- **AC-ANA-027.1** Given `hands-to-face` selected and style `realistic`, When the style changes to `chibi` (fixture exclusion list), Then `RenderSettings.animations` is unchanged, the warning names "hands-to-face", and export proceeds.

## Edge cases

- All parameters at extremes simultaneously → no NaN, no inverted geometry; AC-ANA-003.2 shear check runs at all-min and all-max (REQ-ANA-003).
- Body swap → anatomy values are kept and re-applied to the new skeleton (REQ-ANA-002).
- Clip with scale tracks on anatomy bones → multiplied (REQ-ANA-009).
- Root motion clips with long legs → stride scaled (REQ-ANA-010).
- Props on scaled hands → not scaled (REQ-ANA-007).
- `height` changed with a hand prop equipped → the prop keeps world scale 1; a `head` prop grows; a container scale grows both (REQ-ANA-007 clarification, AC-ANA-007.3/.4). *(Added 2026-10-09 (M1-33).)*
- ~~Child joint with a rotated rest pose under a length-scaled parent → small residual shear (≤ about 0.7 %), accepted for M1 (REQ-ANA-003 known limitation, AC-ANA-003.4).~~ *(Added 2026-10-09 (M1-33).)* *(Struck 2026-10-09 (FX-CHIBI): limitation removed.)*
- Child joint with a rotated rest or animated pose under a length-scaled parent (Quaternius foot 70° from the calf, upper arm 93° from the clavicle, thigh 164° from the pelvis; a 90° knee bend) → no shear; the child keeps its world scale and orientation (REQ-ANA-003 FX-CHIBI note, AC-ANA-003.4). *(Added 2026-10-09 (FX-CHIBI).)*
- Part whose inverse bind matrices are shared with the registry's source mesh → the engine writes anatomy into its own copy per skeleton; the source is never modified and default anatomy restores the original exactly (REQ-ANA-003). *(Added 2026-10-09 (FX-CHIBI).)*
- User-uploaded character with its own rig → anatomy uses the bone map to canonical names (spec 008); unmapped anatomy bones disable that slider with a reason.
- Morph names that collide across parts → same name, same weight (REQ-ANA-012).
- Source joint names with mixed case (`Head` next to `hand_r`) → kept as-is and matched case-sensitively (REQ-ANA-020); sockets resolve through `socketBones` (REQ-ANA-019).
- Body and outfits from different skeleton groups (bind poses differ, spec 011 REQ-AST-026) → anatomy works on the character skeleton (spec 001 REQ-CMP-037); bind-pose scaling (REQ-ANA-003/008) uses that skeleton's rest pose.
- Body that declares no skeleton group (e.g. its rest pose matched none, spec 011 AC-AST-026.4) → the character skeleton uses `RigDefinition.defaultSkeletonGroup` (REQ-ANA-021, spec 001 REQ-CMP-037). *(Added 2026-10-08 (M1-01c).)*
- Rig JSON with a stale `hipBone` or top-level `joints` field (pre-M1-01c drafts) → not part of the contract and never read; the hip is `socketBones.pelvis` and rest poses come from `skeletonGroups[].restPose` (REQ-ANA-021). *(Added 2026-10-08 (M1-01c).)*
- Body-shape preset on Chibi pushes a value past its range (e.g. `legLength` 0.67) → clamped to the REQ-ANA-001 range (REQ-ANA-023, AC-ANA-023.2). *(Added 2026-10-09 (STY).)*
- Style change while an excluded clip is selected → kept with a warning (REQ-ANA-027); the picker hides it (REQ-ANA-025). *(Added 2026-10-09 (STY).)*
- Style file references a clip from a pack that is not loaded → ignored (AC-ANA-024.3). *(Added 2026-10-09 (STY).)*
- Source art whose sole sits below the lowest feet joint (Quaternius: about 2 cm) → corrected by the group's `soleOffsetM`, scaled by `height × feet` (REQ-ANA-008 M3-00 note). *(Added 2026-10-09 (M3-00).)*
- Bare feet and a thicker-soled shoe in the same skeleton group → one `soleOffsetM` from the lowest of them; the thinner one hovers by the difference, which the build warns about above 0.010 m (`AST_SOLE_SPREAD`, spec 011 REQ-AST-031). *(Added 2026-10-09 (M3-00).)*
- Character skeleton group without `soleOffsetM` (fixture rig, uploads, a group that drives no bundled body) → joint-only grounding, as in M1 (REQ-ANA-008). *(Added 2026-10-09 (M3-00).)*
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
/** Deprecated alias (amended 2026-10-09 (M1-33)): `SocketId` is the `@csg/parts-schema` name and
 *  the one specs use. `SocketBone` is kept only so older text and architecture §3.2 still resolve. */
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
  skeletonGroups: Array<{
    id: string;
    restPose: Record<JointName, RestTransform>;
    /**
     * Added 2026-10-09 (M3-00), issue #10. Height in metres of the group's lowest feet joint
     * above the lowest sole vertex, at default anatomy (REQ-ANA-008 ground offset). Written by
     * `assets:build` (spec 011 REQ-AST-030), never hand-edited. −0.1..0.1, multiple of 0.0001
     * (REQ-ANA-021 rule f). Absent = 0 (joint-only grounding).
     */
    soleOffsetM?: number;
  }>;
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

/** Added 2026-10-09 (STY), REQ-ANA-022. Data file: presets/body-shapes/<id>.json. Strict object. */
export interface BodyShapePreset {
  format: 'sprite-body-shape-preset';
  version: 1;
  id: string;                      // [a-z0-9-]{1,32}
  label: string;                   // i18n message key
  /** Menu position; shipped presets use 10, 20, ... 60. */
  order: number;
  /** Relative factors, each 0.50..1.50, quantized to 0.01; absent key = 1.00. */
  factors: Partial<AnatomyParams>;
}

/**
 * Added 2026-10-09 (STY), REQ-ANA-024. Data file: presets/styles/<style>.json, one per style.
 * Spec 013 adds style-specific fields for stickman and voxel in M3.5 (optional, same version).
 */
export interface StyleDefinition {
  format: 'sprite-style';
  version: 1;
  style: CharacterStyle;           // spec 001 REQ-CMP-038
  /** AnatomyPreset id applied when the user picks this style (spec 001 REQ-CMP-042). */
  anatomyPreset?: string;
  /** Clips hidden while this style is active (REQ-ANA-025). */
  excludedClips: Array<{ clip: ClipRef; reason: string }>;
}

// Added 2026-10-09 (FX-CHIBI), REQ-ANA-003/007/009. Engine API, `packages/engine/src/anatomy/apply.ts`.
// `AnatomyBinding` = rig + character skeleton (engine contracts). Vector3, Object3D from three.

/**
 * Own-frame skin factor per joint (exact joint name): the compensated factors on the joint's
 * length / cross-section axes, (1, 1, 1) elsewhere. Never written into Bone.scale.
 * Cached per binding and values; read-only.
 */
export function anatomySkinScales(
  binding: AnatomyBinding,
  params: AnatomyParams,
): ReadonlyMap<JointName, Vector3>;

/**
 * For every SkinnedMesh under `root`: boneInverses[b] = S(skin(joint b)) · B⁻¹(b), written into a
 * per-skeleton copy (shared source matrices untouched). Rewrites a skeleton only when the values
 * changed; skin (1, 1, 1) restores B⁻¹ exactly. Allocation-free after the first call per skeleton.
 */
export function applyAnatomyToSkins(
  binding: AnatomyBinding,
  params: AnatomyParams,
  root: Object3D,
): void;

/**
 * Factor for a static prop's local scale and offset (REQ-ANA-007): (1, 1, 1) when it inherits
 * scale, else 1 / uniform(joint) on every axis. The returned vector is reused between calls.
 */
export function socketPropScale(
  binding: AnatomyBinding,
  params: AnatomyParams,
  socket: SocketId,
  inheritScale?: boolean, // default: true for 'head' only
): Vector3;
```

*(Added 2026-10-09 (STY).)* Spec 013 REQ-STY-019 adds the socket ID `tail` in M3.5. From then on `SocketId` is `'hand_r' | 'hand_l' | 'head' | 'spine_03' | 'pelvis' | 'tail'`, and the committed rig gains `socketBones.tail = 'pelvis'`. REQ-ANA-019 then requires the `tail` entry like every other socket ID (a missing `tail` fails validation), and REQ-ANA-007 applies to `tail` with `inheritScale` default false.

Application order per frame (contract for engine and tests): 1) sample clip (spec 004), including the rest-pose correction of spec 004 REQ-ANM-023 onto the character's skeleton group *(added 2026-10-08, M1 PM rig update b)*; 2) apply root-motion policy (spec 004); 3) apply anatomy (`height` → length/width/thickness with compensation → propagating `head`/`hands`/`feet`); 4) apply grounding offset (computed once per anatomy change in bind pose, from joints and `soleOffsetM` only, REQ-ANA-008); 5) update socket props; 6) skinning.

*(Amended 2026-10-09 (FX-CHIBI).)* Step 3 has two parts: 3a) pose: uniform factors into `Bone.scale`, each child's local translation times its parent's `skin` factor, root/pelvis translation per REQ-ANA-010 (`applyAnatomyToPose`); 3b) skins: `S(skin) · B⁻¹` into each skeleton's inverse bind matrices (`applyAnatomyToSkins`), rewritten only when the anatomy values change. The "compensation" in step 3 above means this, not inverse scales on child bones.

## Non-functional

- NFR-1 (P-07): anatomy update < 16 ms CPU; no part reload.
- NFR-2 (P-04): anatomy math uses no time or randomness and runs in a fixed order; equal inputs give bit-identical bone matrices on the same platform.
- NFR-3 (P-06): sliders have visible labels, numeric equivalents and keyboard steps; hints are announced via a polite live region.
- NFR-4 (P-10): anatomy math lives in DOM-free `packages/engine/src/anatomy/` and is unit-testable in Node with fixture rigs.

## Open questions

- [NEEDS CLARIFICATION: Do the Quaternius bodies ship morph targets? The vendor pages do not mention shape keys. If none exist, REQ-ANA-012 applies only to uploads. Answered by the M1 spike.]
- ~~[NEEDS CLARIFICATION: Final bone lists per parameter and `lengthAxis` for the Quaternius rig. Blocks REQ-ANA-002/005 data, not the engine code. Answered by M1 `verify-rig`. Partly answered 2026-10-08: names, hierarchy and `lengthAxis` are identical across all 36 checked files (outcome `mapped` only for bind poses); the overlay lists remain to be committed (M1-14) and confirmed in the M1-33 pass.]~~ Resolved 2026-10-09 (M1-33): `lengthAxis: 'y'`; the `anatomyBones`, `regionBones` and `socketBones` lists are committed in `tools/rigs/quaternius-ue5-65.overlay.json` and copied into `packages/parts-schema/rigs/quaternius-ue5-65.json` (e.g. `height` → `root`, `head` → `Head`, `feet` → `foot_l`, `foot_r`). Changes to these lists are data edits checked by REQ-ANA-021 and spec 011 `assets:check`.
- The morph-target question above was not checked by the M1 spike (verify-rig does not inspect morph targets); it stays open. *(Note 2026-10-09 (M1-33).)*
- [NEEDS CLARIFICATION: Does spec 003 own drawing the face decal layer (snapping, palette interaction)? This spec assumes yes and owns only selection and offset.]
- [NEEDS CLARIFICATION: (added 2026-10-09 (STY)) Initial content of the chibi clip exclusion list (AC-ANA-025.2), from the M3 visual review. Owner: graphics-engineer with the PM. Blocks the shipped `chibi.json` content, not the mechanism.]
- (Added 2026-10-09 (STY).) Body-shape presets are relative factors over the style's anatomy preset (REQ-ANA-023) rather than absolute values, so one preset list serves Realistic and Chibi. The PM decision asked for "named presets over the existing 9 multipliers"; for style `realistic` the two readings give identical values (AC-ANA-023.1).

- Resolved 2026-10-09 (M3-00, user decision on GitHub issue #10): the ground is the sole, not the lowest feet joint. REQ-ANA-008 adds the per-skeleton-group `soleOffsetM` from the rig data, scaled by `height × feet`; spec 011 REQ-AST-030..034 measure, store and check it. Lands in M3 (plan rows M3-01 schema, M3-05 engine, M3-06 tools, M3-17 goldens).

## References

- GitHub issue #10 (AC-PIX-008.1 fails: joint-based grounding leaves the Quaternius soles about 2 cm below ground) and the FX-G diagnosis in `packages/engine/test/gpu/idle-grounding.gpu.ts` (lowest feet joint rest height 0.0152 m male, 0.0148 m female; lowest idle sole −0.024 to −0.031 m)
- `.tagconn/work/m3-plan.md` row M3-00 and §8
- PM decision 2026-10-09 (STY): chibi in M3, body-shape presets, per-style clip exclusions, NG2 amendment; spec 013
- ADR-0001 (readability risk), ADR-0008 (M1 rig outcome, `docs/adr/0008-shared-rig-skeleton-groups-runtime-retarget.md`); `docs/architecture.md` §2.1 (assembly order), §3.2–3.3
- M1 implementation read for the 2026-10-09 (M1-33) clarifications: `packages/engine/src/anatomy/apply.ts` (compensation, ground offset, root/pelvis scaling, prop scale), `packages/engine/src/anatomy/anatomy.test.ts`, `packages/engine/src/composition/evaluate-pose.ts`
- FX-CHIBI fix read for the 2026-10-09 (FX-CHIBI) amendments: `packages/engine/src/anatomy/apply.ts` (`anatomySkinScales`, `applyAnatomyToSkins`, `socketPropScale`), `packages/engine/src/composition/evaluate-pose.ts` (step 3 order), `packages/engine/src/anatomy/anatomy.test.ts` (AC-ANA-003.1/.4 at 1e-9, inverse-bind test, AC-ANA-009.1 clip-scale case)
- `.tagconn/work/research.md` (anatomy and readability notes, 2026-10-08)
- Autodesk Maya joint attribute "Segment Scale Compensate" (concept reference for child compensation; Maya documentation, joint attributes)
- three.js `SkinnedMesh` / `Skeleton` docs (r186): https://threejs.org/docs/#api/en/objects/SkinnedMesh (accessed 2026-10-08)
- Quaternius Universal Base Characters: https://quaternius.itch.io/universal-base-characters (accessed 2026-10-08)
- `.tagconn/work/m1-plan.md` §2.1, §5 (D1) and the M1 verify-rig PM update (2026-10-08)
- Committed rig `packages/parts-schema/rigs/quaternius-ue5-65.json` and overlay `tools/rigs/quaternius-ue5-65.overlay.json` (shape of `parents`, `defaultSkeletonGroup`, `skeletonGroups`; read 2026-10-08, M1-01c)
