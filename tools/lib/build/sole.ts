/**
 * Sole offset measurement (spec 011 REQ-AST-030 to REQ-AST-033, spec 002 REQ-ANA-008).
 *
 * The engine grounds a character on its lowest feet joint lowered by a per-skeleton-group
 * `soleOffsetM`. This module measures that value from built meshes. The maths is pure
 * ({@link measureGroupSole}); {@link readSoleMesh} reads one built GLB. No file I/O besides the
 * GLB bytes handed in.
 */
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {BODY_REGIONS} from '@csg/parts-schema';
import type {PartEntry, RigDefinition} from '@csg/parts-schema';
import {restWorldMatrices, skeletonFromGroup} from '../rig-verify.js';
import {multiply} from '../mat4.js';
import type {BuildWarning} from './types.js';

/** `_REGION` index of the `feet` region (REQ-AST-025). */
export const FEET_REGION = BODY_REGIONS.indexOf('feet');

/** Mesh data needed to measure a rest-pose sole. Plain arrays, float64 maths. */
export interface SoleMesh {
  /** Part ID, used in messages. */
  id: string;
  /** Joint names of the mesh's skin, in skin order. */
  jointNames: readonly string[];
  /** Inverse bind matrix of each skin joint (column-major, 16 numbers). */
  inverseBind: ReadonlyArray<readonly number[]>;
  /** `x y z` per vertex. */
  positions: ArrayLike<number>;
  /** Four joint indices per vertex (all `JOINTS_n` sets concatenated per vertex). */
  joints: ArrayLike<number>;
  /** Four weights per vertex, parallel to `joints`. */
  weights: ArrayLike<number>;
  /** Influences per vertex in `joints`/`weights` (a multiple of 4). */
  stride: number;
  /** Triangle index list, or `null` for a non-indexed mesh. */
  indices: ArrayLike<number> | null;
  /** `_REGION` per vertex, or `null`. */
  regions: ArrayLike<number> | null;
}

/** Rounds to the nearest 0.0001 m, halves away from zero (REQ-AST-030 `q`). */
export function quantizeSole(value: number): number {
  const steps = Math.round(Math.abs(value) * 10000);
  if (steps === 0) return 0;
  return (Math.sign(value) * steps) / 10000;
}

/** Formats a metre value for messages: rounded to 0.0001, no trailing zeros. */
export function formatMetres(value: number): string {
  return String(quantizeSole(value));
}

/** World matrices of every joint of one skeleton group of `rig`, or `null` for an unknown group. */
export function groupWorldMatrices(
  rig: RigDefinition,
  groupId: string,
): Map<string, number[]> | null {
  const skeleton = skeletonFromGroup(rig, groupId);
  if (skeleton === null) return null;
  return restWorldMatrices(skeleton.joints, skeleton.armatureWorld);
}

/**
 * `jointMinY(G)`: the lowest world Y among the joints of `anatomyBones.feet` and their
 * descendants in the rest pose of group `G`.
 */
export function jointMinY(
  rig: RigDefinition,
  world: ReadonlyMap<string, readonly number[]>,
): number {
  const feet = new Set(rig.anatomyBones.feet);
  const inFeet = new Set<string>();
  for (const bone of rig.bones) {
    const parent = rig.parents[bone];
    if (
      feet.has(bone) ||
      (parent !== null && parent !== undefined && inFeet.has(parent))
    ) {
      inFeet.add(bone);
    }
  }
  let min = Infinity;
  for (const bone of inFeet) {
    const y = world.get(bone)?.[13];
    if (y !== undefined && y < min) min = y;
  }
  return min;
}

/** Rest-pose Y of every vertex of `mesh` skinned onto `world` (linear blend skinning). */
export function restPoseY(
  mesh: SoleMesh,
  world: ReadonlyMap<string, readonly number[]>,
  boneOrder: ReadonlyMap<string, number>,
): Float64Array {
  // Row 1 of world(joint) * inverseBind(joint): y' = a*x + b*y + c*z + d.
  const rows: Array<readonly [number, number, number, number] | null> =
    mesh.jointNames.map((name, i) => {
      const w = world.get(name);
      const ibm = mesh.inverseBind[i];
      if (w === undefined || ibm === undefined) return null;
      const m = multiply(w, ibm);
      return [m[1] ?? 0, m[5] ?? 0, m[9] ?? 0, m[13] ?? 0] as const;
    });
  const count = Math.floor(mesh.positions.length / 3);
  const out = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    const x = mesh.positions[v * 3] ?? 0;
    const y = mesh.positions[v * 3 + 1] ?? 0;
    const z = mesh.positions[v * 3 + 2] ?? 0;
    // Visit joints in rig bone order (REQ-AST-030) so the float sum is reproducible.
    const infl: Array<{order: number; row: number; w: number}> = [];
    for (let k = 0; k < mesh.stride; k++) {
      const w = mesh.weights[v * mesh.stride + k] ?? 0;
      if (w === 0) continue;
      const row = mesh.joints[v * mesh.stride + k] ?? 0;
      const name = mesh.jointNames[row];
      infl.push({order: boneOrder.get(name ?? '') ?? row, row, w});
    }
    infl.sort((a, b) => a.order - b.order || a.row - b.row);
    let sum = 0;
    for (const {row, w} of infl) {
      const r = rows[row];
      if (r === null || r === undefined) continue;
      sum += w * (r[0] * x + r[1] * y + r[2] * z + r[3]);
    }
    out[v] = sum;
  }
  return out;
}

