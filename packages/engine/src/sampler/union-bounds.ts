/**
 * Union screen bounds of the export (spec 003 REQ-PIX-007, AC-PIX-007.2): per
 * planned frame, the stage-space axis-aligned boxes of every visible mesh (one
 * per bone cluster of its CPU-skinned vertices), projected for each direction
 * yaw into the camera plane. The
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

/** Per-cluster stage-space bounds: 6 floats (min xyz, max xyz) per cluster. */
let _clusterBounds = new Float64Array(0);

/** Grows {@link _clusterBounds} to `clusters` entries and resets them to empty. */
function resetClusters(clusters: number): Float64Array {
  if (_clusterBounds.length < clusters * 6)
    _clusterBounds = new Float64Array(clusters * 6);
  for (let c = 0; c < clusters; c++) {
    const o = c * 6;
    _clusterBounds[o] = Infinity;
    _clusterBounds[o + 1] = Infinity;
    _clusterBounds[o + 2] = Infinity;
    _clusterBounds[o + 3] = -Infinity;
    _clusterBounds[o + 4] = -Infinity;
    _clusterBounds[o + 5] = -Infinity;
  }
  return _clusterBounds;
}

/** Expands cluster `c` of `bounds` by `_v` transformed with `_toStage`. */
function expandCluster(bounds: Float64Array, c: number): void {
  _v.applyMatrix4(_toStage);
  const o = c * 6;
  if (_v.x < (bounds[o] as number)) bounds[o] = _v.x;
  if (_v.y < (bounds[o + 1] as number)) bounds[o + 1] = _v.y;
  if (_v.z < (bounds[o + 2] as number)) bounds[o + 2] = _v.z;
  if (_v.x > (bounds[o + 3] as number)) bounds[o + 3] = _v.x;
  if (_v.y > (bounds[o + 4] as number)) bounds[o + 4] = _v.y;
  if (_v.z > (bounds[o + 5] as number)) bounds[o + 5] = _v.z;
}

/** Appends the 8 corners of one stage box, rounded outward to float32. */
function pushBox(
  out: number[],
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): void {
  const x0 = froundOutward(minX, false);
  const y0 = froundOutward(minY, false);
  const z0 = froundOutward(minZ, false);
  const x1 = froundOutward(maxX, true);
  const y1 = froundOutward(maxY, true);
  const z1 = froundOutward(maxZ, true);
  for (let c = 0; c < 8; c++)
    out.push(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0);
}

/**
 * Index of the bone with the largest skin weight of vertex `i` (ties: the
 * first of the four influences), the vertex's cluster.
 */
function dominantBone(
  skinIndex: {getComponent(i: number, c: number): number},
  skinWeight: {getComponent(i: number, c: number): number},
  i: number,
): number {
  let best = 0;
  let bestWeight = -Infinity;
  for (let c = 0; c < 4; c++) {
    const w = skinWeight.getComponent(i, c);
    if (w > bestWeight) {
      bestWeight = w;
      best = c;
    }
  }
  return skinIndex.getComponent(i, best);
}

/** Per-bone `matrixWorld · boneInverse` of the current pose, 16 floats per bone. */
let _boneMatrices = new Float64Array(0);

/**
 * Fills {@link _boneMatrices} for `mesh` exactly as `SkinnedMesh.applyBoneTransform`
 * computes them per vertex (`Matrix4.multiplyMatrices(bone.matrixWorld, boneInverse)`),
 * once per mesh instead of once per vertex influence.
 *
 * @returns The bone count, or -1 when a bone or inverse is missing.
 */
function fillBoneMatrices(mesh: SkinnedMesh): number {
  const {bones, boneInverses} = mesh.skeleton;
  const count = bones.length;
  if (_boneMatrices.length < count * 16)
    _boneMatrices = new Float64Array(count * 16);
  for (let b = 0; b < count; b++) {
    const bone = bones[b];
    const inverse = boneInverses[b];
    if (bone === undefined || inverse === undefined) return -1;
    _boneMatrix.multiplyMatrices(bone.matrixWorld, inverse);
    _boneMatrices.set(_boneMatrix.elements, b * 16);
  }
  return count;
}

const _boneMatrix = new Matrix4();

/** The 16 column-major elements of a `Matrix4`. */
type Mat4Tuple = Parameters<Matrix4['set']>;

