/**
 * Tint materials (spec 001 REQ-CMP-013, REQ-CMP-014) with optional body region
 * hides (REQ-CMP-011). M1 uses unlit `MeshBasicNodeMaterial`s (m1-plan 2.2);
 * the toon/lit materials of spec 003 replace them later. Works on WebGPU and
 * on WebGL2 (`forceWebGL`): TSL only, no raw GLSL.
 */
import {Color} from 'three';
import type {BufferGeometry, Material, Mesh, Object3D, Texture} from 'three';
import {luminance, texture, uniform, vec4} from 'three/tsl';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {Node, UniformNode} from 'three/webgpu';
import {TINT_SLOTS} from '@csg/parts-schema';
import type {HexColor, PartEntry, TintSlot} from '@csg/parts-schema';
import type {
  ApplyTintMaterial,
  CreateTintUniforms,
  RegionMask,
  TintUniforms,
  UniformRef,
} from '../contracts/composition';
import {REGION_ID_ATTRIBUTE, regionVisibleNode} from './region-mask';

/** Tint mode when a mapping omits `mode` (REQ-CMP-014). */
export const DEFAULT_TINT_MODE = 'multiply';

/** Key of `material.userData` that records the tint slot of a tinted material. */
export const TINT_SLOT_USER_DATA = 'tintSlot';

/** One mapping of `PartEntry.tintSlots`. */
type TintMapping = PartEntry['tintSlots'][number];

/** Materials of one mesh before tinting, and the ones this module created. */
interface MeshTintState {
  readonly original: Material | Material[];
  created: Material[];
}

const STATE = new WeakMap<Mesh, MeshTintState>();
/** Source mesh to the meshes that mirror its material (attached clones). */
const LINKS = new WeakMap<Mesh, Set<Mesh>>();
/** Plain uniform refs wrapped as nodes, so one ref maps to one node. */
const REF_NODES = new WeakMap<object, UniformNode<string, unknown>>();

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

function isNode(value: unknown): value is {isNode: true} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {isNode?: unknown}).isNode === true
  );
}

/**
 * Creates one color uniform per tint slot (REQ-CMP-013). Each value is a
 * `Color` in the working (linear) color space; mutate it in place
 * (`uniforms.primary.value.set('#3a5fcd')`, or {@link setTint}): every
 * material that maps to the slot updates on the next frame, no recompile.
 *
 * @param initial - Initial `#rrggbb` color per slot (sRGB).
 * @returns Uniform nodes keyed by slot.
 */
export const createTintUniforms: CreateTintUniforms = initial => {
  const out = {} as Record<TintSlot, UniformNode<'color', Color>>;
  for (const slot of TINT_SLOTS) out[slot] = uniform(new Color(initial[slot]));
  return out;
};

/**
 * Sets one tint slot in place (REQ-CMP-013).
 *
 * @param uniforms - Uniforms from {@link createTintUniforms}.
 * @param slot - Tint slot.
 * @param hex - New `#rrggbb` color (sRGB).
 */
export function setTint(
  uniforms: TintUniforms,
  slot: TintSlot,
  hex: HexColor,
): void {
  uniforms[slot].value.set(hex);
}

/** The uniform node of a ref: the ref itself, or a cached node reading it per render. */
function colorNodeOf(ref: UniformRef<Color>): UniformNode<'color', Color> {
  if (isNode(ref)) return ref as unknown as UniformNode<'color', Color>;
  let node = REF_NODES.get(ref) as UniformNode<'color', Color> | undefined;
  if (node === undefined) {
    node = uniform(new Color()).onRenderUpdate(() => ref.value);
    REF_NODES.set(ref, node as UniformNode<string, unknown>);
  }
  return node;
}

function maskNodeOf(ref: RegionMask): UniformNode<'float', number> {
  if (isNode(ref)) return ref as unknown as UniformNode<'float', number>;
  let node = REF_NODES.get(ref) as UniformNode<'float', number> | undefined;
  if (node === undefined) {
    node = uniform(0).onRenderUpdate(() => ref.value);
    REF_NODES.set(ref, node as UniformNode<string, unknown>);
  }
  return node;
}

/** Base map of a source material, when it has one. */
function mapOf(material: Material): Texture | null {
  const map = (material as Material & {map?: Texture | null}).map;
  return map?.isTexture === true ? map : null;
}

/** Base color of a source material (white when it has none). */
function colorOf(material: Material): Color {
  const color = (material as Material & {color?: Color}).color;
  return color?.isColor === true ? color : new Color(1, 1, 1);
}

/**
 * Builds the unlit material for one source material.
 *
 * - No mapping: base color × map, unchanged by any tint (AC-CMP-013.2).
 * - `multiply`: `luminance(map texel) × tint`, alpha from the texel; without a
 *   map the texel is white, so the result is the tint (AC-CMP-014.1).
 * - `replace`: the flat tint color (AC-CMP-014.2).
 *
 * The base color factor is ignored by tinted materials: the tint is the color.
 */