/** Lowest rest-pose Y of a mesh: over all vertices, or over `feet`-region triangle corners. */
export function lowestY(
  mesh: SoleMesh,
  ys: Float64Array,
  feetTrianglesOnly: boolean,
): number | undefined {
  if (!feetTrianglesOnly) {
    let min = Infinity;
    for (const y of ys) if (y < min) min = y;
    return min === Infinity ? undefined : min;
  }
  const regions = mesh.regions;
  if (regions === null) return undefined;
  let min = Infinity;
  const count = mesh.indices === null ? ys.length : mesh.indices.length;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = mesh.indices === null ? i : (mesh.indices[i] ?? 0);
    const b = mesh.indices === null ? i + 1 : (mesh.indices[i + 1] ?? 0);
    const c = mesh.indices === null ? i + 2 : (mesh.indices[i + 2] ?? 0);
    // `_REGION` is constant per triangle (REQ-AST-012 amendment); a triangle counts when its
    // three corners all carry the feet region.
    if (
      regions[a] !== FEET_REGION ||
      regions[b] !== FEET_REGION ||
      regions[c] !== FEET_REGION
    ) {
      continue;
    }
    for (const v of [a, b, c]) {
      const y = ys[v];
      if (y !== undefined && y < min) min = y;
    }
  }
  return min === Infinity ? undefined : min;
}

/** Result of measuring one skeleton group. */
export interface GroupSole {
  groupId: string;
  jointMinY: number;
  /** Lowest `feet`-region triangle corner over the bodies, and the body that holds it. */
  bodySoleY?: number;
  bodyLowestId?: string;
  /** Lowest vertex over the fitting `feet` parts, and the part that holds it. */
  partSoleY?: number;
  partLowestId?: string;
  /** Unrounded `jointMinY - soleMinY`, absent when nothing could be measured. */
  rawOffsetM?: number;
}

/**
 * Measures one skeleton group (REQ-AST-030): `soleMinY` is the lower of `bodySoleY` over the
 * `bodies` and `partSoleY` over the `feet` parts. `rawOffsetM` stays undefined when neither
 * exists.
 */
export function measureGroupSole(
  rig: RigDefinition,
  groupId: string,
  bodies: readonly SoleMesh[],
  feetParts: readonly SoleMesh[],
): GroupSole {
  const world = groupWorldMatrices(rig, groupId);
  if (world === null) throw new Error(`rig has no skeleton group "${groupId}"`);
  const order = new Map(rig.bones.map((b, i) => [b, i]));
  const jointMin = jointMinY(rig, world);
  const result: GroupSole = {groupId, jointMinY: jointMin};
  for (const body of bodies) {
    const y = lowestY(body, restPoseY(body, world, order), true);
    if (y !== undefined && (result.bodySoleY ?? Infinity) > y) {
      result.bodySoleY = y;
      result.bodyLowestId = body.id;
    }
  }
  for (const part of feetParts) {
    const y = lowestY(part, restPoseY(part, world, order), false);
    if (y !== undefined && (result.partSoleY ?? Infinity) > y) {
      result.partSoleY = y;
      result.partLowestId = part.id;
    }
  }
  const lows = [result.bodySoleY, result.partSoleY].filter(
    (y): y is number => y !== undefined,
  );
  if (lows.length > 0) result.rawOffsetM = jointMin - Math.min(...lows);
  return result;
}

/** Maximum spread between body and feet-part soles before `AST_SOLE_SPREAD` (REQ-AST-031). */
export const SOLE_SPREAD_LIMIT_M = 0.01;

/** The warning of REQ-AST-031, or `undefined` when the spread is small or one side is absent. */
export function soleSpreadWarning(
  sole: GroupSole,
  limit = SOLE_SPREAD_LIMIT_M,
): BuildWarning | undefined {
  const {bodySoleY, partSoleY} = sole;
  if (bodySoleY === undefined || partSoleY === undefined) return undefined;
  const diff = Math.abs(bodySoleY - partSoleY);
  if (diff <= limit) return undefined;
  const lowest = partSoleY < bodySoleY ? sole.partLowestId : sole.bodyLowestId;
  return {
    code: 'AST_SOLE_SPREAD',
    partId: lowest,
    message: `skeleton group ${sole.groupId}: ${lowest ?? 'a part'} is ${formatMetres(diff)} m below the other sole (body ${formatMetres(bodySoleY)}, feet parts ${formatMetres(partSoleY)}); one soleOffsetM serves both, so the higher one hovers by that difference.`,
  };
}

