# 0009. Golden images and GPU determinism

- Status: Accepted
- Date: 2026-10-09
- Deciders: project owner (PM, decision D1), architect, graphics engineer, QA engineer
- Related: constitution P-04, P-05, P-09; spec 003 REQ-PIX-002, REQ-PIX-024, REQ-PIX-026..029,
  REQ-PIX-034, REQ-PIX-035; spec 007 REQ-SGF-043; ADR-0003; architecture §2.4, §4.1, §4.7;
  M2-02 container spike (results summarized in Context below)

## Context

The pixel pipeline (spec 003) promises byte-identical frames for the same document, backend and
app version (REQ-PIX-027), and per-backend golden images compared with **0 differing pixels**
(REQ-PIX-028). M4 must then reproduce those goldens pixel-exactly from the built-in shader graphs
(AC-PIX-035.1). A tolerance of 0 makes the golden environment part of the contract:

- Real GPUs and drivers differ in the last bit of float math (`pow`, interpolation, fp16
  storage), so one image cannot be valid on every machine.
- GitHub-hosted runners have no GPU. M1 observed that headless Chromium on a hosted runner
  reported `webgpu` on SwiftShader yet drew a blank preview, so the `apps/web` E2E WebGPU pixel
  check is skipped on software adapters (commit 9eeb4d9).
- WebGPU and WebGL2 read render targets back in different layouts and row orders. Without one
  rule, goldens and `RenderedFrame.pixels` (REQ-PIX-029) would depend on the backend.
- three r186 has several behaviors that break determinism or WebGL2 parity unless the engine
  works around them. M2 tasks M2-11..M2-14 found them.

Spike M2-02 (2026-10-09) ran a render-to-target and readback test in
`mcr.microsoft.com/playwright:v1.64.0-noble`. Both backends rendered non-blank (WebGPU 450
distinct colors, WebGL2 449). Three renderer instances in one page gave the same SHA-256 per
backend, and the hashes were also equal across two separate `docker run`s and on the host with
the same Playwright Chromium. HalfFloat MRT attachments were deterministic too. WebGPU only works
when Chromium gets `--enable-unsafe-webgpu`. Without that flag `requestAdapter()` returns `null`,
three silently falls back to WebGL2, and the "webgpu" image is really a WebGL2 image.

## Decision

Generate and gate goldens for **both backends** in one **pinned Playwright container with
software rasterizers**, behind an explicit canonical-environment guard. Tolerance is 0, goldens
are stored per backend, and updates happen only inside the container with a stated reason. Every
readback goes through one normalization function. The r186 workarounds below are mandatory
engine conventions.

### 1. Canonical golden environment

