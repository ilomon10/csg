/**
 * Union screen bounds of the export (spec 003 REQ-PIX-007, AC-PIX-007.2): per
 * planned frame, the stage-space axis-aligned box of every visible mesh's
 * CPU-skinned vertices, projected for each direction yaw into the camera plane. The
 * result is conservative: it always contains every skinned vertex (an AABB
 * contains its vertices and the projection is linear), and is slightly loose
 * when the yaw is not a multiple of 90 degrees. No GPU, no pixel readback.
 *
 * Camera convention (shared with the export camera, M2-14): orthographic,
 * looking at the pivot from +Z, raised by `elevationDeg` about the X axis.
 * Screen X is world +X; screen Y is `y·cos(e) − z·sin(e)`; the pivot (stage
 * origin) projects to (0, 0).
 */
import {Matrix4, Vector3} from 'three';
import type {Mesh, Object3D, SkinnedMesh} from 'three';
import type {FramingBox, ScreenBox} from '../contracts/pipeline';

/** Floats per box: 8 corners × xyz. */
export const CORNER_FLOATS_PER_BOX = 24;

const DEG_TO_RAD = Math.PI / 180;

/** Box at the pivot, returned for an empty corner list. */
const EMPTY_BOX: ScreenBox = {minX: 0, maxX: 0, minY: 0, maxY: 0};

const _v = new Vector3();
const _min = new Vector3();
const _max = new Vector3();
const _toStage = new Matrix4();
const _stageInverse = new Matrix4();

/**
 * Projects stage-space points into the camera plane for one direction and
 * camera elevation, returning their screen bounding box in world units with
 * the pivot at the origin.
 *
 * @param corners Packed xyz points in stage space (length a multiple of 3),
 *   usually 8 box corners per mesh from {@link collectStageCorners}.
 * @param yawRad Stage `rotation.y` of the direction (`stageYawRad`).
 * @param elevationDeg Camera elevation in degrees (`cameraElevationDeg`).
 * @returns The screen box; a zero box at the pivot when `corners` is empty.
 */
export function projectCorners(
  corners: ArrayLike<number>,
  yawRad: number,
  elevationDeg: number,
): ScreenBox {
  const count = Math.floor(corners.length / 3);
  if (count === 0) return EMPTY_BOX;
  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);
  const e = elevationDeg * DEG_TO_RAD;
  const ce = Math.cos(e);
  const se = Math.sin(e);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = corners[i * 3] as number;
    const y = corners[i * 3 + 1] as number;
    const z = corners[i * 3 + 2] as number;
    // Object3D.rotation.y: x' = x·cos + z·sin, z' = −x·sin + z·cos.
    const sx = x * cy + z * sy;
    const zr = -x * sy + z * cy;
    const syc = y * ce - zr * se;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (syc < minY) minY = syc;
    if (syc > maxY) maxY = syc;
  }
  return {minX, maxX, minY, maxY};
}

/**
 * Smallest box containing both boxes.
 *
 * @param a First box.
 * @param b Second box.
 * @returns The union.
 */