/** Error of the sole measurement; maps to `AST_SOLE_OFFSET_RANGE`. */
export class SoleRangeError extends Error {
  constructor(
    readonly groupId: string,
    /** The offending value in metres, or `none`. */
    readonly value: string,
  ) {
    super(
      `skeleton group ${groupId}: sole offset ${value} is outside -0.1..0.1 m or cannot be measured (no feet-region triangle and no fitting feet part).`,
    );
    this.name = 'SoleRangeError';
  }
}

/** A built part as seen by the measurement: manifest entry plus the GLB bytes. */
export interface SoleSource {
  packId: string;
  entry: Pick<
    PartEntry,
    | 'id'
    | 'slot'
    | 'kind'
    | 'rig'
    | 'skeletonGroup'
    | 'characterSkeletonGroup'
    | 'bodyType'
    | 'bodies'
    | 'bodyTypes'
  >;
  /** Built GLB bytes. */
  bytes: Uint8Array;
}

/** Character skeleton group of a body (spec 001 REQ-CMP-037). */
export function characterGroupOf(
  entry: SoleSource['entry'],
  rig: RigDefinition,
): string {
  return (
    entry.characterSkeletonGroup ??
    entry.skeletonGroup ??
    rig.defaultSkeletonGroup
  );
}

/** Spec 001 REQ-CMP-008 rules (a) to (c) between a part and a body. */
export function fitsBody(
  part: SoleSource['entry'],
  body: SoleSource['entry'],
): boolean {
  if (part.kind === 'skinned' && part.rig !== body.rig) return false;
  const bodies = part.bodies ?? [];
  if (bodies.length > 0 && !bodies.includes(body.id)) return false;
  const types = part.bodyTypes ?? [];
  if (
    types.length > 0 &&
    (body.bodyType === undefined || !types.includes(body.bodyType))
  ) {
    return false;
  }
  return true;
}

/** Reads one built GLB into a {@link SoleMesh}; `null` when it has no skin or no mesh. */
export async function readSoleMesh(
  id: string,
  bytes: Uint8Array,
): Promise<SoleMesh | null> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({'meshopt.decoder': MeshoptDecoder});
  const doc: Document = await io.readBinary(new Uint8Array(bytes));
  const skin = doc.getRoot().listSkins()[0];
  if (skin === undefined) return null;
  const jointNames = skin.listJoints().map(j => j.getName());
  const ibmAccessor = skin.getInverseBindMatrices();
  const inverseBind = jointNames.map((_, i) =>
    ibmAccessor === null
      ? []
      : Array.from(ibmAccessor.getElement(i, Array(16).fill(0) as number[])),
  );
  const positions: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  const regions: number[] = [];
  let hasRegion = false;
  let stride = 4;
  const prims = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null || node.getSkin() !== skin) continue;
    prims.push(...mesh.listPrimitives());
  }
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION');
    if (pos === null) continue;
    let sets = 0;
    while (prim.getAttribute(`JOINTS_${sets}`) !== null) sets++;
    stride = Math.max(stride, sets * 4);
  }
  const el = [0, 0, 0, 0];
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION');
    if (pos === null) continue;
    const base = positions.length / 3;
    const n = pos.getCount();
    const p = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      pos.getElement(v, p);
      positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    }
    for (let v = 0; v < n; v++) {
      for (let s = 0; s * 4 < stride; s++) {
        const j = prim.getAttribute(`JOINTS_${s}`);
        const w = prim.getAttribute(`WEIGHTS_${s}`);
        for (let k = 0; k < 4; k++) {
          if (j === null || w === null) {
            joints.push(0);
            weights.push(0);
          } else {
            j.getElement(v, el);
            joints.push(el[k] ?? 0);
            w.getElement(v, el);
            weights.push(el[k] ?? 0);
          }
        }
      }
    }
    const idx = prim.getIndices();
    if (idx !== null) {
      const one = [0];
      for (let i = 0; i < idx.getCount(); i++) {
        idx.getElement(i, one);
        indices.push(base + (one[0] ?? 0));
      }
    } else {
      for (let i = 0; i < n; i++) indices.push(base + i);
    }
    const reg = prim.getAttribute('_REGION');
    const one = [0];
    for (let v = 0; v < n; v++) {
      if (reg === null) regions.push(-1);
      else {
        hasRegion = true;
        reg.getElement(v, one);
        regions.push(one[0] ?? -1);
      }
    }
  }
  if (positions.length === 0) return null;
  return {
    id,
    jointNames,
    inverseBind,
    positions,
    joints,
    weights,
    stride,
    indices,
    regions: hasRegion ? regions : null,
  };
}

