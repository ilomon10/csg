import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {projectCorners} from '../sampler/union-bounds';
import {
  applyCameraFraming,
  cameraBasis,
  cameraElevationOf,
  createPixelCamera,
  projectToCameraPlane,
  snapToCameraPlane,
} from './camera';
import {computeFraming} from './framing';

function framingFor(
  preset: RenderSettings['camera']['preset'],
  worldPerPx = 0.03125,
  elevationDeg?: number,
  pivotRowPx?: number,
) {
  const s = defaultRenderSettings(preset);
  const settings: RenderSettings = {
    ...s,
    camera: {
      ...s.camera,
      framing: worldPerPx,
      ...(pivotRowPx === undefined ? {} : {pivotRowPx}),
      ...(elevationDeg === undefined ? {} : {elevationDeg}),
    },
  };
  return computeFraming([], settings);
}

/** Projects a world point with the real camera into continuous top-left cell px. */
function cellPx(
  camera: ReturnType<typeof createPixelCamera>,
  p: readonly [number, number, number],
  w: number,
  h: number,
): [number, number] {
  const v = new Vector3(...p).project(camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

describe('pipeline camera', () => {
  it('AC-PIX-003.1: side preset looks horizontally and is orthographic', () => {
    const camera = createPixelCamera();
    applyCameraFraming(camera, framingFor('side'));
    expect(camera.isOrthographicCamera).toBe(true);
    expect(Math.abs(cameraElevationOf(camera))).toBeLessThan(0.001);
    const dir = camera.getWorldDirection(new Vector3());
    expect(dir.x).toBeCloseTo(0, 12);
    expect(dir.y).toBeCloseTo(0, 12);
    expect(dir.z).toBeCloseTo(-1, 12);
  });

  it('AC-PIX-003.3: three-quarter preset elevation is 35° ± 0.001°', () => {
    const camera = createPixelCamera();
    applyCameraFraming(camera, framingFor('three-quarter'));
    expect(Math.abs(cameraElevationOf(camera) - 35)).toBeLessThan(0.001);
  });

  it('AC-PIX-003.2: isometric ground square rotated 45° projects to a 2:1 box (camera and union-bounds agree)', () => {
    const f = framingFor('isometric');
    expect(f.elevationDeg).toBe(30);
    const r = Math.SQRT1_2;
    // 1×1 square on the ground, rotated 45° about +Y.
    const corners: Array<[number, number, number]> = [
      [r, 0, 0],
      [0, 0, r],
      [-r, 0, 0],
      [0, 0, -r],
    ];
    const camera = createPixelCamera();
    applyCameraFraming(camera, f);
    const px = corners.map(c => cellPx(camera, c, 64, 64));
    const xs = px.map(p => p[0]);
    const ys = px.map(p => p[1]);
    const ratio =
      (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    expect(Math.abs(ratio / 2 - 1)).toBeLessThan(0.001);
    // Same box from the union-bounds projection (shared convention).
    const box = projectCorners(corners.flat(), 0, f.elevationDeg);
    expect((box.maxX - box.minX) / (box.maxY - box.minY)).toBeCloseTo(2, 9);
  });

  it('camera projection equals the union-bounds convention for every preset and custom 90°', () => {
    const points: Array<[number, number, number]> = [
      [0.3, 1.2, -0.4],
      [-0.7, 0.1, 0.9],
      [0.05, 1.8, 0.2],
    ];
    for (const [preset, elevation] of [
      ['side', undefined],
      ['three-quarter', undefined],
      ['isometric', undefined],
      ['custom', 90],
      ['custom', 12.5],
    ] as const) {
      const f = framingFor(preset, 0.03125, elevation);
      const camera = createPixelCamera();
      applyCameraFraming(camera, f);
      for (const p of points) {
        const [cx, cy] = cellPx(camera, p, 64, 64);
        const [sx, sy] = projectToCameraPlane(p, f.elevationDeg);
        const box = projectCorners(p, 0, f.elevationDeg);
        expect(box.minX).toBeCloseTo(sx, 12);
        expect(box.minY).toBeCloseTo(sy, 12);
        // Continuous top-left cell px; the pivot corner is (pivotPx.x, pivotPx.y + 1) (A6).
        expect(cx).toBeCloseTo(f.pivotPx[0] + sx / f.worldPerPx, 6);
        expect(cy).toBeCloseTo(f.pivotPx[1] + 1 - sy / f.worldPerPx, 6);
      }
    }
  });

  it('AC-PIX-008.3: the pivot projects onto the pixel corner (32, 62) at 64×64, pivotRowPx 2', () => {
    const camera = createPixelCamera();
    const f = framingFor('side', undefined, undefined, 2);
    applyCameraFraming(camera, f);
    const [x, y] = cellPx(camera, [0, 0, 0], 64, 64);
    expect(x).toBeCloseTo(32, 9);
    expect(y).toBeCloseTo(62, 9);
  });

  it('AC-PIX-010.1: same framing ⇒ identical 16 matrix floats; camera-plane pivot snapped to the texel grid', () => {
    const f = framingFor('three-quarter', 0.03);
    const a = createPixelCamera();
    const b = createPixelCamera();
    const pa = applyCameraFraming(a, f, [0.0149, 0.01, 0.2]);
    applyCameraFraming(b, f, [0.0149, 0.01, 0.2]);
    expect(Array.from(a.matrixWorld.elements)).toEqual(
      Array.from(b.matrixWorld.elements),
    );
    expect(Array.from(a.projectionMatrix.elements)).toEqual(
      Array.from(b.projectionMatrix.elements),
    );
    const [sx, sy] = projectToCameraPlane(pa.pivot, f.elevationDeg);
    expect(Math.abs(sx / 0.03 - Math.round(sx / 0.03))).toBeLessThan(1e-9);
    expect(Math.abs(sy / 0.03 - Math.round(sy / 0.03))).toBeLessThan(1e-9);
  });

  it('snapToCameraPlane keeps the view-axis coordinate and is idempotent', () => {
    const p: [number, number, number] = [0.123, 0.456, -0.789];
    const e = 35;
    const s = snapToCameraPlane(p, e, 0.05);
    const {back} = cameraBasis(e);
    const d = (v: readonly number[]) =>
      (v[0] ?? 0) * back[0] + (v[1] ?? 0) * back[1] + (v[2] ?? 0) * back[2];
    expect(d(s)).toBeCloseTo(d(p), 12);
    const again = snapToCameraPlane(s, e, 0.05);
    for (let i = 0; i < 3; i++) expect(again[i]).toBeCloseTo(s[i] ?? 0, 12);
  });

  it('depth range holds the character: distance ≥ 10 and far = 2 · distance', () => {
    const camera = createPixelCamera();
    const placement = applyCameraFraming(
      camera,
      framingFor('side', 0.5, undefined, 2),
    );
    expect(placement.distance).toBe(4 * 62 * 0.5);
    expect(camera.near).toBe(0);
    expect(camera.far).toBe(2 * placement.distance);
    const small = applyCameraFraming(
      camera,
      framingFor('side', 0.01, undefined, 2),
    );
    expect(small.distance).toBe(10);
  });
});