export function unionBox(a: ScreenBox, b: ScreenBox): ScreenBox {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function isMesh(o: Object3D): o is Mesh {
  return (o as Partial<Mesh>).isMesh === true;
}

function isSkinned(o: Object3D): o is SkinnedMesh {
  return (o as Partial<SkinnedMesh>).isSkinnedMesh === true;
}

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/**
 * Rounds `v` to a float32 that is `>= v` (`up`) or `<= v` (otherwise), so a
 * packed box never shrinks below the float64 one.
 */
function froundOutward(v: number, up: boolean): number {
  _f32[0] = v;
  const f = _f32[0] as number;
  if (up ? f >= v : f <= v) return f;
  // Step one ULP away from zero or toward it, depending on sign and direction.
  const awayFromZero = up === f > 0;
  if (f === 0) {
    _u32[0] = up ? 1 : 0x80000001;
  } else if (awayFromZero) {
    _u32[0] = (_u32[0] as number) + 1;
  } else {
    _u32[0] = (_u32[0] as number) - 1;
  }
  return _f32[0] as number;
}

/** Expands `_min`/`_max` by `_v` transformed with `_toStage`. */
function expandStage(): void {
  _v.applyMatrix4(_toStage);
  _min.min(_v);
  _max.max(_v);
}

/**
 * Expands `_min`/`_max` (stage space) by `mesh`: every CPU-skinned vertex for
 * a skinned mesh, the 8 geometry-box corners otherwise.
 */
function expandByMesh(mesh: Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  if (position === undefined || position.count === 0) return;
  _toStage.multiplyMatrices(_stageInverse, mesh.matrixWorld);
  if (isSkinned(mesh)) {
    // getVertexPosition applies morph targets and linear blend skinning.
    for (let i = 0; i < position.count; i++) {
      mesh.getVertexPosition(i, _v);
      expandStage();
    }
    return;
  }
  if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (box === null || box.isEmpty()) return;
  for (let c = 0; c < 8; c++) {
    _v.set(
      c & 1 ? box.max.x : box.min.x,
      c & 2 ? box.max.y : box.min.y,
      c & 4 ? box.max.z : box.min.z,
    );
    expandStage();
  }
}

/**
 * The current pose's box corners of every visible mesh under `root`, in the
 * local space of `stage` (so the direction yaw on `stage` is excluded). Per
 * mesh, the stage-space AABB of its CPU-skinned vertices (skinned meshes,
 * REQ-PIX-007) or of its transformed geometry box (static meshes such as
 * socket props), packed as 8 corners rounded outward to float32 so the packed
 * box always contains the exact one. Meshes are visited in scene-graph order,
 * so the output is deterministic.
 *
 * Updates world matrices of `stage` and its subtree before reading them.
 *
 * @param root Character root (a descendant of `stage`, or `stage` itself).
 * @param stage The object whose local space is "stage space".
 * @returns {@link CORNER_FLOATS_PER_BOX} floats per non-empty mesh.
 */
export function collectStageCorners(
  root: Object3D,
  stage: Object3D,
): Float32Array {
  stage.updateMatrixWorld(true);
  _stageInverse.copy(stage.matrixWorld).invert();
  const out: number[] = [];
  root.traverseVisible(o => {
    if (!isMesh(o)) return;
    _min.set(Infinity, Infinity, Infinity);
    _max.set(-Infinity, -Infinity, -Infinity);
    expandByMesh(o);
    if (!(_min.x <= _max.x)) return;
    const x0 = froundOutward(_min.x, false);
    const y0 = froundOutward(_min.y, false);
    const z0 = froundOutward(_min.z, false);
    const x1 = froundOutward(_max.x, true);
    const y1 = froundOutward(_max.y, true);
    const z1 = froundOutward(_max.z, true);
    for (let c = 0; c < 8; c++)
      out.push(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0);
  });
  return Float32Array.from(out);
}

/** Accumulates one screen box per (label, direction) for `computeFraming`. */
export interface UnionBounds {
  /**
   * Adds the projection of one frame's stage-space corners.
   *
   * @param label Animation label of the frame.
   * @param direction Direction index in the active set.
   * @param corners Stage-space corners of the pose.
   * @param yawRad Stage yaw of the direction.
   */
  add(
    label: string,
    direction: number,
    corners: ArrayLike<number>,
    yawRad: number,
  ): void;
  /** Boxes in first-added order (deterministic for a deterministic plan). */
  boxes(): FramingBox[];
}

/**
 * Creates a {@link UnionBounds} accumulator for one camera elevation. Empty
 * corner lists add nothing.
 *
 * @param elevationDeg Camera elevation in degrees.
 * @returns The accumulator.
 */
export function createUnionBounds(elevationDeg: number): UnionBounds {
  const byKey = new Map<string, FramingBox>();
  return {
    add(label, direction, corners, yawRad) {
      if (corners.length < 3) return;
      const box = projectCorners(corners, yawRad, elevationDeg);
      const key = `${label}\u0000${direction}`;
      const prev = byKey.get(key);
      byKey.set(key, {
        label,
        direction,
        box: prev === undefined ? box : unionBox(prev.box, box),
      });
    },
    boxes() {
      return [...byKey.values()];
    },
  };
}
