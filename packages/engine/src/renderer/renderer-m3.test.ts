/**
 * M3-05 renderer behaviour on fakes (Node has no GPU): `CMP_STYLE_UNSUPPORTED` notices
 * (REQ-CMP-043), the export block (REQ-CMP-044) and the 3D view mode (REQ-UX-003, engine part).
 * Pixels on both backends are checked by `test/gpu/m3-renderer.gpu.ts`.
 */
import {describe, expect, it} from 'vitest';
import {RenderTarget} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {CharacterSpec, RenderSettings} from '@csg/parts-schema';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
  testStyle,
} from '../composition/assembly-test-env';
import type {EngineNotice} from '../contracts/renderer';
import type {Framing} from '../contracts/pipeline';
import {FrameSamplerError} from '../sampler/frame-sampler';
import {diffRenderSettings} from '../pipeline/settings-binder';
import type {RendererParameters} from './backend';
import {
  CMP_STYLE_UNSUPPORTED,
  createCharacterRenderer,
} from './character-renderer';
import type {
  PreviewRenderer,
  RendererOrbitView,
  RendererPipeline,
} from './character-renderer';
import {
  DEFAULT_ORBIT_STATE,
  ORBIT_PITCH_LIMIT_DEG,
  frameBox,
  orbitBy,
  orbitEye,
} from './orbit-camera';
import type {OrbitState} from './orbit-camera';
import {previewLayout} from './preview-layout';

class FakeRenderer implements PreviewRenderer {
  readonly backend = {isWebGLBackend: true};
  loop: ((timeMs: number) => void) | null = null;
  readonly sizes: string[] = [];
  constructor(readonly parameters: RendererParameters) {}
  async init(): Promise<this> {
    return this;
  }
  setPixelRatio(): void {}
  setSize(width: number, height: number): void {
    this.sizes.push(`${width}x${height}`);
  }
  setAnimationLoop(callback: ((timeMs: number) => void) | null): void {
    this.loop = callback;
  }
  dispose(): void {}
}

class FakePipeline implements RendererPipeline {
  readonly cellTarget = new RenderTarget(1, 1);
  frames = 0;
  private current: RenderSettings | undefined;
  constructor(
    private readonly renderer: PreviewRenderer,
    private readonly events: string[],
  ) {}
  get stats() {
    return {rebuilds: 0, frames: this.frames};
  }
  async setRenderSettings(settings: RenderSettings) {
    const diff = diffRenderSettings(this.current, settings);
    if (this.current === undefined || diff.resize) {
      this.renderer.setSize(
        settings.resolution.width,
        settings.resolution.height,
        false,
      );
      this.cellTarget.setSize(
        settings.resolution.width,
        settings.resolution.height,
      );
    }
    this.current = settings;
    return diff;
  }
  setFraming(_framing: Framing): void {}
  render(): void {
    this.frames++;
    this.events.push('pixel-render');
  }
  async read(): Promise<Uint8ClampedArray> {
    const {width, height} = this.cellTarget;
    return new Uint8ClampedArray(width * height * 4);
  }
  dispose(): void {}
}

/** Records the 3D draws (state and drawing-buffer size). */
class FakeOrbitView implements RendererOrbitView {
  readonly draws: Array<{state: OrbitState; w: number; h: number; t: number}> =
    [];
  disposed = false;
  constructor(private readonly events: string[]) {}
  render(state: OrbitState, w: number, h: number, t: number): void {
    this.draws.push({state, w, h, t});
    this.events.push('3d-render');
  }
  dispose(): void {
    this.disposed = true;
  }
}

const CANVAS = {width: 64, height: 64} as unknown as OffscreenCanvas;