function buildMaterial(
  source: Material,
  mapping: TintMapping | undefined,
  uniforms: TintUniforms,
  mask: UniformNode<'float', number> | undefined,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.name = source.name;
  material.side = source.side;
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.alphaTest = source.alphaTest;
  material.depthWrite = source.depthWrite;
  material.depthTest = source.depthTest;
  const map = mapOf(source);
  if (mapping === undefined) {
    material.color.copy(colorOf(source));
    material.map = map;
  } else {
    const tint = colorNodeOf(uniforms[mapping.slot]);
    const mode = mapping.mode ?? DEFAULT_TINT_MODE;
    let colorNode: Node;
    if (mode === 'replace') {
      colorNode = tint;
    } else if (map === null) {
      colorNode = tint;
    } else {
      const texel = texture(map);
      colorNode = vec4(tint.mul(luminance(texel.rgb)), texel.a);
    }
    material.colorNode = colorNode as MeshBasicNodeMaterial['colorNode'];
    material.userData[TINT_SLOT_USER_DATA] = mapping.slot;
  }
  if (mask !== undefined) material.maskNode = regionVisibleNode(mask);
  return material;
}

function hasRegionId(geometry: BufferGeometry): boolean {
  return geometry.getAttribute(REGION_ID_ATTRIBUTE) !== undefined;
}

function setMeshMaterial(mesh: Mesh, material: Material | Material[]): void {
  mesh.material = material;
  const links = LINKS.get(mesh);
  if (links !== undefined) for (const clone of links) clone.material = material;
}

/**
 * Makes `clone` use the material of `source` now and after every later
 * {@link applyTintMaterial} / {@link restoreMaterials} on the source. Attach
 * functions call this for the meshes they clone from a cached part scene.
 *
 * @param source - Mesh of the registry-owned part scene.
 * @param clone - Mesh placed in the character.
 */
export function linkMaterial(source: Mesh, clone: Mesh): void {
  clone.material = source.material;
  let links = LINKS.get(source);
  if (links === undefined) {
    links = new Set();
    LINKS.set(source, links);
  }
  links.add(clone);
}

/**
 * Stops mirroring the source material into `clone` (see {@link linkMaterial}).
 *
 * @param source - Source mesh.
 * @param clone - Linked clone.
 */
export function unlinkMaterial(source: Mesh, clone: Mesh): void {
  LINKS.get(source)?.delete(clone);
}

/**
 * Replaces the materials of every mesh of the part's scene with unlit node
 * materials (REQ-CMP-013/014): a material named in `map` gets the tint of its
 * slot in the mapping's mode (default `multiply`); other materials keep their
 * base color and map and ignore tints. With `mask`, meshes whose geometry has
 * the Float32 `regionId` attribute (bodies, REQ-AST-028) discard the
 * fragments of hidden regions (REQ-CMP-011), in color and in every MRT output.
 *
 * Calling it again rebuilds from the original materials and disposes the ones
 * it created before. Originals stay owned by the registry. Meshes linked with
 * {@link linkMaterial} follow.
 *
 * @param part - Loaded part (its `scene` is modified in place).
 * @param map - The part entry's `tintSlots`.
 * @param uniforms - Uniforms from {@link createTintUniforms}.
 * @param mask - Region mask from `createRegionMask`, for bodies.
 */
export const applyTintMaterial: ApplyTintMaterial = (
  part,
  map,
  uniforms,
  mask,
) => {
  const byName = new Map<string, TintMapping>();
  for (const mapping of map) byName.set(mapping.material, mapping);
  const maskNode = mask === undefined ? undefined : maskNodeOf(mask);

  const meshes: Mesh[] = [];
  part.scene.traverse(object => {
    if (isMesh(object)) meshes.push(object);
  });
  for (const mesh of meshes) {
    let state = STATE.get(mesh);
    if (state === undefined) {
      state = {original: mesh.material, created: []};
      STATE.set(mesh, state);
    }
    for (const material of state.created) material.dispose();
    const meshMask = hasRegionId(mesh.geometry) ? maskNode : undefined;
    const build = (source: Material) =>
      buildMaterial(source, byName.get(source.name), uniforms, meshMask);
    const next = Array.isArray(state.original)
      ? state.original.map(build)
      : build(state.original);
    state.created = Array.isArray(next) ? next : [next];
    setMeshMaterial(mesh, next);
  }
};

/**
 * Restores the original materials of a part tinted by
 * {@link applyTintMaterial} and disposes the materials it created.
 *
 * @param scene - The part scene passed as `part.scene`.
 */
export function restoreMaterials(scene: Object3D): void {
  scene.traverse(object => {
    if (!isMesh(object)) return;
    const state = STATE.get(object);
    if (state === undefined) return;
    for (const material of state.created) material.dispose();
    STATE.delete(object);
    setMeshMaterial(object, state.original);
  });
}
