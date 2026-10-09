import {describe, expect, it} from 'vitest';
import {
  Bone,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint8BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import type {Object3D} from 'three';
import {parseRenderSettings} from '@csg/parts-schema';
import type {ClipRef, RenderSettings} from '@csg/parts-schema';
import {createCharacterAssembly} from '../composition/character-assembly';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
} from '../composition/assembly-test-env';
import type {ScreenBox} from '../contracts/pipeline';
import {cameraElevationDeg, computeFraming} from '../pipeline/framing';
import {stageYawRad} from '../pipeline/directions';
import {activeDirectionLabels, planFrames} from './frame-plan';
import {
  CORNER_FLOATS_PER_BOX,
  collectStageCorners,
  createUnionBounds,
  projectCorners,
  unionBox,
} from './union-bounds';

const CLIP: ClipRef = ref('fixture-clip') as ClipRef;

/** Largest per-side gap between the conservative and the exact screen box (m). */
const LOOSENESS_M = 0.05;

function settings(input: Record<string, unknown>): RenderSettings {
  const result = parseRenderSettings(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

async function stagedCharacter() {
  const assembly = createCharacterAssembly({registry: createTestRegistry()});
  expect((await assembly.setCharacter(fixtureSpec())).ok).toBe(true);
  expect((await assembly.setClip(CLIP, 'in-place')).ok).toBe(true);
  const stage = new Group();
  stage.add(assembly.root);
  return {assembly, stage};
}

/**
 * Exact screen bounds: every (skinned) vertex in world space, projected with
 * the camera basis directly (the yaw is on `stage`, not in the math).
 */
function exactScreenBox(
  root: Object3D,
  stage: Object3D,
  yawRad: number,
  elevationDeg: number,
): ScreenBox {
  stage.rotation.y = yawRad;
  stage.updateMatrixWorld(true);
  const e = (elevationDeg * Math.PI) / 180;
  const v = new Vector3();
  let box = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity};
  root.traverseVisible(o => {
    const mesh = o as Mesh;
    if (mesh.isMesh !== true) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      if ((mesh as SkinnedMesh).isSkinnedMesh === true)
        (mesh as SkinnedMesh).getVertexPosition(i, v);
      else v.fromBufferAttribute(position, i);
      v.applyMatrix4(mesh.matrixWorld);
      const x = v.x;
      const y = v.y * Math.cos(e) - v.z * Math.sin(e);
      box = unionBox(box, {minX: x, maxX: x, minY: y, maxY: y});
    }
  });
  stage.rotation.y = 0;
  return box;
}

function expectContains(outer: ScreenBox, inner: ScreenBox, eps = 1e-12) {
  expect(outer.minX).toBeLessThanOrEqual(inner.minX + eps);
  expect(outer.minY).toBeLessThanOrEqual(inner.minY + eps);
  expect(outer.maxX).toBeGreaterThanOrEqual(inner.maxX - eps);
  expect(outer.maxY).toBeGreaterThanOrEqual(inner.maxY - eps);
}

describe('projectCorners', () => {
  it('AC-PIX-003.1/005.1: side view, yaw 0 maps stage x → screen x and y → screen y', () => {
    const box = projectCorners([1, 2, 3, -1, 0, -3], 0, 0);
    expect(box).toEqual({minX: -1, maxX: 1, minY: 0, maxY: 2});
  });

  it('AC-PIX-003.2: isometric 30° elevation projects a 45°-rotated ground square 2:1', () => {
    const square = [-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5];
    const box = projectCorners(square, Math.PI / 4, 30);
    const ratio = (box.maxX - box.minX) / (box.maxY - box.minY);
    expect(Math.abs(ratio - 2) / 2).toBeLessThan(1e-3);
  });

  it('elevation lowers points toward the camera (+Z after yaw) on screen', () => {
    const box = projectCorners([0, 0, 1], 0, 90);
    expect(box.minY).toBeCloseTo(-1, 12);
  });

  it('returns a zero box at the pivot for no corners', () => {
    expect(projectCorners(new Float32Array(0), 1, 35)).toEqual({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    });
  });
});

describe('collectStageCorners', () => {
  it('excludes the stage yaw and includes static meshes; rounding never shrinks the box', () => {
    const stage = new Group();
    stage.rotation.y = 1.234;
    const geometry = new BoxGeometry(0.3, 1.1, 0.1);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0.1, 0.55, 0);
    stage.add(mesh);
    const corners = collectStageCorners(stage, stage);
    expect(corners).toHaveLength(CORNER_FLOATS_PER_BOX);
    const box = projectCorners(corners, 0, 0);
    expect(box.minX).toBeLessThanOrEqual(-0.05);
    expect(box.maxX).toBeGreaterThanOrEqual(0.25);
    expect(box.minY).toBeLessThanOrEqual(0);
    expect(box.maxY).toBeGreaterThanOrEqual(1.1);
    expect(box.maxX - 0.25).toBeLessThan(1e-7);
    mesh.visible = false;
    expect(collectStageCorners(stage, stage)).toHaveLength(0);
    geometry.dispose();
    material.dispose();
  });
});

