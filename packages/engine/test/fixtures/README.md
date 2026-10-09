# Engine test fixtures

Synthetic models and documents for tests that must not need `assets-src/` or built packs
(spec 011 REQ-AST-021, AC-AST-021.1). Everything except this README is generated:

```sh
pnpm fixtures:build   # tools/fixtures/make-fixtures.ts (gltf-transform), deterministic, byte-identical reruns
```

Never edit generated files by hand. Each file is at most 200 KB, all fixture files together at
most 300 KB (checked by the generator and by `tools/fixtures/make-fixtures.test.ts`). The
same JSON documents are also written to `packages/parts-schema/test/fixtures/`.

## Layout

| Path                                                           | What                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rigs/fixture-ue5-22.json`                                     | `RigDefinition` (parses with `rigDefinitionSchema`), `lengthAxis: 'y'`, skeleton groups `fixture-a` and `fixture-b`, no `hipBone` (hip is `socketBones.pelvis`)                                                                                                                                              |
| `rigs/fixture-ue5-22-x.json`                                   | Same rig with `lengthAxis: 'x'`, bones laid out along local X (AC-ANA-005.1)                                                                                                                                                                                                                                 |
| `rigs/fixture-ue5-22-sole.json`, `variants/manifest-sole.json` | The fixture rig with `soleOffsetM: 0.02` on group `fixture-a` (spec 002 REQ-ANA-008, AC-ANA-008.4/.5), and a manifest that embeds it. `fixture-b` has no value                                                                                                                                               |
| `pack/manifest.json`, `pack/clips.json`                        | Valid `PartManifest` / `ClipManifest` for pack `fixture-pack` (sha256 and triangle counts match the files)                                                                                                                                                                                                   |
| `pack/parts/fixture-body.glb`                                  | Body on `fixture-a`: one box per bone segment (20 boxes, 10 populated regions; `hair` has no bone), `_REGION` written (REQ-AST-025: `UNSIGNED_BYTE` `SCALAR`, index into `BODY_REGIONS`; `hand_l` and `hand_r` vertices hold 6)                                                                              |
| `pack/parts/fixture-shirt.glb`                                 | Skinned shirt on `fixture-a`                                                                                                                                                                                                                                                                                 |
| `pack/parts/fixture-shirt-b.glb`                               | Skinned shirt on `fixture-b` (compatibility reason `body`, AC-AST-026.1)                                                                                                                                                                                                                                     |
| `pack/parts/fixture-sword.glb`                                 | Static prop, no skin, socket `hand_r`                                                                                                                                                                                                                                                                        |
| `pack/clips/fixture-clip.glb`                                  | 1.0 s clip authored on `fixture-b` (see keyframes)                                                                                                                                                                                                                                                           |
| `variants/shirt-mismatched-rig.glb`                            | Shirt on `fixture-a` with joint `hand_r` renamed `Hand_R` (AC-AST-026.2, `AST_RIG_MISMATCH`)                                                                                                                                                                                                                 |
| `variants/five-influence.glb`                                  | Skinned part on `fixture-a`; vertex 0 has 5 influences `[0.4, 0.3, 0.15, 0.1, 0.05]` on `upperarm_l, lowerarm_l, clavicle_l, hand_l, spine_03` (`JOINTS_1/WEIGHTS_1` carry the fifth), every other vertex has 1 (AC-AST-027.1; expected after limiting: `[0.4, 0.3, 0.15, 0.1] / 0.95`, one affected vertex) |
| `character.valid.json`                                         | Valid `CharacterSpec` (body, shirt in `torso`, sword in `prop-main-hand`, default anatomy)                                                                                                                                                                                                                   |

Group ids are `fixture-a` / `fixture-b`; the spec ACs say `g-a` / `g-b` (AC-AST-026.x, AC-ANM-023.x).

## Skeleton: `fixture-ue5-22`

22 joints, canonical UE5 names (capitalised `Head`), in hierarchy order: `root`, `pelvis`,
`spine_01..03`, `neck_01`, `Head`, `Head_leaf` (leaf added to reach 22 and to give the head a segment),
`clavicle`, `upperarm`, `lowerarm`, `hand` (`_l`, `_r`), `thigh`, `calf`, `foot` (`_l`, `_r`).
Rest rotations are identity in `fixture-a`. Rest translations (metres, `+Y` up, `+Z` forward):
`pelvis (0, 0.87, 0)`, `thigh_l (0.09, -0.05, 0)`, `calf (0, -0.42, 0)`, `foot (0, -0.40, 0)`,
`lowerarm (0, -0.28, 0)`, `hand (0, -0.25, 0)`; see the rig JSON for the rest.

`fixture-b` differs from `fixture-a` by exactly:

- `upperarm_l|r` and `lowerarm_l|r`: rest rotation `Rz(+10 deg)` = `(0, 0, sin 5deg, cos 5deg)` = `(0, 0, 0.087155743, 0.996194698)`.
- `calf_l|r` and `foot_l|r`: rest translation x 1.25 (`calf (0, -0.525, 0)`, `foot (0, -0.50, 0)`).
- `pelvis`: rest translation 0.05 m higher, `(0, 0.92, 0)` (AC-AST-026.1, AC-ANM-023.2).

### Leg-length ratio (closed form)

The retargeter measures `L` as the rest-pose world height of `pelvis` above the lowest foot joint
(spec AC-ANM-023.2, `legLength` in `src/retarget/fk.ts`). Both feet are symmetric, so the lowest foot,
the mean of the feet and the sum of the Y offsets down the leg chain agree:

```
legLen(fixture-a) = 0.05 + 0.42 + 0.40         = 0.870 m
legLen(fixture-b) = 0.05 + 1.25*0.42 + 1.25*0.40 = 1.075 m
legLen(a) / legLen(b) = 0.87 / 1.075 = 174 / 215 = 0.8093023256
```

A `fixture-b` clip played on a `fixture-a` character therefore has `k = L_t / L_s = 174 / 215`
(`0.8093023256`); the inverse direction has `k = 215 / 174 = 1.2356321839`.

## Clip `fixture-clip` (authored on `fixture-b`)

Duration 1.0 s, loop, root motion, `LINEAR` interpolation, keys at `t = 0, 0.5, 1.0` s (AC-AST-021.2,
AC-ANM-023.1..3). Key 0 and key 1.0 equal the exact `fixture-b` rest value of the bone; tracks:

| Bone         | Path            | t = 0                                     | t = 0.5                               | t = 1.0                                      |
| ------------ | --------------- | ----------------------------------------- | ------------------------------------- | -------------------------------------------- |
| `root`       | translation     | `(0, 0, 0)`                               | `(0, 0, 0.5)`                         | `(0, 0, 1.0)` (root motion, +Z forward, 1 m) |
| `pelvis`     | translation     | `(0, 0.92, 0)` (rest)                     | `(0, 0.92, 0.1)` (hip +0.1 m forward) | `(0, 0.92, 0)`                               |
| `lowerarm_l` | rotation (xyzw) | `(0, 0, 0.087155743, 0.996194698)` (rest) | `Rz(10 deg) * Rx(30 deg)`             | rest                                         |

Key 0.5 s of `lowerarm_l`, closed form with `c5 = cos 5deg`, `s5 = sin 5deg`, `c15 = cos 15deg`,
`s15 = sin 15deg`: `(c5*s15, s5*s15, s5*c15, c5*c15)` = `(0.257834160, 0.022557566, 0.084185983, 0.962250187)`
(AC-AST-021.2, tolerance 1e-6; data are float32). That is the rest rotation followed by a +30 deg
elbow flexion about local X, so a retarget onto `fixture-a` (rest identity) gives `Rx(30 deg)` exactly
(AC-ANM-023.1: `q_t = q_tRest * q_sRest^-1 * q_s`).

All other bones have no track. The animation name is `fixture-clip`.
