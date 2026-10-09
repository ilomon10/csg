---
title: Testing
description: The test layers, how to name tests after acceptance criteria, GPU tests and golden images, the pinned golden container, and how to run and update each suite.
---

Tests check the acceptance criteria (ACs) in `specs/`. Every P1 AC needs at least one automated test (constitution P-09).

## Test layers

- **Unit tests (Vitest, Node).** Schemas, migrations, the graph model, compiler structure, retargeting math, exporters and the PRNG. These run in `pnpm test`.
- **Component tests (Vitest, jsdom, Testing Library).** Editor panels, shortcut handling and graph editor commands. These run in `pnpm test`.
- **GPU tests (Vitest browser mode, Playwright Chromium).** The real pixel pipeline runs in Chromium on WebGPU and on WebGL2, and the frames are compared with stored golden PNGs. See [GPU tests and goldens](#gpu-tests-and-goldens).
- **End-to-end tests (Playwright).** Compose, export, upload and graph edit flows. Chromium runs in CI. A Firefox run on WebGL2 is planned.
- **Site checks.** The website build runs in CI. The link check is planned.

## Naming

Start each test name with the AC ID it checks:

```ts
it('AC-PIX-003.1: snaps model translation to the texel grid', () => {
  // ...
});
```

One test may cite several ACs, for example `it('AC-EXP-001.1, AC-EXP-001.2: ...')`. Playwright tests use the same form: `test('AC-UX-010.2: ...')`.

A test that checks spec behavior must cite an AC. Do not write a test for behavior that no spec describes; write the spec first.

## GPU tests and goldens

GPU tests render real frames in a browser, so they check what a user sees rather than what a function returns.

### Where they live and how they run

- **File names.** GPU tests are `*.gpu.ts` files in `packages/engine/test/gpu/`. Helpers that a GPU test imports, such as `harness.ts`, have other names and are not run on their own.
- **Projects.** The root `vitest.config.ts` defines two projects, `gpu-webgpu` and `gpu-webgl2`. Each test runs once per backend.
- **Opt-in.** The GPU projects exist only when `CSG_GPU=1` is set. The `pnpm test:gpu` and golden scripts set it for you. `pnpm test` never runs `*.gpu.ts` files, so it stays fast and needs no browser.
- **Backend check.** After `renderer.init()`, the harness asserts that the backend it got is the one the project asked for. Without the Chromium WebGPU flags, three.js silently falls back to WebGL2, and a "WebGPU" test would then pass on the wrong backend. The harness fails rather than skips.
- **Canvas.** On WebGL2, do not reuse a canvas that a disposed renderer used. Create a fresh canvas for each renderer.

If Chromium is missing on your machine, install it with the same command as the end-to-end tests: `pnpm --filter @csg/web exec playwright install --with-deps chromium`.

### The canonical golden container

Golden images are only meaningful when they come from one fixed environment. The canonical environment is a Docker container:

- **Image.** `mcr.microsoft.com/playwright:v1.64.0-noble`, pinned by digest: `sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f`. The script pulls the image by digest if it is not already present.
- **Software rendering.** The container has no GPU. Chromium uses the SwiftShader software rasterizer for both WebGPU and WebGL2. The test config pins those adapters when `CSG_GOLDEN_ENV=canonical`, so the results do not depend on autodetection.
- **Docker is required.** Install Docker before you run a golden script. The first run pulls the image.
- **Your files.** The script mounts the repository and runs as your user, so written files keep your ownership. Run `pnpm install` on the host first. The container uses the host `node_modules` (Linux x64).
- **Environment record.** Each golden run writes `environment.json` with the image digest, the Chromium version, the three.js version and the adapter info for each backend.

Only the canonical environment can write goldens, and only there does a golden mismatch fail the run. Outside it, a mismatch is reported with its artifacts but does not fail the run (AC-PIX-028.3). That is why a local run is not a gate.

### Commands

```sh
pnpm test:gpu                                    # GPU tests on this machine. Golden mismatches are reported only.
pnpm test:gpu:docker                             # The gate: the same tests in the canonical container. Run before you open a PR.
CSG_GOLDEN_REASON="why the pixels change" pnpm goldens:docker   # Rewrite the goldens that changed, in the container.
```

Running `pnpm goldens:update` directly on your machine is refused. The harness writes nothing outside the canonical container, so a local run cannot change the stored goldens.

### Where the goldens and diffs are

- **Goldens.** `packages/engine/test/goldens/<backend>/<name>.png`, one per backend (`webgpu` or `webgl2`), plus `packages/engine/test/goldens/environment.json`.
- **Diffs.** On every mismatch the harness writes `test-results/goldens/<backend>/<name>/` with three files:
  - `actual.png`, the frame the test rendered.
  - `expected.png`, the stored golden. It is missing when no golden exists yet.
  - `diff.png`, where the differing pixels are red and the unchanged pixels are a dimmed copy of the expected image.
- **Tolerance.** The default is zero differing pixels. A test may set `maxDiffPixels` for itself, but the reason must be written in the test file.

Put the `diff.png` files in the PR when a golden changes.

### Updating goldens

Update goldens only when a rendering change is intended.

1. Make the change, and run `pnpm test:gpu:docker`. The tests that changed fail, and their diffs are in `test-results/goldens/`.
2. Check the diffs. If the change is right, run `CSG_GOLDEN_REASON="why the pixels change" pnpm goldens:docker`.
3. The script rewrites only the cases that differ, and records `environment.json`.
4. Commit the goldens with the reason, and attach the diffs to the PR.

The harness refuses an update in three cases, and writes nothing:

- **No reason.** `CSG_GOLDEN_REASON` is empty.
- **Not canonical.** The update ran outside the container.
- **Environment changed.** The image digest or the three.js version differs from `environment.json`. If the change is deliberate, such as a Playwright or three.js bump, rerun with `CSG_GOLDEN_ALLOW_ENV_CHANGE=1`.

### Why updates come only from the container

A golden is a promise about the pixels that CI and every other developer will see. A laptop GPU, a different driver or a different browser build can change a pixel by one value. If goldens were written on a laptop, the next CI run would fail for a reason nobody can reproduce. So the goldens are written only in the pinned container, from the same image as CI.

### Manual update workflow

The **Update goldens** workflow (`.github/workflows/update-goldens.yml`) regenerates the goldens in the container without a local setup:

1. Open **Actions**, choose **Update goldens**, and run it with a `reason`. The reason is required.
2. The workflow runs `pnpm goldens:update` in the container and uploads the artifact `updated-goldens`. The artifact holds `packages/engine/test/goldens/**` and `test-results/goldens/**`.
3. Nothing is committed by the workflow. Download the artifact, copy the files into `packages/engine/test/goldens/`, and commit them with the reason.

The workflow does not set `CSG_GOLDEN_ALLOW_ENV_CHANGE`. After an image or three.js bump, run `goldens:docker` locally with that variable instead.

CI's `gpu-tests` job runs `pnpm test:gpu` in the same container, and it uploads `test-results/goldens/**` and `test-results/perf/**` as the artifact `gpu-test-results`, even when a test fails.

### Keeping the image pinned

The image digest is written in three files. Change them together:

- `scripts/golden-env/run.sh` (`IMAGE_TAG` and `IMAGE_DIGEST`).
- `.github/workflows/ci.yml` (the `gpu-tests` job: `container.image` and `CSG_GOLDEN_IMAGE`).
- `.github/workflows/update-goldens.yml` (the `update-goldens` job: `container.image` and `CSG_GOLDEN_IMAGE`).

The image tag must equal the exact `@playwright/test` version. `apps/web` and `packages/engine` pin Playwright to exact versions with no caret. A Playwright bump therefore means:

1. Pin the new version exactly in `apps/web` and `packages/engine`.
2. Change the tag and the digest in all three files above.
3. Regenerate every golden with `goldens:docker`, on both backends, with a reason. Use `CSG_GOLDEN_ALLOW_ENV_CHANGE=1` because the environment changed.
4. Do all of it in one PR, so no commit has goldens that match a different image.

A three.js upgrade changes pixels too, so it also needs regenerated goldens on both backends (ADR-0003).

### PR checklist

The pull request template asks for these items when pixels change:

- Golden images were regenerated for each backend, with the reason.
- The reason is recorded in the PR, and the goldens were regenerated in the canonical container (`pnpm goldens:docker` or the **Update goldens** workflow), not locally.
- The PR includes the golden diffs from `test-results/goldens/`.

## Determinism

- Seed every random source. Do not assert on the real clock or on `Math.random()`.
- Export tests must give the same bytes for the same input on the same backend (P-04).

## Fixtures

- Keep fixtures small (under 200 KB). Put them under `packages/<name>/test/fixtures/` or generate them in code. `pnpm fixtures:build` generates the synthetic asset fixtures (spec 011, REQ-AST-021).
- Never use the large source packs in tests.

## Skipped tests

Do not merge `it.skip` or `test.fixme` without an AC reference and a stated reason.

## Commands

```sh
pnpm test                              # all Vitest suites (no GPU tests)
pnpm exec vitest run packages/engine   # one folder
pnpm test:gpu                          # GPU tests on this machine (reported only, no gate)
pnpm test:gpu:docker                   # GPU tests in the canonical container (the gate)
pnpm e2e                               # Playwright end-to-end tests
pnpm spec:check                        # spec IDs, prefixes and structure
pnpm spec:trace                        # regenerate the AC-to-test matrix
```

`pnpm spec:trace` writes `specs/traceability.md`. It lists every AC and the test files that cite it, so you can see gaps.
