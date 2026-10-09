import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  Bone,
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type {Object3D} from 'three';
import {parseRenderSettings} from '@csg/parts-schema';
import type {ClipRef, RenderSettings} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import type {EngineError, Result} from '../contracts/errors';
import type {Framing, RenderedFrame} from '../contracts/pipeline';
import {stageYawRad} from '../pipeline/directions';
import {
  EXP_CANCELLED,
  FrameSamplerError,
  createPipelineFrameTarget,
  mirrorFrame,
  prepareFrames,
  renderFrames,
} from './frame-sampler';
import type {
  FrameLogEntry,
  FrameSamplerTarget,
  PosableCharacter,
  PreparedFrames,
} from './frame-sampler';
import {activeDirectionLabels} from './frame-plan';

const WALK: ClipRef = 'builtin:fixture-pack/walk';
const ATTACK: ClipRef = 'builtin:fixture-pack/attack';
const DURATIONS: Record<string, number> = {[WALK]: 1, [ATTACK]: 0.5};

function settings(input: Record<string, unknown>): RenderSettings {
  const result = parseRenderSettings({
    resolution: {width: 32, height: 32},
    ...input,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const walk = {clipId: WALK, label: 'walk', frameCount: 8, fps: 8, loop: true};
const attack = {
  clipId: ATTACK,
  label: 'attack',
  frameCount: 4,
  fps: 12,
  loop: false,
};

/** A box of half-width 0.25 and height `h` standing on the pivot, packed as 8 corners. */
function boxCorners(h: number): Float32Array {
  const out: number[] = [];
  for (let c = 0; c < 8; c++)
    out.push(c & 1 ? 0.25 : -0.25, c & 2 ? h : 0, c & 4 ? 0.1 : -0.1);
  return Float32Array.from(out);
}

/**
 * A Node fake of the pipeline target. `read()` returns a frame whose pixels
 * encode (time, direction): an asymmetric marker so mirroring is visible.
 */
class FakeTarget implements FrameSamplerTarget {
  readonly calls: string[] = [];
  renders = 0;
  framings: Framing[] = [];
  readDelayMs = 0;
  /** Height of the posed box per sample time. */
  height = (t: number) => 1 + t;
  private clip: ClipRef | undefined;
  private time = 0;
  private direction = 0;
  private w = 32;
  private h = 32;
  restored = 0;

  configure(s: RenderSettings): void {
    this.w = s.resolution.width;
    this.h = s.resolution.height;
    this.calls.push('configure');
  }
  async setClip(ref: ClipRef): Promise<Result<void, EngineError>> {
    this.calls.push(`setClip:${ref}`);
    if (DURATIONS[ref] === undefined)
      return {ok: false, error: {code: 'ANM_CLIP_LOAD_FAILED', message: ref}};
    this.clip = ref;
    return {ok: true, value: undefined};
  }
  clipDurationSec(): number {
    return DURATIONS[this.clip as string] as number;
  }
  setRootReference(t: number): void {
    this.calls.push(`ref:${t}`);
  }
  pose(t: number, direction: number): void {
    this.time = t;
    this.direction = direction;
    this.calls.push(`pose:${t}:${direction}`);
  }
  skinnedCorners(): Float32Array {
    return boxCorners(this.height(this.time));
  }
  setFraming(f: Framing): void {
    this.framings.push(f);
  }
  render(): void {
    this.renders++;
    this.calls.push(`render:${this.time}:${this.direction}`);
  }
  read(): Promise<Uint8ClampedArray> {
    const px = new Uint8ClampedArray(this.w * this.h * 4);
    // Marker: one opaque pixel at column (2 + direction), row frame-ish.
    const x = 2 + this.direction;
    const y = Math.floor(this.time * 10) % this.h;
    const i = (y * this.w + x) * 4;
    px[i] = 10 + this.direction;
    px[i + 1] = Math.floor(this.time * 100);
    px[i + 3] = 255;
    if (this.readDelayMs === 0) return Promise.resolve(px);
    return new Promise(resolve =>
      setTimeout(() => resolve(px), this.readDelayMs),
    );
  }
  rootOffsetPx(): readonly [number, number] | undefined {
    return undefined;
  }
  restore(): void {
    this.restored++;
  }
}

async function prepared(
  target: FakeTarget,
  s: RenderSettings,
): Promise<PreparedFrames> {
  const result = await prepareFrames(target, s);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function collect(
  iterable: AsyncIterable<RenderedFrame>,
): Promise<RenderedFrame[]> {
  const out: RenderedFrame[] = [];
  for await (const f of iterable) out.push(f);
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('prepareFrames', () => {
  it('REQ-PIX-007: poses once per (clip, frame) and unions every direction with its stage yaw', async () => {
    const s = settings({directions: 8, animations: [walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    expect(p.jobs).toHaveLength(64);
    // 8 distinct sample times → 8 poses, not 64.
    expect(target.calls.filter(c => c.startsWith('pose:'))).toHaveLength(8);
    expect(target.renders).toBe(0);
    // The tallest pose (t = 7/8) fits under the top margin (outer 1 px + 1).
    const {times} = computeSampleTimes(walk, 1);
    const tallest = 1 + Math.max(...times);
    const upPx = 32 - s.camera.pivotRowPx;
    expect(p.framing.worldPerPx).toBeGreaterThanOrEqual(
      (tallest * Math.cos((35 * Math.PI) / 180)) / (upPx - 2) - 1e-9,
    );
    expect(p.framing.clipped).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(target.restored).toBe(1);
  });

  it('AC-PIX-009.2: a fixed framing too small for the head reports PIX_FRAMING_CLIPPED with clips and directions, and frames are still produced', async () => {
    const s = settings({
      directions: 4,
      animations: [walk, attack],
      camera: {preset: 'side', framing: 0.01},
    });
    const target = new FakeTarget();
    const p = await prepared(target, s);
    const clipped = p.warnings.find(w => w.code === 'PIX_FRAMING_CLIPPED');
    expect(clipped).toBeDefined();
    const frames = (clipped?.details as {frames: unknown[]}).frames;
    expect(frames).toEqual([
      ...[0, 1, 2, 3].map(direction => ({label: 'attack', direction})),
      ...[0, 1, 2, 3].map(direction => ({label: 'walk', direction})),
    ]);
    expect(clipped?.message).toContain('walk/e');
    const out = await collect(renderFrames(target, p));
    expect(out).toHaveLength(4 * 8 + 4 * 4);
  });

  it('ANM_FIXED_FPS_CLAMPED: computed by the sampler from the plan sample times', async () => {
    const clamped = {...attack, timing: 'fixed-fps', fps: 4, frameCount: 4};
    const s = settings({directions: 2, animations: [clamped]});
    const p = await prepared(new FakeTarget(), s);
    expect(p.warnings).toEqual([
      expect.objectContaining({
        code: 'ANM_FIXED_FPS_CLAMPED',
        details: {label: 'attack', clipId: ATTACK, frames: [2, 3]},
      }),
    ]);
  });

  it('REQ-EXP-024: an aborted signal yields EXP_CANCELLED; a failing clip load is returned', async () => {
    const s = settings({directions: 2, animations: [walk]});
    const controller = new AbortController();
    controller.abort();
    const aborted = await prepareFrames(new FakeTarget(), s, {
      signal: controller.signal,
    });
    expect(aborted).toEqual({
      ok: false,
      error: expect.objectContaining({code: EXP_CANCELLED}),
    });
    const missing = settings({
      directions: 2,
      animations: [{...walk, clipId: 'builtin:fixture-pack/nope'}],
    });
    const failed = await prepareFrames(new FakeTarget(), missing);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('ANM_CLIP_LOAD_FAILED');
  });
});

describe('renderFrames', () => {
  it('AC-ANM-011.1: 8 directions × walk N=8: each direction has 8 frames and frame i uses t_i in every direction (frame log)', async () => {
    const s = settings({directions: 8, animations: [walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    const log: FrameLogEntry[] = [];
    const frames = await collect(renderFrames(target, p, {log}));
    expect(frames).toHaveLength(64);
    const {times} = computeSampleTimes(walk, 1);
    for (let d = 0; d < 8; d++) {
      const entries = log.filter(e => e.direction === d);
      expect(entries.map(e => e.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(entries.map(e => e.timeSec)).toEqual(times);
      expect(entries.every(e => e.source === 'rendered')).toBe(true);
    }
    expect(target.renders).toBe(64);
  });

  it('AC-PIX-007.1, REQ-EXP-001: one framing for the whole export; frames in clip → direction → frame order with label, timing and size', async () => {
    const s = settings({directions: 4, animations: [attack, walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    const progress: number[] = [];
    const frames = await collect(
      renderFrames(target, p, {onProgress: x => progress.push(x.done)}),
    );
    expect(target.framings).toEqual([p.framing]);
    expect(frames.map(f => [f.clipId, f.direction, f.frame])).toEqual(
      p.jobs.map(j => [j.label, j.direction, j.frame]),
    );
    expect(frames[0]).toMatchObject({
      clipId: 'attack',
      direction: 0,
      frame: 0,
      sourceFrame: 0,
      durationMs: 1000 / 12,
      width: 32,
      height: 32,
    });
    expect(frames.every(f => f.pixels.length === 32 * 32 * 4)).toBe(true);
    expect(frames.some(f => 'rootOffsetPx' in f)).toBe(false);
    expect(progress).toEqual(frames.map((_, i) => i + 1));
    // Each (label, clip) is set once, with its frame-0 reference.
    const sets = target.calls.slice(target.calls.lastIndexOf('configure'));
    expect(sets.filter(c => c.startsWith('setClip:'))).toEqual([
      `setClip:${ATTACK}`,
      `setClip:${WALK}`,
    ]);
    expect(target.restored).toBe(2);
  });

  it('AC-PIX-006.1/006.2: with mirrorWest only e/ne/se/n/s are rendered; w/nw/sw are their frames flipped around the pivot line', async () => {
    const s = settings({directions: 8, mirrorWest: true, animations: [walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    expect([...p.mirrored]).toEqual([
      [3, 1],
      [4, 0],
      [5, 7],
    ]);
    const log: FrameLogEntry[] = [];
    const frames = await collect(renderFrames(target, p, {log}));
    expect(frames).toHaveLength(64);
    // 5 rendered directions × 8 frames, each rendered exactly once.
    expect(target.renders).toBe(40);
    const renderedDirections = new Set(
      target.calls
        .filter(c => c.startsWith('render:'))
        .map(c => Number(c.split(':')[2])),
    );
    expect([...renderedDirections].sort()).toEqual([0, 1, 2, 6, 7]);
    const at = (d: number, f: number) =>
      frames.find(x => x.direction === d && x.frame === f) as RenderedFrame;
    for (const [mirror, source] of p.mirrored) {
      for (let f = 0; f < 8; f++) {
        expect(Array.from(at(mirror, f).pixels)).toEqual(
          Array.from(mirrorFrame(at(source, f).pixels, 32, 32, 16)),
        );
      }
    }
    expect(log.filter(e => e.source === 'mirrored')).toHaveLength(24);
    expect(log.find(e => e.direction === 5)?.mirroredFrom).toBe(7);
  });

  it('AC-EXP-024.1: an abort during a slow readback rejects with EXP_CANCELLED within 250 ms and restores the target', async () => {
    vi.useFakeTimers();
    const s = settings({directions: 8, animations: [walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    target.readDelayMs = 5_000;
    const controller = new AbortController();
    const frames: RenderedFrame[] = [];
    let error: unknown;
    let settledAt = -1;
    let now = 0;
    const run = (async () => {
      try {
        for await (const f of renderFrames(target, p, {
          signal: controller.signal,
        })) {
          frames.push(f);
          if (frames.length === 32) {
            setTimeout(() => controller.abort(), 10); // 50 % progress
          }
        }
      } catch (e) {
        error = e;
      } finally {
        settledAt = now;
      }
    })();
    // Let the first 32 frames through (5 s each), then abort at +10 ms.
    for (let i = 0; i < 32; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      now += 5_000;
    }
    const abortAt = now + 10;
    for (let step = 0; step < 30 && settledAt < 0; step++) {
      await vi.advanceTimersByTimeAsync(10);
      now += 10;
    }
    await run;
    expect(frames).toHaveLength(32);
    expect(error).toBeInstanceOf(FrameSamplerError);
    expect((error as FrameSamplerError).code).toBe(EXP_CANCELLED);
    expect(settledAt - abortAt).toBeLessThanOrEqual(250);
    expect(target.restored).toBe(2);
  });

  it('REQ-EXP-024: an already aborted signal yields nothing', async () => {
    const s = settings({directions: 2, animations: [walk]});
    const target = new FakeTarget();
    const p = await prepared(target, s);
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(renderFrames(target, p, {signal: controller.signal})),
    ).rejects.toMatchObject({code: EXP_CANCELLED});
    expect(target.renders).toBe(0);
  });
});

describe('mirrorFrame', () => {
  it('AC-PIX-006.1: reflects columns around the pivot line; outside pixels drop, uncovered are transparent', () => {
    const w = 5;
    const h = 2;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) {
      px[x * 4] = x + 1;
      px[x * 4 + 3] = 255;
    }
    // pivot column 2: x → 3 − x; x = 4 leaves the cell, column 4 is uncovered.
    const out = mirrorFrame(px, w, h, 2);
    expect([0, 1, 2, 3, 4].map(x => out[x * 4])).toEqual([4, 3, 2, 1, 0]);
    expect(out[4 * 4 + 3]).toBe(0);
    expect(Array.from(out.subarray(w * 4))).toEqual(
      new Array<number>(w * 4).fill(0),
    );
  });
});

/** A three-object character: root → `root` joint → prop box. */
function threeCharacter(): {
  character: PosableCharacter & {travelX: number; travelY: number};
  stage: Group;
  joint: Bone;
  prop: Mesh;
} {
  const stage = new Group();
  const root = new Group();
  const joint = new Bone();
  joint.name = 'root';
  const prop = new Mesh(
    new BoxGeometry(0.2, 0.2, 0.2),
    new MeshBasicMaterial(),
  );
  prop.position.set(0.1, 0.5, 0);
  joint.add(prop);
  root.add(joint);
  stage.add(root);
  const character = {
    root,
    body: {
      bones: new Map<string, Object3D>([['root', joint]]),
      rig: {rootBone: 'root'},
    },
    clipDurationSec: 1,
    travelX: 0,
    travelY: 0,
    setClip: () => Promise.resolve({ok: true as const, value: undefined}),
    evaluate(t: number) {
      // Root motion forward (+Z: screen +X when facing e) and a hop in Y.
      joint.position.set(0, character.travelY * t, character.travelX * t);
    },
  };
  return {character, stage, joint, prop};
}

function fakePipeline() {
  return {
    framings: [] as Framing[],
    renders: 0,
    setFraming(f: Framing) {
      this.framings.push(f);
    },
    render() {
      this.renders++;
    },
    read: () => Promise.resolve(new Uint8ClampedArray(32 * 32 * 4)),
  };
}

const FIXED: Framing = {
  worldPerPx: 0.03125,
  elevationDeg: 0,
  frustum: {left: -0.5, right: 0.5, top: 0.9375, bottom: -0.0625},
  pivotPx: [16, 29],
  clipped: [],
};

describe('createPipelineFrameTarget', () => {
  it('AC-PIX-010.2: root motion of 0.37 px per frame shifts the character by whole pixels only; a rigid prop keeps its sub-pixel phase', () => {
    const {character, stage, prop} = threeCharacter();
    const s = settings({camera: {preset: 'side', framing: 0.03125}});
    const wpp = 0.03125;
    character.travelX = 0.37 * wpp; // per second; frame i at t = i
    const target = createPipelineFrameTarget({
      pipeline: fakePipeline(),
      character,
      stage,
    });
    target.configure(s);
    target.setFraming(FIXED);
    target.setRootReference(0);
    const e = activeDirectionLabels(s).indexOf('e');
    const v = new Vector3();
    const phases: number[] = [];
    const shifts: number[] = [];
    for (let i = 0; i < 8; i++) {
      target.pose(i, e);
      stage.updateMatrixWorld(true);
      prop.getWorldPosition(v);
      const xPx = v.x / wpp;
      // Same fractional pixel phase as frame 0 (pixel-identical shape) …
      phases.push(Number((xPx - Math.floor(xPx)).toFixed(9)));
      // … and the shift from frame 0 is a whole number of pixels.
      shifts.push(
        Number((xPx - (0.1 * Math.cos(stageYawRad('e'))) / wpp).toFixed(9)),
      );
    }
    expect(new Set(phases).size).toBe(1);
    for (const sh of shifts)
      expect(Math.abs(sh - Math.round(sh))).toBeLessThan(1e-6);
    // 0.37 px/frame rounds to 0,0,1,1,1,2,2,3 px (half away from zero).
    expect(shifts.map(x => Math.round(x))).toEqual([0, 0, 1, 1, 1, 2, 2, 3]);
    target.restore();
    expect(stage.position.toArray()).toEqual([0, 0, 0]);
  });

  it('REQ-ANM-015: metadata renders in place and reports integer root offsets in output pixels (top-left, y down)', () => {
    const {character, stage, joint} = threeCharacter();
    const s = settings({camera: {preset: 'side', framing: 0.03125}});
    const wpp = 0.03125;
    character.travelX = 4.3 * wpp;
    character.travelY = 1.2 * wpp;
    const target = createPipelineFrameTarget({
      pipeline: fakePipeline(),
      character,
      stage,
    });
    return (async () => {
      target.configure(s);
      await target.setClip(WALK, 'metadata');
      target.setFraming(FIXED);
      target.setRootReference(0);
      const e = activeDirectionLabels(s).indexOf('e');
      const v = new Vector3();
      const offsets: Array<readonly [number, number] | undefined> = [];
      for (let i = 0; i < 4; i++) {
        target.pose(i, e);
        offsets.push(target.rootOffsetPx());
        stage.updateMatrixWorld(true);
        joint.getWorldPosition(v);
        // In place horizontally (± the sub-pixel snap), vertical motion kept.
        expect(Math.abs(v.x)).toBeLessThanOrEqual(wpp / 2 + 1e-12);
      }
      expect(offsets).toEqual([
        [0, 0],
        [4, -1],
        [9, -2],
        [13, -4],
      ]);
      target.restore();
      expect(character.root.position.toArray()).toEqual([0, 0, 0]);
    })();
  });

  it('REQ-PIX-007: skinnedCorners are in stage space (yaw excluded) and setFraming reaches the pipeline once', () => {
    const {character, stage} = threeCharacter();
    const pipeline = fakePipeline();
    const target = createPipelineFrameTarget({pipeline, character, stage});
    const s = settings({directions: 8});
    target.configure(s);
    target.pose(0, 0);
    const a = target.skinnedCorners();
    target.pose(0, 3);
    const b = target.skinnedCorners();
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(a.length).toBe(24);
    target.setFraming(FIXED);
    target.render();
    expect(pipeline.framings).toEqual([FIXED]);
    expect(pipeline.renders).toBe(1);
  });
});