const _skinIndex4 = [0, 0, 0, 0];
const _skinWeight4 = [0, 0, 0, 0];
const _position3 = [0, 0, 0];

/** The attribute calls the skinning loop makes (`BufferAttribute` fits). */
interface VertexAttribute {
  readonly itemSize: number;
  readonly normalized: boolean;
  readonly array: ArrayLike<number>;
  readonly isInterleavedBufferAttribute?: boolean;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
  getW(i: number): number;
}

/**
 * How to read an attribute's components straight from its typed array with
 * the same values as `BufferAttribute.getX` (three `MathUtils.denormalize`):
 * 0 raw, 1 `v / d`, 2 `max(v / d, -1)`; -1 = use the getters (interleaved or
 * an unknown component type).
 */
function readMode(attr: VertexAttribute): {mode: number; divisor: number} {
  if (attr.isInterleavedBufferAttribute === true) return {mode: -1, divisor: 1};
  if (!attr.normalized) return {mode: 0, divisor: 1};
  switch (attr.array.constructor) {
    case Float32Array:
      return {mode: 0, divisor: 1};
    case Uint32Array:
      return {mode: 1, divisor: 4294967295.0};
    case Uint16Array:
      return {mode: 1, divisor: 65535.0};
    case Uint8Array:
    case Uint8ClampedArray:
      return {mode: 1, divisor: 255.0};
    case Int32Array:
      return {mode: 2, divisor: 2147483647.0};
    case Int16Array:
      return {mode: 2, divisor: 32767.0};
    case Int8Array:
      return {mode: 2, divisor: 127.0};
    default:
      return {mode: -1, divisor: 1};
  }
}

/** Reads `count` components of vertex `i` into `out`, exactly like the getters. */
function readComponents(
  attr: VertexAttribute,
  how: {mode: number; divisor: number},
  i: number,
  count: number,
  out: number[],
): void {
  if (how.mode < 0) {
    out[0] = attr.getX(i);
    out[1] = attr.getY(i);
    if (count > 2) out[2] = attr.getZ(i);
    if (count > 3) out[3] = attr.getW(i);
    return;
  }
  const array = attr.array;
  const base = i * attr.itemSize;
  const d = how.divisor;
  for (let k = 0; k < count; k++) {
    const v = array[base + k] as number;
    out[k] = how.mode === 0 ? v : how.mode === 1 ? v / d : Math.max(v / d, -1);
  }
}

/**
 * Appends the boxes of `mesh` in stage space: for a skinned mesh one box per
 * bone cluster (the CPU-skinned vertices whose largest skin weight is that
 * bone, ascending bone index), otherwise the transformed geometry box.
 *
 * Performance (M2-19, AC-PIX-007.2): skinned meshes without active morph
 * targets are skinned inline with the per-bone matrices computed once per
 * mesh. The arithmetic is the same float64 expressions in the same order as
 * three r186 `SkinnedMesh.getVertexPosition` (bind matrix, weighted
 * `Vector4.applyMatrix4` per influence, `Vector3.applyMatrix4` of the bind
 * inverse), so the bounds and therefore the framing are bit-identical
 * (unit test `union-bounds.test.ts`). Meshes with morph targets keep the
 * three call.
 */
