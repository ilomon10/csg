# 0003. WebGPURenderer, TSL and RenderPipeline on pinned three r186

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect, graphics engineer
- Related: specs 003 (pixel pipeline), 007 (graph compiler); ADR-0001, ADR-0004

## Context

The pixel pipeline needs custom lighting (toon ramp, rim), a scene pass with several outputs
(color, normal, depth, part ID) for edge detection, and a post chain (outline, palette LUT, dither,
alpha cutoff). The shader graph editor (ADR-0004) must compile user graphs to shaders at runtime and
update parameters without recompiling.

three.js offers `WebGPURenderer` (`three/webgpu`) with an automatic WebGL2 fallback, TSL (three.js
Shading Language) node materials, and `RenderPipeline` (renamed from `PostProcessing` in r183) with
`pass(scene, camera)` and MRT. `EffectComposer` does not work with `WebGPURenderer`. The TSL API
changes in almost every release. r186 was released 2026-09-24.

## Decision

- Use `WebGPURenderer` from `three/webgpu`, falling back automatically to WebGL2. Expose
  `forceWebGL` for tests and as a user workaround.
- Write all shaders as **TSL** node materials. No raw GLSL `ShaderMaterial`.
- Use **`RenderPipeline`** with one `pass(scene, camera)` and **MRT** (color, normal, depth,
  part ID). Disable `outputColorTransform` and convert color space explicitly before palette
  quantization.
- **Pin three.js to exactly r186** (no caret range) across the workspace. Upgrades are dedicated PRs
  that rerun golden images on both backends.
- Only `@csg/engine` and `@csg/shader-graph/tsl` import `three`.

## Consequences

- Good: TSL is a JS-level node graph, so the shader graph compiler maps nodes to TSL calls directly
  and exposed params become `uniform()` nodes (live slider updates).
- Good: one code path targets WebGPU and WebGL2.
- Good: MRT gives part-ID edges in one scene pass, which is cheaper than extra passes.
- Bad: API churn; examples and docs online often target other versions. Pinning delays fixes.
- Bad: WebGPU and WebGL2 output can differ slightly; golden images are stored per backend.
- Risk: Firefox on Linux has known renderer quirks. Mitigation: E2E and goldens run Firefox on
  WebGL2; known issues are documented in the user guide.
- Risk: some features may be WebGPU-only. Mitigation: specs must state backend requirements;
  any WebGPU-only stage needs a WebGL2 path or a graceful disable.

## Alternatives considered

- **WebGLRenderer + GLSL `ShaderMaterial` + `EffectComposer`**: mature, but string-based GLSL makes
  a node compiler harder, MRT support is weaker, and it is not where three.js is heading.
- **Babylon.js**: strong node material editor built in, but less ecosystem fit with
  `@pixiv/three-vrm`, gltf tooling we use, and the team's experience.
- **Raw WebGPU / custom engine**: maximum control, far more work, no WebGL2 fallback.
- **Floating three.js version**: rejected because TSL changes would break builds unpredictably.