async function create(
  options: {
    styles?: boolean;
    settings?: RenderSettings;
  } = {},
) {
  const events: string[] = [];
  const notices: Array<{notice: EngineNotice; active: boolean}> = [];
  const registry = createTestRegistry(
    options.styles === false
      ? {}
      : {styles: [testStyle('realistic'), testStyle('chibi')]},
  );
  const fakes: FakeRenderer[] = [];
  const orbitViews: FakeOrbitView[] = [];
  const result = await createCharacterRenderer(CANVAS, {
    registry,
    factory: (p: RendererParameters) => {
      const r = new FakeRenderer(p);
      fakes.push(r);
      return r;
    },
    pipelineFactory: args => ({
      ok: true,
      value: new FakePipeline(args.renderer, events),
    }),
    presenterFactory: () => ({
      present: () => events.push('present'),
      dispose: () => {},
    }),
    orbitViewFactory: () => {
      const v = new FakeOrbitView(events);
      orbitViews.push(v);
      return v;
    },
    settings: options.settings ?? defaultRenderSettings('side'),
    onNotice: (notice, active) => {
      notices.push({notice, active});
      events.push(`notice:${active ? 'on' : 'off'}`);
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  return {renderer: result.value, events, notices, orbitViews, fakes};
}

function spec(over: Partial<CharacterSpec> = {}): CharacterSpec {
  return {...fixtureSpec(), ...over};
}

describe('REQ-CMP-043: CMP_STYLE_UNSUPPORTED is a notice, never an error', () => {
  it('AC-CMP-043.1: a stickman spec loads, keeps its style, renders realistic and raises the notice text', async () => {
    const {renderer, notices} = await create();
    const result = await renderer.setCharacter(spec({style: 'stickman'}));
    expect(result).toEqual({ok: true, value: undefined});
    expect(renderer.assembly.spec?.style).toBe('stickman');
    expect(renderer.renderPair).toEqual({
      style: 'realistic',
      species: 'human',
      fallback: true,
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.active).toBe(true);
    expect(notices[0]?.notice).toMatchObject({
      code: CMP_STYLE_UNSUPPORTED,
      message: 'Stickman is coming soon. Showing Realistic for now.',
      style: 'stickman',
      species: 'human',
      fallback: {style: 'realistic', species: 'human'},
    });
    expect(renderer.notices.map(n => n.code)).toEqual([CMP_STYLE_UNSUPPORTED]);
    renderer.dispose();
  });

  it('AC-CMP-043.2: chibi/monster renders chibi/human and the notice names Monster', async () => {
    const {renderer, notices} = await create();
    await renderer.setCharacter(spec({style: 'chibi', species: 'monster'}));
    expect(renderer.renderPair).toMatchObject({
      style: 'chibi',
      species: 'human',
    });
    expect(notices[0]?.notice.message).toBe(
      'Monster is coming soon. Showing Human for now.',
    );
    renderer.dispose();
  });

  it('AC-CMP-043.3: selecting a supported pair clears the notice before the next rendered frame', async () => {
    const {renderer, notices, events} = await create();
    await renderer.setCharacter(spec({style: 'voxel'}));
    expect(renderer.notices).toHaveLength(1);
    const from = events.length;
    await renderer.setCharacter(spec({style: 'chibi'}));
    expect(renderer.notices).toEqual([]);
    expect(notices.at(-1)?.active).toBe(false);
    const after = events.slice(from);
    const off = after.indexOf('notice:off');
    const firstDraw = after.findIndex(
      e => e === 'present' || e === 'pixel-render',
    );
    expect(off).toBeGreaterThanOrEqual(0);
    expect(firstDraw).toBeGreaterThan(off);
    renderer.dispose();
  });

  it('REQ-CMP-043: an unchanged fallback is not re-raised; a different fallback replaces the notice', async () => {
    const {renderer, notices} = await create();
    await renderer.setCharacter(spec({style: 'voxel'}));
    await renderer.setCharacter(spec({style: 'voxel', name: 'Renamed'}));
    expect(notices).toHaveLength(1);
    await renderer.setCharacter(spec({style: 'stickman'}));
    expect(notices.map(n => [n.active, n.notice.label])).toEqual([
      [true, 'Voxel'],
      [false, 'Voxel'],
      [true, 'Stickman'],
    ]);
    renderer.dispose();
  });
});

describe('REQ-CMP-044: export is blocked while the stored pair is unsupported', () => {
  it('AC-CMP-044.1 (engine): prepareFrames returns CMP_STYLE_UNSUPPORTED for voxel and renders nothing', async () => {
    const {renderer, events} = await create();
    await renderer.setCharacter(spec({style: 'voxel'}));
    const before = events.filter(e => e === 'pixel-render').length;
    const prepared = await renderer.prepareFrames();
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.error.code).toBe(CMP_STYLE_UNSUPPORTED);
      expect(prepared.error.message).toBe(
        'Voxel is coming soon. Choose a supported style to export.',
      );
    }
    // Only the preview redraw after the exclusive call; no export frame.
    expect(
      events.filter(e => e === 'pixel-render').length - before,
    ).toBeLessThanOrEqual(1);
    renderer.dispose();
  });

  it('AC-CMP-044.1 (engine): frames prepared before a switch to an unsupported style are refused with no frame produced', async () => {
    const {renderer} = await create();
    await renderer.setCharacter(spec());
    const prepared = await renderer.prepareFrames();
    if (!prepared.ok) throw new Error(prepared.error.message);
    await renderer.setCharacter(spec({style: 'voxel'}));
    const frames: unknown[] = [];
    let error: unknown;
    try {
      for await (const f of renderer.renderFrames(prepared.value)) {
        frames.push(f);
      }
    } catch (e) {
      error = e;
    }
    expect(frames).toEqual([]);
    expect(error).toBeInstanceOf(FrameSamplerError);
    expect((error as FrameSamplerError).code).toBe(CMP_STYLE_UNSUPPORTED);
    expect(renderer.busy).toBe(false);
    renderer.dispose();
  });

  it('REQ-CMP-044: a supported pair exports', async () => {
    const {renderer} = await create();
    await renderer.setCharacter(spec({style: 'chibi'}));
    expect((await renderer.prepareFrames()).ok).toBe(true);
    renderer.dispose();
  });
});

describe('REQ-UX-003 (engine part): 3D view mode', () => {
  it('AC-UX-003.1 (engine part): pixel mode keeps the 64x64 cell as the drawing buffer at zoom 6; 3D draws at viewport device pixels; back to pixel draws the cell again', async () => {
    const {renderer, events, orbitViews} = await create({
      settings: {
        ...defaultRenderSettings('side'),
        resolution: {width: 64, height: 64},
      },
    });
    await renderer.setCharacter(spec());
    expect(renderer.viewMode).toBe('pixel');
    expect(renderer.resize(384, 384, 1)).toEqual(
      previewLayout(64, 64, 384, 384, 1),
    );
    expect(renderer.layout).toMatchObject({cellW: 64, cellH: 64, cssW: 384});
    renderer.resize(300, 200, 2);
    const from = events.length;
    renderer.setViewMode('3d');
    expect(renderer.viewMode).toBe('3d');
    expect(orbitViews).toHaveLength(1);
    const draw = orbitViews[0]?.draws.at(-1);
    expect(draw).toMatchObject({w: 600, h: 400});
    expect(events.slice(from)).toEqual(['3d-render']);
    renderer.setViewMode('pixel');
    expect(events.at(-1)).toBe('present');
    expect(renderer.cellTarget.width).toBe(64);
    renderer.dispose();
    expect(orbitViews[0]?.disposed).toBe(true);
  });

  it('REQ-UX-003: the first 3D draw frames the character; orbit turns yaw and clamps pitch; frameCharacter keeps the angles', async () => {
    const {renderer, orbitViews} = await create();
    await renderer.setCharacter(spec());
    renderer.resize(200, 200, 1);
    renderer.setViewMode('3d');
    const framed = renderer.orbitState;
    expect(framed.yawDeg).toBe(DEFAULT_ORBIT_STATE.yawDeg);
    expect(framed.target).not.toEqual(DEFAULT_ORBIT_STATE.target);
    expect(framed.distance).toBeGreaterThan(0);
    renderer.orbit(-30, 200);
    expect(renderer.orbitState.yawDeg).toBe(330);
    expect(renderer.orbitState.pitchDeg).toBe(ORBIT_PITCH_LIMIT_DEG);
    expect(orbitViews[0]?.draws.at(-1)?.state).toBe(renderer.orbitState);
    renderer.frameCharacter();
    expect(renderer.orbitState.yawDeg).toBe(330);
    expect(renderer.orbitState.target).toEqual(framed.target);
    expect(renderer.orbitState.distance).toBeCloseTo(framed.distance, 12);
    renderer.dispose();
  });

  it('REQ-UX-003: the 3D view is deterministic: the same spec, size and orbit give the same camera state', async () => {
    const states: OrbitState[] = [];
    for (let run = 0; run < 2; run++) {
      const {renderer} = await create();
      await renderer.setCharacter(spec());
      renderer.resize(320, 240, 1.5);
      renderer.setViewMode('3d');
      renderer.orbit(45, -20);
      renderer.frameCharacter();
      states.push(renderer.orbitState);
      renderer.dispose();
    }
    expect(states[1]).toEqual(states[0]);
  });

  it('REQ-UX-003: export is unaffected by 3D mode (pixel frames), and the 3D view resumes after', async () => {
    const {renderer, events} = await create({
      settings: {
        ...defaultRenderSettings('side'),
        resolution: {width: 32, height: 32},
        animations: [
          {
            clipId: ref('fixture-clip'),
            label: 'walk',
            frameCount: 2,
            fps: 4,
            loop: true,
          },
        ],
      },
    });
    await renderer.setCharacter(spec());
    renderer.resize(100, 100, 1);
    renderer.setViewMode('3d');
    const prepared = await renderer.prepareFrames();
    if (!prepared.ok) throw new Error(prepared.error.message);
    const from = events.length;
    let n = 0;
    for await (const frame of renderer.renderFrames(prepared.value)) {
      expect(frame.width).toBe(32);
      n++;
    }
    expect(n).toBeGreaterThan(0);
    const after = events.slice(from);
    expect(after.filter(e => e === 'pixel-render')).toHaveLength(n);
    expect(after.at(-1)).toBe('3d-render');
    renderer.dispose();
  });

  it('REQ-UX-003: setViewMode rejects unknown modes (programmer error)', async () => {
    const {renderer} = await create();
    expect(() => renderer.setViewMode('iso' as never)).toThrow(/unknown mode/);
    renderer.dispose();
  });
});

describe('REQ-UX-003: orbit camera math', () => {
  it('orbitBy wraps yaw into [0, 360) and clamps pitch to ±85°', () => {
    expect(orbitBy(DEFAULT_ORBIT_STATE, -10, 0).yawDeg).toBe(350);
    expect(orbitBy(DEFAULT_ORBIT_STATE, 720, 0).yawDeg).toBe(0);
    expect(orbitBy(DEFAULT_ORBIT_STATE, 0, -1000).pitchDeg).toBe(
      -ORBIT_PITCH_LIMIT_DEG,
    );
    expect(orbitBy(DEFAULT_ORBIT_STATE, Number.NaN, Infinity)).toEqual(
      DEFAULT_ORBIT_STATE,
    );
  });

  it('orbitEye puts yaw 0 / pitch 0 on +Z, the side the pixel camera looks from', () => {
    const eye = orbitEye({
      yawDeg: 0,
      pitchDeg: 0,
      target: [1, 2, 3],
      distance: 5,
    });
    expect(eye[0]).toBeCloseTo(1, 12);
    expect(eye[1]).toBeCloseTo(2, 12);
    expect(eye[2]).toBeCloseTo(8, 12);
  });

  it('frameBox centres the box and fits its bounding sphere in the narrower field of view', () => {
    const tall = frameBox(
      DEFAULT_ORBIT_STATE,
      [-0.5, 0, -0.5],
      [0.5, 2, 0.5],
      1,
    );
    expect(tall.target).toEqual([0, 1, 0]);
    const radius = Math.sqrt(1 + 4 + 1) / 2;
    const half = (15 * Math.PI) / 180;
    expect(tall.distance).toBeCloseTo((radius / Math.sin(half)) * 1.1, 9);
    const narrow = frameBox(
      DEFAULT_ORBIT_STATE,
      [-0.5, 0, -0.5],
      [0.5, 2, 0.5],
      0.5,
    );
    expect(narrow.distance).toBeGreaterThan(tall.distance);
    // Degenerate boxes keep the state.
    expect(frameBox(DEFAULT_ORBIT_STATE, [0, 0, 0], [0, 0, 0], 1)).toBe(
      DEFAULT_ORBIT_STATE,
    );
  });
});