function pushMeshBoxes(mesh: Mesh, out: number[]): void {
  const position = mesh.geometry.getAttribute('position');
  if (position === undefined || position.count === 0) return;
  _toStage.multiplyMatrices(_stageInverse, mesh.matrixWorld);
  if (isSkinned(mesh)) {
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    const clusters =
      skinIndex === undefined || skinWeight === undefined
        ? 1
        : Math.max(mesh.skeleton.bones.length, 1);
    const bounds = resetClusters(clusters);
    const morphed =
      mesh.geometry.morphAttributes.position !== undefined &&
      mesh.morphTargetInfluences !== undefined;
    const bones =
      morphed || skinIndex === undefined || skinWeight === undefined
        ? -1
        : fillBoneMatrices(mesh);
    const [
      b0,
      b1,
      b2,
      b3,
      b4,
      b5,
      b6,
      b7,
      b8,
      b9,
      b10,
      b11,
      b12,
      b13,
      b14,
      b15,
    ] = mesh.bindMatrix.elements as unknown as Mat4Tuple;
    const [
      i0,
      i1,
      i2,
      i3,
      i4,
      i5,
      i6,
      i7,
      i8,
      i9,
      i10,
      i11,
      i12,
      i13,
      i14,
      i15,
    ] = mesh.bindMatrixInverse.elements as unknown as Mat4Tuple;
    const M = _boneMatrices;
    const m = (k: number): number => M[k] as number;
    const positionRead = readMode(position as VertexAttribute);
    const indexRead =
      skinIndex === undefined
        ? undefined
        : readMode(skinIndex as VertexAttribute);
    const weightRead =
      skinWeight === undefined
        ? undefined
        : readMode(skinWeight as VertexAttribute);
    const direct =
      positionRead.mode === 0 &&
      indexRead?.mode === 0 &&
      weightRead?.mode === 0;
    const P = position.array as ArrayLike<number>;
    const I = (skinIndex?.array ?? P) as ArrayLike<number>;
    const W = (skinWeight?.array ?? P) as ArrayLike<number>;
    const positionSize = position.itemSize;
    const indexSize = skinIndex?.itemSize ?? 4;
    const weightSize = skinWeight?.itemSize ?? 4;
    // `_toStage` applied like `Vector3.applyMatrix4` (with the divide).
    const [
      s0,
      s1,
      s2,
      s3,
      s4,
      s5,
      s6,
      s7,
      s8,
      s9,
      s10,
      s11,
      s12,
      s13,
      s14,
      s15,
    ] = _toStage.elements as unknown as Mat4Tuple;
    for (let i = 0; i < position.count; i++) {
      let c = 0;
      if (
        bones >= 0 &&
        skinIndex !== undefined &&
        skinWeight !== undefined &&
        indexRead !== undefined &&
        weightRead !== undefined
      ) {
        if (direct) {
          // Monomorphic typed-array reads (the common glTF layout).
          const ib = i * indexSize;
          const wb = i * weightSize;
          _skinIndex4[0] = I[ib] as number;
          _skinIndex4[1] = I[ib + 1] as number;
          _skinIndex4[2] = I[ib + 2] as number;
          _skinIndex4[3] = I[ib + 3] as number;
          _skinWeight4[0] = W[wb] as number;
          _skinWeight4[1] = W[wb + 1] as number;
          _skinWeight4[2] = W[wb + 2] as number;
          _skinWeight4[3] = W[wb + 3] as number;
          const pb = i * positionSize;
          _position3[0] = P[pb] as number;
          _position3[1] = P[pb + 1] as number;
          _position3[2] = P[pb + 2] as number;
        } else {
          readComponents(
            skinIndex as VertexAttribute,
            indexRead,
            i,
            4,
            _skinIndex4,
          );
          readComponents(
            skinWeight as VertexAttribute,
            weightRead,
            i,
            4,
            _skinWeight4,
          );
          readComponents(
            position as VertexAttribute,
            positionRead,
            i,
            3,
            _position3,
          );
        }
        const x = _position3[0] as number;
        const y = _position3[1] as number;
        const z = _position3[2] as number;
        const w = 1;
        // _baseVector.set(x, y, z, 1).applyMatrix4(bindMatrix)
        const bx = b0 * x + b4 * y + b8 * z + b12 * w;
        const by = b1 * x + b5 * y + b9 * z + b13 * w;
        const bz = b2 * x + b6 * y + b10 * z + b14 * w;
        const bw = b3 * x + b7 * y + b11 * z + b15 * w;
        let tx = 0;
        let ty = 0;
        let tz = 0;
        let best = 0;
        let bestWeight = -Infinity;
        for (let k = 0; k < 4; k++) {
          const weight = _skinWeight4[k] as number;
          if (weight > bestWeight) {
            bestWeight = weight;
            best = k;
          }
          if (weight === 0) continue;
          const bone = _skinIndex4[k] as number;
          if (!(bone >= 0 && bone < bones)) {
            throw new Error(
              `collectStageCorners: ${mesh.name} vertex ${i} references bone ${bone} of ${bones}`,
            );
          }
          const o = bone * 16;
          // target.addScaledVector(_vector4.copy(base).applyMatrix4(M), weight)
          tx +=
            (m(o) * bx + m(o + 4) * by + m(o + 8) * bz + m(o + 12) * bw) *
            weight;
          ty +=
            (m(o + 1) * bx + m(o + 5) * by + m(o + 9) * bz + m(o + 13) * bw) *
            weight;
          tz +=
            (m(o + 2) * bx + m(o + 6) * by + m(o + 10) * bz + m(o + 14) * bw) *
            weight;
        }
        // target.applyMatrix4(bindMatrixInverse) (Vector3: perspective divide)
        const iw = 1 / (i3 * tx + i7 * ty + i11 * tz + i15);
        const vx = (i0 * tx + i4 * ty + i8 * tz + i12) * iw;
        const vy = (i1 * tx + i5 * ty + i9 * tz + i13) * iw;
        const vz = (i2 * tx + i6 * ty + i10 * tz + i14) * iw;
        c = Math.min(Math.max(_skinIndex4[best] as number, 0), clusters - 1);
        // expandCluster(bounds, c) with `_v.applyMatrix4(_toStage)` inlined.
        const sw = 1 / (s3 * vx + s7 * vy + s11 * vz + s15);
        const px = (s0 * vx + s4 * vy + s8 * vz + s12) * sw;
        const py = (s1 * vx + s5 * vy + s9 * vz + s13) * sw;
        const pz = (s2 * vx + s6 * vy + s10 * vz + s14) * sw;
        const o = c * 6;
        if (px < (bounds[o] as number)) bounds[o] = px;
        if (py < (bounds[o + 1] as number)) bounds[o + 1] = py;
        if (pz < (bounds[o + 2] as number)) bounds[o + 2] = pz;
        if (px > (bounds[o + 3] as number)) bounds[o + 3] = px;
        if (py > (bounds[o + 4] as number)) bounds[o + 4] = py;
        if (pz > (bounds[o + 5] as number)) bounds[o + 5] = pz;
        continue;
      } else {
        // getVertexPosition applies morph targets and linear blend skinning.
        mesh.getVertexPosition(i, _v);
        c =
          clusters === 1
            ? 0
            : Math.min(
                Math.max(
                  dominantBone(
                    skinIndex as NonNullable<typeof skinIndex>,
                    skinWeight as NonNullable<typeof skinWeight>,
                    i,
                  ),
                  0,
                ),
                clusters - 1,
              );
      }
      expandCluster(bounds, c);
    }
    for (let c = 0; c < clusters; c++) {
      const o = c * 6;
      if (!((bounds[o] as number) <= (bounds[o + 3] as number))) continue;
      pushBox(
        out,
        bounds[o] as number,
        bounds[o + 1] as number,
        bounds[o + 2] as number,
        bounds[o + 3] as number,
        bounds[o + 4] as number,
        bounds[o + 5] as number,
      );
    }
    return;
  }
  if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (box === null || box.isEmpty()) return;
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (let c = 0; c < 8; c++) {
    _v.set(
      c & 1 ? box.max.x : box.min.x,
      c & 2 ? box.max.y : box.min.y,
      c & 4 ? box.max.z : box.min.z,
    );
    _v.applyMatrix4(_toStage);
    _min.min(_v);
    _max.max(_v);
  }
  pushBox(out, _min.x, _min.y, _min.z, _max.x, _max.y, _max.z);
}

