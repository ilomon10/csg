---
paths:
  - 'packages/engine/**'
---

# packages/engine rules

Specs: 001 (CMP), 002 (ANA), 003 (PIX), 004 (ANM), 005 (EXP), 008 (UPL), 011 (AST). Public API contract: `docs/architecture.md` 3.6.

- Use three.js r186 exactly. Import WebGPU from `three/webgpu` and TSL from `three/tsl`. Check `node_modules/three` for the API before you write code.
- Every visual feature must render with `forceWebGL: true`. No `EffectComposer`, no raw GLSL `ShaderMaterial`.
- Post-processing uses `RenderPipeline` with `pass()` and MRT. Turn `outputColorTransform` off before palette quantization.
- Export code is deterministic (AGENTS.md rule on determinism). No wall clock, no `Math.random()`, no unseeded values.
- `src/rig/` and `src/retarget/` stay DOM-free and React-free, because `tools/` imports them.
- Exporters are pure functions over `RenderedFrame[]` with no three.js import, so Vitest runs them in Node.
- Expected failures return `Result<T, EngineError>` with a spec-prefixed code such as `UPL_TOO_LARGE`. Programmer errors throw.
- Reuse render targets. Dispose the geometries, materials and textures you create. Allocate nothing in per-frame loops.
- Snap camera and root translation to the texel grid (P-05).
- Name tests after ACs, for example `it('AC-PIX-003.2: ...')`. Golden images are stored per backend.
- Verify with `pnpm exec vitest run packages/engine` and `pnpm --filter @csg/engine build`.