/**
 * Oracle of the per-cluster corners: the pre-M2-19 implementation, skinning
 * every vertex with three's `SkinnedMesh.getVertexPosition`.
 */
function referenceCorners(root: Object3D, stage: Object3D): number[] {
  stage.updateMatrixWorld(true);
  const inv = stage.matrixWorld.clone().invert();
  const out: number[] = [];
  const v = new Vector3();
  const f32 = (x: number, up: boolean): number => {
    const f = Math.fround(x);
    if (up ? f >= x : f <= x) return f;
    const a = new Float32Array([f]);
    const u = new Uint32Array(a.buffer);
    if (f === 0) u[0] = up ? 1 : 0x80000001;
    else if (up === f > 0) u[0] = u[0]! + 1;
    else u[0] = u[0]! - 1;
    return a[0]!;
  };
  root.traverseVisible(o => {
    const mesh = o as SkinnedMesh;
    if (mesh.isSkinnedMesh !== true) return;
    const toStage = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const si = mesh.geometry.getAttribute('skinIndex');
    const sw = mesh.geometry.getAttribute('skinWeight');
    const n = mesh.skeleton.bones.length;
    const b = Array.from({length: n}, () => [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ]);
    for (let i = 0; i < pos.count; i++) {
      mesh.getVertexPosition(i, v);
      v.applyMatrix4(toStage);
      let best = 0;
      let bw = -Infinity;
      for (let c = 0; c < 4; c++) {
        if (sw.getComponent(i, c) > bw) {
          bw = sw.getComponent(i, c);
          best = c;
        }
      }
      const box = b[Math.min(Math.max(si.getComponent(i, best), 0), n - 1)]!;
      box[0] = Math.min(box[0]!, v.x);
      box[1] = Math.min(box[1]!, v.y);
      box[2] = Math.min(box[2]!, v.z);
      box[3] = Math.max(box[3]!, v.x);
      box[4] = Math.max(box[4]!, v.y);
      box[5] = Math.max(box[5]!, v.z);
    }
    for (const box of b) {
      if (!(box[0]! <= box[3]!)) continue;
      const [x0, y0, z0] = [0, 1, 2].map(k => f32(box[k]!, false));
      const [x1, y1, z1] = [3, 4, 5].map(k => f32(box[k]!, true));
      for (let c = 0; c < 8; c++)
        out.push(c & 1 ? x1! : x0!, c & 2 ? y1! : y0!, c & 4 ? z1! : z0!);
    }
  });
  return out;
}

describe('collectStageCorners inline skinning (M2-19)', () => {
  it('AC-PIX-007.2: inline skinning gives bit-identical corners to SkinnedMesh.getVertexPosition (normalized weights, scaled bind matrix)', () => {
    const geometry = new BoxGeometry(0.4, 1.2, 0.3, 3, 6, 2);
    const count = geometry.getAttribute('position').count;
    const index: number[] = [];
    const weight: number[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic, uneven influences; some zero weights and ties.
      index.push(i % 3, (i + 1) % 3, 2, 0);
      const a = (i * 37) % 200;
      const b = (i * 11) % (255 - a);
      weight.push(a, b, 255 - a - b, 0);
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(index, 4));
    geometry.setAttribute(
      'skinWeight',
      new Uint8BufferAttribute(weight, 4, true),
    );
    const bones = [new Bone(), new Bone(), new Bone()];
    bones[0]!.add(bones[1]!);
    bones[1]!.add(bones[2]!);
    bones[1]!.position.set(0, 0.4, 0.02);
    bones[2]!.position.set(0.01, 0.4, 0);
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.add(bones[0]!);
    mesh.scale.set(0.013, 0.013, 0.013);
    mesh.rotation.x = -Math.PI / 2;
    const root = new Group();
    root.add(mesh);
    const stage = new Group();
    stage.add(root);
    stage.rotation.y = 0.7;
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton(bones));
    for (const t of [0, 0.3, 1.1]) {
      bones[0]!.rotation.set(t * 0.2, t, -t * 0.4);
      bones[1]!.rotation.set(-t, t * 0.5, t * 0.3);
      bones[2]!.rotation.set(t * 0.9, -t * 0.2, t);
      bones[2]!.scale.setScalar(1 + t * 0.1);
      root.position.set(t, 0.01 * t, -t);
      const fast = Array.from(collectStageCorners(root, stage));
      expect(fast).toEqual(
        Array.from(Float32Array.from(referenceCorners(root, stage))),
      );
    }
    geometry.dispose();
  });

  it('AC-PIX-007.2: fixture character corners are bit-identical to the getVertexPosition oracle', async () => {
    const {assembly, stage} = await stagedCharacter();
    for (const t of [0, 0.25, 0.6]) {
      assembly.evaluate(t);
      const all = Array.from(collectStageCorners(assembly.root, stage));
      const skinned = Array.from(
        Float32Array.from(referenceCorners(assembly.root, stage)),
      );
      // The oracle covers skinned meshes only (the sword is static): every oracle box must be present.
      const boxes = (a: number[]) => {
        const out: string[] = [];
        for (let i = 0; i < a.length; i += CORNER_FLOATS_PER_BOX)
          out.push(a.slice(i, i + CORNER_FLOATS_PER_BOX).join(','));
        return out;
      };
      const fastBoxes = new Set(boxes(all));
      for (const box of boxes(skinned)) expect(fastBoxes.has(box)).toBe(true);
      expect(skinned.length).toBeGreaterThan(0);
    }
    assembly.dispose();
  });
});