| Item | Value |
|------|-------|
| Image | `mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f` (multi-arch index digest; linux/amd64 manifest `sha256:bc72a8df…b462`) |
| Browser | Playwright Chromium 156.0.8078.4, headless |
| three | 0.186.1 (exact pin, ADR-0003) |
| WebGPU | Dawn SwiftShader adapter: `adapter.info` `{vendor: 'google', architecture: 'swiftshader'}`, `isFallbackAdapter: true` |
| WebGL2 | `forceWebGL: true`; ANGLE on Vulkan SwiftShader (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) …))`); `EXT_color_buffer_float` and `EXT_color_buffer_half_float` available |
| Chromium args | `--enable-unsafe-webgpu --enable-features=Vulkan`, plus `--use-webgpu-adapter=swiftshader --use-angle=swiftshader` when canonical (`vitest.config.ts`) |
| Runner | Vitest browser mode (`@vitest/browser-playwright`), projects `gpu-webgpu` and `gpu-webgl2`, files `packages/engine/test/gpu/**/*.gpu.ts`, opt-in with `CSG_GPU=1` |

- **Tie to Playwright.** The image tag equals the exact `@playwright/test` version (no caret).
  Bumping Playwright, and with it Chromium and SwiftShader, means a new tag and digest plus
  regenerated goldens.
- **The digest is in three places.** It appears in `.github/workflows/ci.yml` (`gpu-tests`),
  `.github/workflows/update-goldens.yml` and `scripts/golden-env/run.sh`. All three change in the
  same PR.
- **Local use.** Contributors run the same image with `scripts/golden-env/run.sh test:gpu`, or
  `pnpm goldens:docker` for updates. It runs as the host user, mounts the repo, and passes
  `--ipc=host`. pnpm is not in the image, so `run.sh` mirrors the root `test:gpu` and
  `goldens:update` scripts. Keep them in sync.
- **CI.** The `gpu-tests` job runs `pnpm test:gpu` inside the container with
  `CSG_GOLDEN_ENV=canonical` and `CSG_GOLDEN_IMAGE=<image>`. It uploads `test-results/goldens/**`
  and `test-results/perf/**` as the `gpu-test-results` artifact on every run.

### 2. Canonical guard (`CSG_GOLDEN_ENV`)

- `CSG_GOLDEN_ENV=canonical` is set only by `scripts/golden-env/run.sh` and by the CI container
  jobs. Contributors never set it by hand.
- **Backend check, always on.** After `renderer.init()` the harness (`test/gpu/harness.ts`)
  checks `renderer.backend.isWebGPUBackend` against the project's backend. If they differ it
  **throws** in every environment, which catches the missing `--enable-unsafe-webgpu` fallback.
- **Adapter check, canonical only.** Under the canonical guard the WebGPU adapter must report
  `architecture: 'swiftshader'`, otherwise the test fails. Tests fail; they never skip. The
  AC-PIX-028.1 fallback (WebGPU goldens on a maintainer GPU, CI reporting "software adapter"
  skips) is **not used**, because the spike met the primary condition.
- **Outside the canonical guard**, for example on a developer's real GPU, a comparison never
  fails and never writes. It logs the differing-pixel count and writes the artifacts
  (AC-PIX-028.3). Real-GPU runs are informational only.

### 3. Goldens, tolerance and comparison

- **Layout.** `packages/engine/test/goldens/<webgpu|webgl2>/<case>.png` plus one
  `environment.json` with `{image, three, backends: {webgpu|webgl2: {userAgent, adapter}}}`. Case
  names match `^[a-z0-9][a-z0-9-]*$`. REQ-PIX-028 defines the matrix: `side`, `three-quarter` and
  `isometric` at 32, 64 and 128 px, so 9 cases per backend and 18 in total. AC goldens come on
  top. The matrix suite is task M2-18, in progress.
- **Tolerance 0.** A pixel differs when any of its RGBA channels differs. A per-test override is
  `{maxDiffPixels, reason}`. The count is a non-negative integer, and an empty reason throws.
- **Compare only normalized buffers.** The browser sends the tight top-left RGBA8 buffer (§5)
  to the Node command `csgCompareGolden` (`test/gpu/golden-commands.ts` →
  `golden-node.ts`). Raw readbacks, including WebGPU row padding, are never hashed or compared.
- **Failure artifacts** (AC-PIX-028.5) go to
  `test-results/goldens/<backend>/<case>/{actual,expected,diff}.png`. In the diff image, red
  marks a differing pixel and a dimmed copy of the expected image marks the rest.
- **Cross-backend.** The same case is compared between WebGPU and WebGL2 for information only.
  A share of differing opaque pixels above 2 % logs a warning (AC-PIX-028.2). The spike measured
  0.9 % (max channel delta 1) on a lit sphere.

### 4. Update workflow

- **The only writer is `CSG_GOLDEN_UPDATE=1`** (`pnpm goldens:update`). It is accepted only when
  all of these hold, and otherwise nothing is written and the test fails with instructions
  (AC-PIX-028.4):
  - the guard is canonical;
  - `CSG_GOLDEN_REASON` is non-empty;
  - `environment.json` matches the current image, three version and per-backend user agent. If
    the image or three was bumped on purpose, `CSG_GOLDEN_ALLOW_ENV_CHANGE=1` overrides this
    check, and the error names the field that did not match.
- **What gets written.** Only cases that differ or are new are rewritten. PNG and
  `environment.json` writes are atomic (temp file plus rename).
- **Local route.** Run `CSG_GOLDEN_REASON="why" pnpm goldens:docker` (= `run.sh goldens:update`),
  then commit the PNGs. The commit message and the PR description carry the reason.
- **CI route.** The `Update goldens` workflow is `workflow_dispatch` only, with a required
  `reason` input. It passes the reason through `env` and never interpolates it into a shell
  command. It runs `pnpm goldens:update` in the same container and uploads `updated-goldens` (the
  goldens tree plus `test-results/goldens/**`) as an artifact. It has `contents: read` and
  commits nothing. A maintainer reviews the artifact, copies it into `packages/engine/test/goldens/`
  and commits it with the reason.
- **Re-baselining.** Any change to the approved look (spec 003 REQ-PIX-011 "Final look
  approved"), the image, three or Playwright re-baselines the goldens through this workflow.

### 5. Readback and orientation conventions

| | WebGPU | WebGL2 |
|---|---|---|
| `readRenderTargetPixelsAsync` row stride | `ceil(W · bpp / 256) · 256` bytes (three r186 `WebGPUTextureUtils.copyTextureToBuffer`) | `W · bpp`, tight |
| Buffer length | `(H − 1) · stride + W · bpp`: the **last row is not padded** | `W · H · bpp` |
| Row 0 | **top** | **bottom** (`readPixels`) |
| HalfFloat attachments | `Uint16Array`, same rules with `bpp = 8` | same, tight, bottom-up |

- `normalizeReadback(raw, w, h, {rowStrideBytes, bottomUp})` (`pipeline/readback.ts`) is the
  only conversion. It strips the padding and flips WebGL2 rows. `cellReadbackLayout(backend, w)`
  gives the layout for the RGBA8 cell. Callers never assume `raw.length === h · stride`.
- `RenderedFrame.pixels` and every golden are tight RGBA8 with a **top-left origin** on both
  backends (REQ-PIX-029). AC-PIX-029.1 checks this with a 48×40 marker (192-byte rows, which are
  not 256-aligned).
- In shaders, `screenCoordinate`, and so the `screenPos` builtin, is the integer cell pixel with
  a top-left origin on both backends. three normalizes WebGL through `isFlipY`. Post stages fetch
  neighbors with `texture.load(ivec2)` only, never filtered sampling (AC-SGF-043.2).
- The cell target is `RenderTarget(W, H, {type: UnsignedByteType, format: RGBAFormat, colorSpace:
  NoColorSpace, nearest, no mipmaps, no depth, samples: 0})`. `NoColorSpace` is mandatory: an
  sRGB-tagged texture may get an `-srgb` GPU format and re-encode values. A render target gets no
  output color transform, so values stay in the pipeline's explicit encoding (the spike's
  `0x101820` background read back as `(1, 2, 4)` linear).

### 6. three r186 notes (binding workarounds)

1. **Node-frame advance per render.** r186 advances `NodeFrame.frameId` only in its
   `requestAnimationFrame` loop, and skinning updates bone matrices once per `frameId`. When frames
   are rendered back to back without a loop tick, as in export or a readback between frames,
   skinned meshes would draw with the previous frame's bones. A `FRAME`-updated `PassNode` would
   also reuse a stale scene render. Therefore `PixelPipeline.render()` does three things:
   - calls the renderer's internal node frame `update()` (`renderer._nodes.nodeFrame`);
   - sets `scenePass.updateBeforeType = NodeUpdateType.NONE`;
   - drives `scenePass.updateBefore()` itself, exactly once per frame (AC-PIX-014.2).

   All pipeline rendering goes through `PixelPipeline.render()`. The internal lookup throws if the
   field moves, so a three upgrade fails loudly instead of rendering stale bones.
2. **`select` with texture-fetch branches fails on WebGL2.** The GLSL backend cannot build a
   `select` whose branches contain texture fetches: the flip-Y `toVar` is emitted outside a
   stack. Stages blend with `pick(a, b, t) = a · (1 − t) + b · t` and an exact 0/1 weight
   (`pipeline/stages/edge-detect.ts`), which is exact for finite inputs. `select` stays allowed
   for non-texture values and uniforms. The M4 compiler lowers `math.select@1` over
   texture-derived inputs the same way.
3. **`sRGBTransferOETF` is not used.** r186 uses the exponent `0.41666` instead of `1 / 2.4`, and
   its `mix` turns the NaN of `pow` of a negative value into a NaN result. `color.linearToSrgb@1`
   uses its own `srgbOetf` instead (`pipeline/stages/color-space.ts`): the exact IEC 61966-2-1
   curve, with `pow` only on `c ≥ 0.0031308` and `mix` with a 0/1 step weight. It matches the CPU
   reference `linearToSrgb8` up to GPU `pow` precision.
4. **`EXT_color_buffer_float` is required on WebGL2.** The scene MRT (`output`, `normalDepth`,
   `partId`) is HalfFloat. `createPixelPipeline` checks the extension before it allocates any
   target, and fails with `PIX_BACKEND_UNAVAILABLE` (`details.reason: 'EXT_color_buffer_float'`)
   when it is missing (AC-PIX-026.2). An RGBA8 encoding fallback is deferred.
5. **Smaller pitfalls**, each with its convention:
   - MRT attachments are matched by texture name, so each attachment's name must equal its
     `mrt({...})` key. Otherwise WebGPU emits empty WGSL structs and WebGL leaves the attachment
     blank, with no error.
   - `PassNode` sizes its target from `renderer.getDrawingBufferSize()`, so the canvas drawing
     buffer must equal the cell size: pixel ratio 1, `setSize(W, H, false)`. Upscaling is done
     with CSS only.
   - three's `alphaTest` discards `alpha ≤ cutoff`. Coverage is `alpha ≥ cutoff`
     (REQ-PIX-023), so materials use `maskNode` on the shared `alpha.cutoff` uniform instead.
   - On WebGL2, a disposed renderer loses its canvas context. Tests use a fresh canvas for each
     renderer instance.

### 7. Performance measurements

The container is a software rasterizer, so performance runs there only report and never gate.
They write JSON to `test-results/perf/`. Budgets are gated with `CSG_PERF_GATE=1` on the
reference machine (PM decision 2026-10-08). This also applies to AC-PIX-034.2 (spec 003 note).

## Consequences

- Good: both backends are gated on every PR on free, GPU-less runners, and every contributor can
  reproduce the gate bit for bit with one script.
- Good: a tolerance of 0 makes any pixel change visible and gives M4 an exact target
  (AC-PIX-035.1).
- Good: the guard prevents the two silent failures found in the spike: a WebGL2 image stored as
  "webgpu", and goldens written from an unpinned environment.
- Good: readback is one tested function, so exporters, goldens and the preview equality check
  (AC-PIX-030.1) share one byte layout.
- Bad: goldens prove that our code is deterministic on SwiftShader, not that a real GPU draws
  the same bytes. Real GPU drift is only reported. Users' exports remain deterministic per
  machine and backend (REQ-PIX-027), not across machines.
- Bad: software rendering is slow (a first render plus compile takes about 100–400 ms per
  renderer in the spike), so the GPU suites must reuse renderers. The container cannot measure
  performance budgets.
- Bad: every Playwright or three bump re-baselines all goldens, and the image digest must be
  edited in three files.
- Bad: the pipeline depends on a private three field (`_nodes.nodeFrame`). The dedicated three
  upgrade PR (ADR-0003) must re-check it, and the loud throw makes that unavoidable.
- Risk: the `apps/web` E2E WebGPU pixel check still skips on software adapters. That was observed
  outside the container with the M1 renderer, before the flags above were applied. Task M2-20
  re-checks the preview E2E with the M2 pipeline. If the cause is the missing flags, the skip is
  removed. If not, it stays documented in architecture §4.7.
- Risk: Dawn or ANGLE SwiftShader behavior may change inside one Playwright tag. The digest pin
  prevents that; a re-pull of a moved tag is never used.

## Alternatives considered

- **Real-GPU runner (self-hosted or paid GPU CI).** This would test the hardware users run, but:
  - it costs money or maintainer hardware;
  - driver updates on the runner would silently change goldens at tolerance 0;
  - contributors cannot reproduce it;
  - a self-hosted runner that executes fork PRs is a security risk.

  Rejected. Real-GPU runs stay informational (AC-PIX-028.3).
- **WebGL2-only CI gate, WebGPU goldens on a maintainer GPU** (the AC-PIX-028.1 fallback).
  WebGPU is the primary backend, and this option would leave it ungated in CI and dependent on
  one person's driver. It was kept only as a fallback in case the spike failed. The spike
  succeeded, so it was not adopted.
- **Non-zero or perceptual tolerance.** It would hide the 1-LSB drift that M4's graph compiler
  must reproduce exactly, and it would turn palette and dither changes into judgement calls.
  Rejected. Per-test overrides with a written reason remain possible.
- **Playwright `toHaveScreenshot` in `apps/web`.** The editor may not build arbitrary three
  scenes (architecture rule 4), and canvas screenshots include CSS upscaling and compositor
  output. Rejected in favor of engine-level readback in Vitest browser mode.
- **Host-generated goldens without a container.** In the spike the bytes matched the host only
  because the Chromium build was the same, which is not guaranteed on other hosts or with GPU
  flags. Rejected.
