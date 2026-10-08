---
title: Testing
description: The test layers, how to name tests after acceptance criteria, golden images and how to run each suite.
---

Tests check the acceptance criteria (ACs) in `specs/`. Every P1 AC needs at least one automated test (constitution P-09).

## Test layers

- **Unit tests (Vitest, Node).** Schemas, migrations, the graph model, compiler structure, retargeting math, exporters and the PRNG.
- **Component tests (Vitest, jsdom, Testing Library).** Editor panels, shortcut handling and graph editor commands.
- **Golden-image tests (Playwright, Chromium).** Fixed fixtures render to PNG and are compared with stored images. Each run uses WebGPU and `forceWebGL`.
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

## Golden images

- Store one golden per backend (WebGPU and WebGL2). Images differ slightly between backends.
- The default tolerance is zero differing pixels after quantization.
- A per-test override needs a written reason in the test file.
- Regenerate goldens only when the rendering change is intended, and show the diff in the PR.

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
pnpm test                          # all Vitest suites
pnpm exec vitest run packages/engine   # one folder
pnpm e2e                           # Playwright end-to-end tests
pnpm spec:check                    # spec IDs, prefixes and structure
pnpm spec:trace                    # regenerate the AC-to-test matrix
```

`pnpm spec:trace` writes `specs/traceability.md`. It lists every AC and the test files that cite it, so you can see gaps.
