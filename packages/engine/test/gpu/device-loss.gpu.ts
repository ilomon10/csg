/**
 * Device loss on a real WebGL2 context (spec 003 REQ-PIX-036, spec 009 REQ-UX-046 engine part):
 * `WEBGL_lose_context.loseContext()` makes the renderer report `PIX_DEVICE_LOST` once through
 * `onError`, after which drawing is a no-op and `dispose()` is safe; a normal `dispose()`
 * (which itself calls `loseContext()` in three's WebGL backend) reports nothing.
 *
 * Both GPU projects run it with `forceWebGL`: a WebGPU device loss cannot be forced in
 * SwiftShader, so the WebGPU path (`GPUDevice.lost`) is covered by the unit tests in
 * `src/renderer/device-loss.test.ts`. No golden files are written or read here.
 */
import {
  V1_SLOT_IDS,
  characterSpecSchema,
  clipManifestSchema,
  defaultRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {AssemblyRegistry} from '../../src/composition/character-assembly';
import type {EngineError} from '../../src/contracts/errors';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {createCharacterRenderer} from '../../src/renderer/character-renderer';
import type {EngineCharacterRenderer} from '../../src/renderer/character-renderer';
import {PIX_DEVICE_LOST} from '../../src/renderer/device-loss';

const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SPEC_URL = `${FIXTURES}character.valid.json`;
const SLOT_REGISTRY = {
  format: 'sprite-slot-registry' as const,
  version: 1 as const,
  slots: V1_SLOT_IDS.map((id, order) => ({
    id,
    order,
    label: id,
    kinds: ['skinned' as const, 'static' as const],
    required: id === 'body',
    randomize: {emptyChance: 0},
  })),
};

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fixtureRegistry(): Promise<AssemblyRegistry> {
  const inner = createAssetRegistry();
  inner.registerPack(
    partManifestSchema.parse(await json(`${PACK}manifest.json`)),
    PACK,
  );
  inner.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  return inner as unknown as AssemblyRegistry;
}

let live: EngineCharacterRenderer | undefined;

async function createRenderer(): Promise<{
  renderer: EngineCharacterRenderer;
  canvas: HTMLCanvasElement;
  errors: EngineError[];
}> {
  const canvas = document.createElement('canvas');
  const errors: EngineError[] = [];
  const created = await createCharacterRenderer(canvas, {
    registry: await fixtureRegistry(),
    slots: SLOT_REGISTRY,
    forceWebGL: true,
    settings: defaultRenderSettings('side'),
    onError: e => errors.push(e),
  });
  if (!created.ok) throw new Error(created.error.message);
  live = created.value;
  expect(live.backend).toBe('webgl2');
  const set = await live.setCharacter(
    characterSpecSchema.parse(await json(SPEC_URL)),
  );
  if (!set.ok) throw new Error(set.error.message);
  return {renderer: live, canvas, errors};
}

/** Lets queued tasks (context-loss events) run. */
const settle = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 50));

afterEach(() => {
  live?.dispose();
  live = undefined;
});

describe('device loss on WebGL2 (REQ-PIX-036, REQ-UX-046)', () => {
  it('AC-UX-046.1 (engine part): WEBGL_lose_context reports PIX_DEVICE_LOST once; draw and dispose stay safe', async () => {
    const {renderer, canvas, errors} = await createRenderer();
    renderer.draw();
    expect(errors).toEqual([]);

    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    expect(ext).toBeTruthy();
    ext?.loseContext();

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.code).toBe(PIX_DEVICE_LOST);
    expect(errors[0]?.details).toMatchObject({backend: 'webgl2'});

    expect(() => renderer.draw()).not.toThrow();
    expect(renderer.resume()).toBe(false);
    await settle();
    expect(errors).toHaveLength(1);

    expect(() => renderer.dispose()).not.toThrow();
    live = undefined;
    await settle();
    expect(errors).toHaveLength(1);
  });

  it('REQ-UX-046: a normal dispose (three calls loseContext) reports nothing', async () => {
    const {renderer, errors} = await createRenderer();
    renderer.draw();
    renderer.dispose();
    live = undefined;
    await settle();
    expect(errors).toEqual([]);
  });
});
