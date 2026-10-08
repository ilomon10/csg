/**
 * Node side of the golden comparison (REQ-PIX-028). Pure file and pixel logic; the Vitest browser
 * commands in `golden-commands.ts` are thin wrappers, and `golden-node.test.ts` unit-tests it.
 *
 * Modes (environment variables, read per call so tests can inject them):
 * - `CSG_GOLDEN_ENV=canonical` is set only inside the pinned container (`scripts/golden-env`).
 *   Without it a comparison never fails and never writes (AC-PIX-028.3): it reports the count.
 * - `CSG_GOLDEN_UPDATE=1` requests a golden update (`pnpm goldens:update`). Outside the canonical
 *   environment it fails with instructions and writes nothing (AC-PIX-028.4); inside it also needs
 *   `CSG_GOLDEN_REASON`, and only cases that differ are rewritten.
 * - On any mismatch the expected/actual/diff PNGs go to `test-results/goldens/<backend>/<name>/`
 *   (AC-PIX-028.5).
 *
 * @module
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {decodePng, encodePng} from './png.ts';

/** Backends with goldens. */
export type GoldenBackend = 'webgpu' | 'webgl2';

/** Environment variables that control the golden modes. */
export interface GoldenEnv {
  CSG_GOLDEN_ENV?: string;
  CSG_GOLDEN_UPDATE?: string;
  CSG_GOLDEN_REASON?: string;
  CSG_GOLDEN_IMAGE?: string;
  CSG_GOLDEN_ALLOW_ENV_CHANGE?: string;
}

/** Facts about the running environment, recorded in `environment.json`. */
export interface EnvironmentRecord {
  /** Container image reference (`CSG_GOLDEN_IMAGE`) or null outside the container. */
  image: string | null;
  /** `navigator.userAgent` of the browser. */
  userAgent: string;
  /** three.js version. */
  three: string;
  /** Adapter info (WebGPU `adapter.info`, or WebGL2 renderer strings). */
  adapter: Record<string, unknown>;
}

/** Per-test tolerance override; the reason is mandatory (REQ-PIX-028). */
export interface GoldenOverride {
  /** Maximum number of differing pixels that still passes. */
  maxDiffPixels: number;
  /** Why this case cannot be exact. */
  reason: string;
}

/** Request for one comparison. */
export interface CompareRequest {
  backend: GoldenBackend;
  /** Case name: lowercase letters, digits and `-` only. */
  name: string;
  /** Tightly packed RGBA8, top-left origin. */
  rgba: Uint8Array;
  width: number;
  height: number;
  override?: GoldenOverride;
  environment: EnvironmentRecord;
  /** Golden root (default `packages/engine/test/goldens`). */
  goldenRoot: string;
  /** Artifact root (default `test-results/goldens`). */
  artifactRoot: string;
}

/** Outcome of one comparison. */
export interface CompareResult {
  status: 'match' | 'mismatch' | 'missing' | 'updated' | 'reported';
  /** Differing pixels (any channel), or -1 when no golden exists / size differs. */
  diffPixels: number;
  /** Failure or report text; empty on match/updated. */
  message: string;
  /** True when the test must fail. */
  fail: boolean;
  goldenPath: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True when the process is the canonical golden environment. */
export function isCanonical(env: GoldenEnv): boolean {
  return env.CSG_GOLDEN_ENV === 'canonical';
}

/** Counts differing pixels and builds the diff image (red = differs, dim copy of expected = same). */
export function diffImages(
  expected: Uint8Array,
  actual: Uint8Array,
  width: number,
  height: number,
): {count: number; diff: Uint8Array} {
  const diff = new Uint8Array(width * height * 4);
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const same =
      expected[o] === actual[o] &&
      expected[o + 1] === actual[o + 1] &&
      expected[o + 2] === actual[o + 2] &&
      expected[o + 3] === actual[o + 3];
    if (same) {
      diff[o] = (expected[o] ?? 0) >> 2;
      diff[o + 1] = (expected[o + 1] ?? 0) >> 2;
      diff[o + 2] = (expected[o + 2] ?? 0) >> 2;
      diff[o + 3] = 255;
    } else {
      count++;
      diff[o] = 255;
      diff[o + 3] = 255;
    }
  }
  return {count, diff};
}

/** Writes a file atomically (temp name + rename). */
function writeFileAtomic(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(path), {recursive: true});
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

/** Merges this backend's environment into `environment.json` and returns the mismatching field if any. */
function environmentMismatch(
  file: string,
  backend: GoldenBackend,
  env: EnvironmentRecord,
): string | null {
  if (!existsSync(file)) return null;
  const known = JSON.parse(readFileSync(file, 'utf8')) as {
    image?: string | null;
    three?: string;
    backends?: Record<string, {userAgent?: string}>;
  };
  if (known.image !== undefined && known.image !== env.image) {
    return `image (recorded ${String(known.image)}, current ${String(env.image)})`;
  }
  if (known.three !== undefined && known.three !== env.three) {
    return `three (recorded ${known.three}, current ${env.three})`;
  }
  const ua = known.backends?.[backend]?.userAgent;
  if (ua !== undefined && ua !== env.userAgent) {
    return `${backend}.userAgent (recorded ${ua}, current ${env.userAgent})`;
  }
  return null;
}

function writeEnvironment(
  file: string,
  backend: GoldenBackend,
  env: EnvironmentRecord,
): void {
  const known = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as {
        backends?: Record<string, unknown>;
      })
    : {};
  const backends = {...(known.backends ?? {})};
  backends[backend] = {userAgent: env.userAgent, adapter: env.adapter};
  const sorted = Object.fromEntries(
    Object.entries(backends).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeFileAtomic(
    file,
    `${JSON.stringify({image: env.image, three: env.three, backends: sorted}, null, 2)}\n`,
  );
}

