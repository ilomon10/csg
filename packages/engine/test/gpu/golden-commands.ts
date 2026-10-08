/** Vitest browser commands (run in Node) used by the GPU harness. Registered in `vitest.config.ts`. */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {BrowserCommand} from 'vitest/node';
import {encodePng} from './png.ts';
import {compareGoldenNode} from './golden-node.ts';
import type {
  CompareResult,
  EnvironmentRecord,
  GoldenBackend,
  GoldenOverride,
} from './golden-node.ts';

/** Payload of `csgCompareGolden`; the pixels travel as base64 (structured-clone safe). */
export interface CompareGoldenPayload {
  backend: GoldenBackend;
  name: string;
  rgbaBase64: string;
  width: number;
  height: number;
  override?: GoldenOverride;
  environment: EnvironmentRecord;
  /** Test-only golden root relative to the repo root (default: committed goldens). */
  goldenDir?: string;
}

/** Repo root (vitest runs with cwd = repo root). */
const repoRoot = () => resolve(process.cwd());

const csgCompareGolden: BrowserCommand<[CompareGoldenPayload]> = (
  _ctx,
  p,
): CompareResult => {
  const root = repoRoot();
  const result = compareGoldenNode(
    {
      backend: p.backend,
      name: p.name,
      rgba: new Uint8Array(Buffer.from(p.rgbaBase64, 'base64')),
      width: p.width,
      height: p.height,
      override: p.override,
      environment: p.environment,
      goldenRoot: join(root, p.goldenDir ?? 'packages/engine/test/goldens'),
      artifactRoot: join(root, 'test-results/goldens'),
    },
    process.env,
  );
  if (result.message !== '') console.log(`[golden] ${result.message}`);
  return result;
};

const csgWriteReport: BrowserCommand<[string, unknown]> = (
  _ctx,
  name,
  json,
) => {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(name))
    throw new Error(`bad report name ${name}`);
  const dir = join(repoRoot(), 'test-results/perf');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, name), `${JSON.stringify(json, null, 2)}\n`);
};

const csgEnv: BrowserCommand<[]> = () => ({
  canonical: process.env.CSG_GOLDEN_ENV === 'canonical',
  image: process.env.CSG_GOLDEN_IMAGE ?? null,
  perfGate: process.env.CSG_PERF_GATE === '1',
  update: process.env.CSG_GOLDEN_UPDATE === '1',
});

/** Harness self-tests: seeds a golden PNG, only below `test-results/`. */
const csgSeedGolden: BrowserCommand<
  [string, GoldenBackend, string, string, number, number]
> = (_ctx, goldenDir, backend, name, rgbaBase64, width, height) => {
  if (!goldenDir.startsWith('test-results/') || goldenDir.includes('..')) {
    throw new Error('csgSeedGolden writes only below test-results/');
  }
  const dir = join(repoRoot(), goldenDir, backend);
  mkdirSync(dir, {recursive: true});
  writeFileSync(
    join(dir, `${name}.png`),
    encodePng(new Uint8Array(Buffer.from(rgbaBase64, 'base64')), width, height),
  );
};

/** Harness self-tests: does a file below `test-results/goldens` exist. */
const csgArtifactExists: BrowserCommand<[string]> = (_ctx, rel) => {
  if (rel.includes('..')) throw new Error('bad path');
  return existsSync(join(repoRoot(), 'test-results/goldens', rel));
};

/** Commands to register under `test.browser.commands`. */
export const goldenCommands = {
  csgCompareGolden,
  csgWriteReport,
  csgEnv,
  csgSeedGolden,
  csgArtifactExists,
};