/**
 * The current pose's box corners of every visible mesh under `root`, in the
 * local space of `stage` (so the direction yaw on `stage` is excluded).
 * Skinned meshes (REQ-PIX-007) give one stage-space AABB per bone cluster:
 * the CPU-skinned vertices grouped by the bone with their largest skin
 * weight. Small per-bone boxes follow the pose closely, so their projection
 * at diagonal yaws and elevated cameras stays near the exact vertex bounds
 * (one whole-mesh box would pair the head's height with the heel's depth;
 * FX-G). Static meshes such as socket props give their transformed geometry
 * box. Every box is packed as 8 corners rounded outward to float32 so it
 * always contains the exact one. Meshes are visited in scene-graph order and
 * clusters in bone order, so the output is deterministic.
 *
 * Updates world matrices of `stage` and its subtree before reading them.
 *
 * @param root Character root (a descendant of `stage`, or `stage` itself).
 * @param stage The object whose local space is "stage space".
 * @returns {@link CORNER_FLOATS_PER_BOX} floats per non-empty box.
 */
export function collectStageCorners(
  root: Object3D,
  stage: Object3D,
): Float32Array {
  stage.updateMatrixWorld(true);
  _stageInverse.copy(stage.matrixWorld).invert();
  const out: number[] = [];
  root.traverseVisible(o => {
    if (isMesh(o)) pushMeshBoxes(o, out);
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