/**
 * Compares one image with its golden under the mode rules in the module comment.
 *
 * @param req Request.
 * @param env Environment variables (pass `process.env`).
 * @returns The outcome; `fail` tells the caller to fail the test.
 * @throws Error on invalid input (bad name, size mismatch of the buffer, override without reason).
 */
export function compareGoldenNode(
  req: CompareRequest,
  env: GoldenEnv,
): CompareResult {
  if (!NAME_RE.test(req.name)) {
    throw new Error(`golden name "${req.name}" must match ${NAME_RE}`);
  }
  if (req.rgba.length !== req.width * req.height * 4) {
    throw new Error(
      `golden "${req.name}": ${req.rgba.length} bytes is not ${req.width}x${req.height} RGBA`,
    );
  }
  const maxDiff = req.override?.maxDiffPixels ?? 0;
  if (req.override !== undefined) {
    if (req.override.reason.trim() === '') {
      throw new Error(
        `golden "${req.name}": a tolerance override needs a non-empty reason`,
      );
    }
    if (!Number.isInteger(maxDiff) || maxDiff < 0) {
      throw new Error(
        `golden "${req.name}": maxDiffPixels must be a non-negative integer`,
      );
    }
  }
  const canonical = isCanonical(env);
  const update = env.CSG_GOLDEN_UPDATE === '1';
  const goldenPath = join(req.goldenRoot, req.backend, `${req.name}.png`);
  const envFile = join(req.goldenRoot, 'environment.json');
  const result = (r: Omit<CompareResult, 'goldenPath'>): CompareResult => ({
    ...r,
    goldenPath,
  });

  if (update && !canonical) {
    return result({
      status: 'reported',
      diffPixels: -1,
      fail: true,
      message:
        `golden update refused: CSG_GOLDEN_ENV is "${env.CSG_GOLDEN_ENV ?? ''}", expected "canonical". ` +
        'Goldens may only be written inside the pinned container: run `pnpm goldens:docker` ' +
        '(or `CSG_GOLDEN_REASON="why" pnpm goldens:update` inside scripts/golden-env). Nothing was written.',
    });
  }

  const expected = existsSync(goldenPath)
    ? decodePng(readFileSync(goldenPath))
    : null;
  let diffPixels = -1;
  let sameSize = false;
  let diffImage: Uint8Array | null = null;
  if (expected !== null) {
    sameSize = expected.width === req.width && expected.height === req.height;
    if (sameSize) {
      const d = diffImages(expected.data, req.rgba, req.width, req.height);
      diffPixels = d.count;
      diffImage = d.diff;
    }
  }
  const passes = expected !== null && sameSize && diffPixels <= maxDiff;

  if (update) {
    if (passes && diffPixels === 0) {
      return result({status: 'match', diffPixels: 0, message: '', fail: false});
    }
    const reason = (env.CSG_GOLDEN_REASON ?? '').trim();
    if (reason === '') {
      return result({
        status: 'reported',
        diffPixels,
        fail: true,
        message: `golden update for "${req.backend}/${req.name}" needs a stated reason: set CSG_GOLDEN_REASON="why the pixels change". Nothing was written.`,
      });
    }
    const mismatch = environmentMismatch(envFile, req.backend, req.environment);
    if (mismatch !== null && env.CSG_GOLDEN_ALLOW_ENV_CHANGE !== '1') {
      return result({
        status: 'reported',
        diffPixels,
        fail: true,
        message:
          `golden update refused: environment.json field ${mismatch} does not match. ` +
          'If the image or three was bumped on purpose, rerun with CSG_GOLDEN_ALLOW_ENV_CHANGE=1.',
      });
    }
    writeFileAtomic(goldenPath, encodePng(req.rgba, req.width, req.height));
    writeEnvironment(envFile, req.backend, req.environment);
    return result({
      status: 'updated',
      diffPixels,
      fail: false,
      message: `updated ${goldenPath} (${diffPixels < 0 ? 'new' : `${diffPixels} px changed`}); reason: ${reason}`,
    });
  }

  if (passes) {
    return result({
      status: 'match',
      diffPixels,
      message: '',
      fail: false,
    });
  }

  // Failure path: artifacts first (AC-PIX-028.5), then fail only in the canonical environment.
  const dir = join(req.artifactRoot, req.backend, req.name);
  writeFileAtomic(
    join(dir, 'actual.png'),
    encodePng(req.rgba, req.width, req.height),
  );
  if (expected !== null) {
    writeFileAtomic(join(dir, 'expected.png'), readFileSync(goldenPath));
  }
  if (diffImage !== null) {
    writeFileAtomic(
      join(dir, 'diff.png'),
      encodePng(diffImage, req.width, req.height),
    );
  }
  const what =
    expected === null
      ? 'no golden exists (generate with `pnpm goldens:docker`)'
      : !sameSize
        ? `size ${req.width}x${req.height} differs from golden ${expected.width}x${expected.height}`
        : `${diffPixels} pixel(s) differ (allowed ${maxDiff})`;
  const message = `golden ${req.backend}/${req.name}: ${what}; artifacts in ${resolve(dir)}`;
  if (canonical) {
    return result({
      status: expected === null ? 'missing' : 'mismatch',
      diffPixels,
      fail: true,
      message,
    });
  }
  return result({
    status: 'reported',
    diffPixels,
    fail: false,
    message: `${message} (not canonical: reported only, AC-PIX-028.3)`,
  });
}
