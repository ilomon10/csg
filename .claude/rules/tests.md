---
paths:
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - '**/e2e/**'
---

# Test rules

Governing docs: constitution P-09 (test traceability), `specs/000-overview.md` (GEN), architecture 4.7 (testing strategy).

- Name each test after the AC it checks: `it('AC-PIX-003.1: ...')`. Playwright uses `test('AC-UX-010.2: ...')`. One test may cite several ACs.
- Every test that checks spec behavior cites an AC. Every P1 AC needs at least one test.
- Unit tests run in Vitest under Node. Component tests use Vitest with jsdom and Testing Library. Golden-image tests run in Playwright on Chromium, once with WebGPU and once with `forceWebGL`.
- Golden tolerance is zero differing pixels after quantization. A per-test override needs a written reason in the test file.
- Keep tests deterministic: seed PRNGs, and never assert on the real clock or `Math.random()`.
- Fixtures are small (under 200 KB) and live under `packages/<name>/test/fixtures/` or are generated in code (`pnpm fixtures:build`). Never use the large source packs.
- Do not merge `it.skip` or `test.fixme` without an AC reference and a stated reason.
- Commands: `pnpm test` (all), `pnpm exec vitest run <path>` (one folder), `pnpm e2e` (Playwright).
