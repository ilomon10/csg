---
'@csg/engine': patch
---

Anatomy no longer shears limbs (spec 002 REQ-ANA-003, AC-ANA-003.4): the diagonal child compensation was inherited in each parent's frame, so on the Quaternius rig (foot rotated 70° from the calf, upper arm 93° from the clavicle) chibi feet stretched into 1.9× planks, knees folded sideways and large anatomy values hunched the arms. Anatomy now uses segment-scale compensation: `Bone.scale` carries only the uniform propagating factors (`height`, `head`, `hands`, `feet`); the compensated factors scale each joint's skin through its own inverse bind matrices (`applyAnatomyToSkins`, `anatomySkinScales`) and its children's joint offsets. Grounding uses the same forward kinematics. Default anatomy renders bit-identically; every non-default anatomy golden was regenerated.

Pixel pipeline: compiled post chains are cached per post structure (LRU of `POST_CHAIN_CACHE_SIZE` = 4, keyed by `postStructureKey`), so switching back to a recent look preset or dither mode reuses its compiled chain instead of rebuilding it (AC-PIX-034.2). The perf harness injects the bundled palette LUT worker, as the editor does (AC-PIX-021.2).
