import {describe, expect, it} from 'vitest';
import {BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3} from 'three';
import type {Object3D, SkinnedMesh} from 'three';
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
    for (const elevationDeg of [0, 30, 35, 90]) {
      for (const job of jobs) {
        assembly.evaluate(job.timeSec);
        const corners = collectStageCorners(assembly.root, stage);
        // body, shirt and sword
        expect(corners.length).toBe(3 * CORNER_FLOATS_PER_BOX);
        const yaw = stageYawRad(labels[job.direction]!);
        const conservative = projectCorners(corners, yaw, elevationDeg);
        const exact = exactScreenBox(assembly.root, stage, yaw, elevationDeg);
        expectContains(conservative, exact);
        // Slightly loose at diagonals only: within 25 cm of the exact box.
        expect(exact.minX - conservative.minX).toBeLessThan(0.25);
        expect(conservative.maxY - exact.maxY).toBeLessThan(0.25);
        checked++;
      }
    }
    expect(checked).toBe(4 * 64);
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
