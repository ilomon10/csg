/** Vitest browser commands (run in Node) used by the GPU harness. Registered in `vitest.config.ts`. */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
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

const BACKENDS: readonly string[] = ['webgpu', 'webgl2'];

/** A test-only golden root must be undefined or a plain relative path below `test-results/`. */
export function assertGoldenDir(dir: string | undefined): void {
  if (dir === undefined) return;
  if (
    typeof dir !== 'string' ||
    !dir.startsWith('test-results/') ||
    dir.split(/[\\/]/).includes('..') ||
    dir.includes('\0') ||
    isAbsolute(dir)
  ) {
    throw new Error(`goldenDir must be below test-results/ (got ${dir})`);
  }
}

/** The backend selects a directory name, so only the two known ones are accepted. */
export function assertBackend(backend: string): void {
  if (!BACKENDS.includes(backend)) throw new Error(`bad backend ${backend}`);
}

/** Repo root (vitest runs with cwd = repo root). */
const repoRoot = () => resolve(process.cwd());

const csgCompareGolden: BrowserCommand<[CompareGoldenPayload]> = (
  _ctx,
  p,
): CompareResult => {
  assertBackend(p.backend);
  assertGoldenDir(p.goldenDir);
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
  assertGoldenDir(goldenDir);
  assertBackend(backend);
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