describe('union bounds on the fixture character', () => {
  it('REQ-PIX-007/AC-PIX-007.2: conservative corners never under-cover the exact skinned vertex bounds at sampled frames', async () => {
    const {assembly, stage} = await stagedCharacter();
    const s = settings({
      directions: 8,
      animations: [
        {clipId: CLIP, label: 'walk', frameCount: 8, fps: 8, loop: true},
      ],
    });
    const jobs = planFrames(s, new Map([[CLIP, 1]]));
    const labels = activeDirectionLabels(s);
    let checked = 0;
    let maxLoose = 0;
    for (const elevationDeg of [0, 30, 35, 90]) {
      for (const job of jobs) {
        assembly.evaluate(job.timeSec);
        const corners = collectStageCorners(assembly.root, stage);
        // Body and shirt per bone cluster, plus the sword's one box.
        expect(corners.length % CORNER_FLOATS_PER_BOX).toBe(0);
        expect(corners.length).toBeGreaterThan(3 * CORNER_FLOATS_PER_BOX);
        const yaw = stageYawRad(labels[job.direction]!);
        const conservative = projectCorners(corners, yaw, elevationDeg);
        const exact = exactScreenBox(assembly.root, stage, yaw, elevationDeg);
        expectContains(conservative, exact);
        // Per-bone boxes stay close to the exact box at every yaw (FX-G).
        for (const k of ['minX', 'minY'] as const)
          maxLoose = Math.max(maxLoose, exact[k] - conservative[k]);
        for (const k of ['maxX', 'maxY'] as const)
          maxLoose = Math.max(maxLoose, conservative[k] - exact[k]);
        checked++;
      }
    }
    expect(checked).toBe(4 * 64);
    console.log(
      `[fx-g] fixture max per-side looseness ${maxLoose.toFixed(4)} m`,
    );
    expect(maxLoose).toBeLessThan(LOOSENESS_M);
    assembly.dispose();
  });

  it('REQ-PIX-007: side view at cardinal directions is tight (float32 rounding only)', async () => {
    const {assembly, stage} = await stagedCharacter();
    for (const label of ['e', 'w'] as const) {
      for (const t of [0, 0.25, 0.5]) {
        assembly.evaluate(t);
        const corners = collectStageCorners(assembly.root, stage);
        const yaw = stageYawRad(label);
        const a = projectCorners(corners, yaw, 0);
        const b = exactScreenBox(assembly.root, stage, yaw, 0);
        for (const k of ['minX', 'maxX', 'minY', 'maxY'] as const)
          expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-6);
      }
    }
    assembly.dispose();
  });

  it('AC-PIX-007.1/015.3: plan → union bounds → computeFraming keeps every exact vertex in the auto-framed cell', async () => {
    const {assembly, stage} = await stagedCharacter();
    const s = settings({
      camera: {preset: 'three-quarter'},
      directions: 8,
      animations: [
        {clipId: CLIP, label: 'walk', frameCount: 8, fps: 8, loop: true},
        {clipId: CLIP, label: 'hop', frameCount: 3, fps: 6, loop: false},
      ],
    });
    const elevation = cameraElevationDeg(s.camera);
    const labels = activeDirectionLabels(s);
    const jobs = planFrames(s, new Map([[CLIP, 1]]));
    const union = createUnionBounds(elevation);
    for (const job of jobs) {
      assembly.evaluate(job.timeSec);
      union.add(
        job.label,
        job.direction,
        collectStageCorners(assembly.root, stage),
        stageYawRad(labels[job.direction]!),
      );
    }
    const boxes = union.boxes();
    expect(boxes.map(b => `${b.label}:${b.direction}`)).toEqual([
      ...labels.map((_, d) => `walk:${d}`),
      ...labels.map((_, d) => `hop:${d}`),
    ]);
    const framing = computeFraming(boxes, s);
    // The fixture stands on the ground in place: nothing above or beside the cell.
    const {frustum, worldPerPx} = framing;
    const margin = (s.outline.outer.widthPx + 1) * worldPerPx;
    for (const job of jobs) {
      assembly.evaluate(job.timeSec);
      const exact = exactScreenBox(
        assembly.root,
        stage,
        stageYawRad(labels[job.direction]!),
        elevation,
      );
      expect(exact.maxX).toBeLessThanOrEqual(frustum.right - margin + 1e-9);
      expect(exact.minX).toBeGreaterThanOrEqual(frustum.left + margin - 1e-9);
      expect(exact.maxY).toBeLessThanOrEqual(frustum.top - margin + 1e-9);
    }
    assembly.dispose();
  });
});
