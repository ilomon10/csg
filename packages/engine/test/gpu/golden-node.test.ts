/** Node unit tests of the golden compare/update guard (REQ-PIX-028, AC-PIX-028.3 to .5). */
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {compareGoldenNode} from './golden-node.ts';
import type {CompareRequest, GoldenEnv} from './golden-node.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'csg-golden-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

const W = 4;
const H = 3;
const img = (fill: number) => new Uint8Array(W * H * 4).fill(fill);
const environment = {
  image: 'img@sha256:aa',
  userAgent: 'UA',
  three: '186',
  adapter: {architecture: 'swiftshader'},
};
const req = (rgba: Uint8Array, over: Partial<CompareRequest> = {}) => ({
  backend: 'webgpu' as const,
  name: 'case-a',
  rgba,
  width: W,
  height: H,
  environment,
  goldenRoot: join(root, 'goldens'),
  artifactRoot: join(root, 'artifacts'),
  ...over,
});
const CANON: GoldenEnv = {CSG_GOLDEN_ENV: 'canonical'};
const UPDATE: GoldenEnv = {
  CSG_GOLDEN_ENV: 'canonical',
  CSG_GOLDEN_UPDATE: '1',
  CSG_GOLDEN_REASON: 'new look',
};

describe('REQ-PIX-028 golden harness (Node)', () => {
  it('AC-PIX-028.4: update outside the canonical environment writes nothing and fails with instructions', () => {
    const r = compareGoldenNode(req(img(9)), {CSG_GOLDEN_UPDATE: '1'});
    expect(r.fail).toBe(true);
    expect(r.message).toMatch(/CSG_GOLDEN_ENV/);
    expect(r.message).toMatch(/goldens:docker/);
    expect(existsSync(r.goldenPath)).toBe(false);
  });

  it('AC-PIX-028.4: an update needs a reason and a matching environment.json', () => {
    const noReason = compareGoldenNode(req(img(9)), {
      CSG_GOLDEN_ENV: 'canonical',
      CSG_GOLDEN_UPDATE: '1',
    });
    expect(noReason.fail).toBe(true);
    expect(noReason.message).toMatch(/reason/);
    expect(compareGoldenNode(req(img(9)), UPDATE).status).toBe('updated');
    const other = compareGoldenNode(
      req(img(10), {environment: {...environment, image: 'other@sha256:bb'}}),
      UPDATE,
    );
    expect(other.fail).toBe(true);
    expect(other.message).toMatch(/image/);
    const allowed = compareGoldenNode(
      req(img(10), {environment: {...environment, image: 'other@sha256:bb'}}),
      {...UPDATE, CSG_GOLDEN_ALLOW_ENV_CHANGE: '1'},
    );
    expect(allowed.status).toBe('updated');
  });

  it('AC-PIX-028.4: only differing cases are rewritten; environment.json is recorded', () => {
    expect(compareGoldenNode(req(img(9)), UPDATE).status).toBe('updated');
    const env = JSON.parse(
      readFileSync(join(root, 'goldens', 'environment.json'), 'utf8'),
    );
    expect(env.image).toBe(environment.image);
    expect(env.backends.webgpu.adapter.architecture).toBe('swiftshader');
    expect(compareGoldenNode(req(img(9)), UPDATE).status).toBe('match');
    expect(compareGoldenNode(req(img(9)), CANON).status).toBe('match');
  });

  it('AC-PIX-028.1, AC-PIX-028.5: canonical mismatch fails and writes actual, expected and diff images', () => {
    compareGoldenNode(req(img(9)), UPDATE);
    const bent = img(9);
    bent[0] = 0;
    const r = compareGoldenNode(req(bent), CANON);
    expect(r.fail).toBe(true);
    expect(r.status).toBe('mismatch');
    expect(r.diffPixels).toBe(1);
    for (const f of ['actual', 'expected', 'diff']) {
      expect(
        existsSync(join(root, 'artifacts', 'webgpu', 'case-a', `${f}.png`)),
      ).toBe(true);
    }
  });

  it('AC-PIX-028.3: outside the canonical environment a mismatch is reported, not failed, with artifacts', () => {
    compareGoldenNode(req(img(9)), UPDATE);
    const r = compareGoldenNode(req(img(8)), {});
    expect(r.fail).toBe(false);
    expect(r.status).toBe('reported');
    expect(r.diffPixels).toBe(W * H);
    expect(
      existsSync(join(root, 'artifacts', 'webgpu', 'case-a', 'diff.png')),
    ).toBe(true);
  });

  it('REQ-PIX-028: a missing golden fails in the canonical environment; tolerance is 0 unless overridden with a reason', () => {
    expect(compareGoldenNode(req(img(9)), CANON)).toMatchObject({
      fail: true,
      status: 'missing',
    });
    compareGoldenNode(req(img(9)), UPDATE);
    const bent = img(9);
    bent[0] = 0;
    expect(compareGoldenNode(req(bent), CANON).fail).toBe(true);
    const override = {maxDiffPixels: 1, reason: 'float rounding'};
    expect(compareGoldenNode(req(bent, {override}), CANON).status).toBe(
      'match',
    );
    expect(() =>
      compareGoldenNode(
        req(bent, {override: {maxDiffPixels: 1, reason: ''}}),
        CANON,
      ),
    ).toThrow(/reason/);
  });

  it('rejects bad names and buffers of the wrong size', () => {
    expect(() => compareGoldenNode(req(img(1), {name: '../x'}), CANON)).toThrow(
      /name/,
    );
    expect(() => compareGoldenNode(req(new Uint8Array(3)), CANON)).toThrow(
      /bytes/,
    );
  });

  it('a size change against the golden fails canonical runs', () => {
    compareGoldenNode(req(img(9)), UPDATE);
    const r = compareGoldenNode(
      req(new Uint8Array(2 * 2 * 4), {width: 2, height: 2}),
      CANON,
    );
    expect(r.fail).toBe(true);
    expect(r.message).toMatch(/size/);
  });
});