/** Everything {@link computeSoleOffsets} reports. */
export interface SoleOffsets {
  /** Value per group ID; groups with no measured body are absent (omitted from the rig). */
  offsets: Map<string, number>;
  groups: GroupSole[];
  warnings: BuildWarning[];
}

/**
 * Computes `soleOffsetM` for every skeleton group of `rig` over `sources` (REQ-AST-030): the
 * bodies `B(G)` and the fitting `feet` parts `F(G)` of the rig. Throws {@link SoleRangeError}
 * (REQ-AST-033) before returning anything when a group cannot be measured or is out of range.
 */
export async function computeSoleOffsets(
  rig: RigDefinition,
  sources: readonly SoleSource[],
): Promise<SoleOffsets> {
  const onRig = sources.filter(s => s.entry.rig === rig.id);
  const meshes = new Map<SoleSource, SoleMesh | null>();
  const mesh = async (s: SoleSource): Promise<SoleMesh | null> => {
    if (!meshes.has(s)) meshes.set(s, await readSoleMesh(s.entry.id, s.bytes));
    return meshes.get(s) ?? null;
  };
  const offsets = new Map<string, number>();
  const groups: GroupSole[] = [];
  const warnings: BuildWarning[] = [];
  for (const group of rig.skeletonGroups) {
    const bodySources = onRig
      .filter(
        s =>
          s.entry.slot === 'body' &&
          characterGroupOf(s.entry, rig) === group.id,
      )
      .sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));
    if (bodySources.length === 0) continue;
    const feetSources = onRig
      .filter(
        s =>
          s.entry.slot === 'feet' &&
          s.entry.kind === 'skinned' &&
          bodySources.some(b => fitsBody(s.entry, b.entry)),
      )
      .sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));
    const bodies = (await Promise.all(bodySources.map(mesh))).filter(
      (m): m is SoleMesh => m !== null,
    );
    const feet = (await Promise.all(feetSources.map(mesh))).filter(
      (m): m is SoleMesh => m !== null,
    );
    const sole = measureGroupSole(rig, group.id, bodies, feet);
    groups.push(sole);
    if (sole.rawOffsetM === undefined)
      throw new SoleRangeError(group.id, 'none');
    const q = quantizeSole(sole.rawOffsetM);
    if (q < -0.1 || q > 0.1) {
      throw new SoleRangeError(group.id, formatMetres(sole.rawOffsetM));
    }
    offsets.set(group.id, q);
    const warning = soleSpreadWarning(sole);
    if (warning !== undefined) warnings.push(warning);
  }
  return {offsets, groups, warnings};
}

/**
 * Returns `rig` with every group's `soleOffsetM` set to `offsets` (absent groups drop the field).
 * Pure; key order of the groups is kept and `soleOffsetM` goes last.
 */
export function applySoleOffsets(
  rig: RigDefinition,
  offsets: ReadonlyMap<string, number>,
): RigDefinition {
  return {
    ...rig,
    skeletonGroups: rig.skeletonGroups.map(group => {
      const {soleOffsetM: _drop, ...rest} = group;
      void _drop;
      const value = offsets.get(group.id);
      return value === undefined ? rest : {...rest, soleOffsetM: value};
    }),
  };
}

/** Compares two stored sole values as integers of 0.0001 m (REQ-AST-032). */
export function soleDiffers(
  stored: number | undefined,
  computed: number | undefined,
): boolean {
  if (stored === undefined || computed === undefined) {
    return stored !== computed;
  }
  return (
    Math.abs(Math.round(stored * 10000) - Math.round(computed * 10000)) > 1
  );
}

/**
 * REQ-AST-034: copies the existing `soleOffsetM` of every skeleton group of `existing` (a parsed
 * rig JSON) onto the groups of `groups` with the same ID; groups no longer written lose theirs.
 * Pure; never mutates its input.
 */
export function carrySoleOffsets<T extends {id: string}>(
  groups: readonly T[],
  existing: unknown,
): Array<T & {soleOffsetM?: number}> {
  const kept = new Map<string, number>();
  const list = (existing as {skeletonGroups?: unknown} | null)?.skeletonGroups;
  if (Array.isArray(list)) {
    for (const g of list) {
      const rec = g as {id?: unknown; soleOffsetM?: unknown};
      if (typeof rec?.id === 'string' && typeof rec.soleOffsetM === 'number') {
        kept.set(rec.id, rec.soleOffsetM);
      }
    }
  }
  return groups.map(g => {
    const value = kept.get(g.id);
    return value === undefined ? {...g} : {...g, soleOffsetM: value};
  });
}
