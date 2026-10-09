/**
 * Tint materials (spec 001 REQ-CMP-013, REQ-CMP-014) with optional body region
 * hides (REQ-CMP-011). Without {@link TintMaterialOptions} the materials are
 * the unlit M1 `MeshBasicNodeMaterial`s (m1-plan 2.2). With options they are
 * the pixel-pipeline toon materials of spec 003 (`createToonMaterial`,
 * REQ-PIX-011..013, A8 sub-cutoff discard): same tint and hide semantics, lit
 * by the view-space toon ramp and writing the scene MRT outputs. Part textures
 * are sampled with mipmaps (REQ-PIX-038). Works on WebGPU and on WebGL2
 * (`forceWebGL`): TSL only, no raw GLSL.
 */
import {
  Color,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
} from 'three';
import type {
  BufferGeometry,
  Material,
  Mesh,
  Object3D,
  Texture,
  TextureFilter,
} from 'three';
import {texture, uniform, vec3, vec4} from 'three/tsl';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {Node, UniformNode} from 'three/webgpu';
import {TINT_SLOTS} from '@csg/parts-schema';
import type {HexColor, PartEntry, TintSlot} from '@csg/parts-schema';
import type {
  ApplyTintMaterial,
  CreateTintUniforms,
  MaterialLinker,
  RegionMask,
  TintUniforms,
  UniformRef,
} from '../contracts/composition';
import type {SettingsBinder} from '../pipeline/settings-binder';
import {createStageContext} from '../pipeline/stage-context';
import {createToonMaterial} from '../pipeline/toon-material';
import type {PartLighting} from '../pipeline/toon-material';
import {REGION_ID_ATTRIBUTE, regionVisibleNode} from './region-mask';

/** Tint mode when a mapping omits `mode` (REQ-CMP-014). */
export const DEFAULT_TINT_MODE = 'multiply';

/** Key of `material.userData` that records the tint slot of a tinted material. */
export const TINT_SLOT_USER_DATA = 'tintSlot';

/**
 * Pixel-pipeline options of {@link applyTintMaterial}: with them the part
 * materials become toon materials (spec 003) bound to the renderer's binder.
 */
export interface TintMaterialOptions {
  /** The renderer's settings binder (shared `alpha.cutoff`, toon, rim, light uniforms). */
  readonly binder: SettingsBinder;
  /** Active backend. */
  readonly backend: 'webgpu' | 'webgl2';
  /** Compile mode (default `preview`). */
  readonly mode?: 'preview' | 'export' | 'node-preview';
  /** `toon` (default) or `unlit` (emissive-only test material, AC-PIX-024.1). */
  readonly lighting?: PartLighting;
}

/** The four mipmapped minification filters (REQ-PIX-038). */
const MIPMAP_FILTERS: ReadonlySet<TextureFilter> = new Set<TextureFilter>([
  NearestMipmapNearestFilter,
  NearestMipmapLinearFilter,
  LinearMipmapNearestFilter,
  LinearMipmapLinearFilter,
]);

/**
 * Makes a texture sample with mipmaps (REQ-PIX-038): keeps a mipmapped
 * `minFilter` (the glTF sampler's), replaces any other with
 * `LinearMipmapLinearFilter`, and turns on mipmap generation unless the
 * texture carries its own mip chain. Idempotent; never touches pipeline
 * render targets or the palette LUT (those stay nearest, REQ-PIX-002).
 *
 * Mutates `map`: the tint materials call it only on their own clones
 * ({@link mipmappedTexture}), never on registry-owned textures (review L7).
 *
 * @param map - Texture (mutated in place).
 * @returns `true` if something changed.
 */
export function ensureMipmapped(map: Texture): boolean {
  let changed = false;
  if (!MIPMAP_FILTERS.has(map.minFilter)) {
    map.minFilter = LinearMipmapLinearFilter;
    changed = true;
  }
  if (!map.generateMipmaps && map.mipmaps.length === 0) {
    map.generateMipmaps = true;
    changed = true;
  }
  if (changed && map.image !== null && map.image !== undefined) {
    map.needsUpdate = true;
  }
  return changed;
}

/** Whether {@link ensureMipmapped} would change `map`. */
function needsMipmaps(map: Texture): boolean {
  return (
    !MIPMAP_FILTERS.has(map.minFilter) ||
    (!map.generateMipmaps && map.mipmaps.length === 0)
  );
}

/** Mipmapped clone of a registry texture and the materials using it. */
interface MipmappedClone {
  readonly texture: Texture;
  users: number;
}

/** Registry texture → its mipmapped clone (shared by every material using it). */
const MIPMAPPED = new WeakMap<Texture, MipmappedClone>();

/**
 * The texture a part material samples (REQ-PIX-038) without mutating the
 * registry-owned `map` (review L7): `map` itself when it already samples
 * with mipmaps, else a clone (sharing the image source) that
 * {@link ensureMipmapped} prepared. Clones are shared per source texture and
 * reference-counted; {@link releaseMipmappedTexture} disposes one with its
 * last user. Sampling is the same as mutating `map` in place, so pixels do
 * not change.
 *
 * @param map - Registry-owned part texture (not modified).
 * @returns The texture to sample; pass it to {@link releaseMipmappedTexture}
 *   when the material is disposed.
 */
export function mipmappedTexture(map: Texture): Texture {
  if (!needsMipmaps(map)) return map;
  let entry = MIPMAPPED.get(map);
  if (entry === undefined) {
    const texture = map.clone();
    ensureMipmapped(texture);
    entry = {texture, users: 0};
    MIPMAPPED.set(map, entry);
  }
  entry.users++;
  return entry.texture;
}

/**
 * Releases a texture returned by {@link mipmappedTexture}: a clone is
 * disposed with its last user; `map` itself is never disposed.
 *
 * @param map - The registry texture passed to {@link mipmappedTexture}.
 * @param used - The texture it returned.
 */
export function releaseMipmappedTexture(map: Texture, used: Texture): void {
  if (used === map) return;
  const entry = MIPMAPPED.get(map);
  if (entry === undefined || entry.texture !== used) return;
  entry.users--;
  if (entry.users <= 0) {
    MIPMAPPED.delete(map);
    used.dispose();
  }
}

/** Registry texture and the texture a created material samples instead. */
type TextureUse = readonly [source: Texture, used: Texture];

/** Creates the sampled texture for `source`'s map and records the use. */
function useMap(source: Material, uses: TextureUse[]): Texture | null {
  const map = mapOf(source);
  if (map === null) return null;
  const used = mipmappedTexture(map);
  uses.push([map, used]);
  return used;
}

/** One mapping of `PartEntry.tintSlots`. */
type TintMapping = PartEntry['tintSlots'][number];

/** Materials of one mesh before tinting, and the ones this module created. */
interface MeshTintState {
  readonly original: Material | Material[];
  created: Material[];
  /** Textures the created materials sample (released with them). */
  textures: TextureUse[];
}

/** Disposes the materials created for a mesh and releases their textures. */
function disposeCreated(state: MeshTintState): void {
  for (const material of state.created) material.dispose();
  for (const [map, used] of state.textures) releaseMipmappedTexture(map, used);
  state.created = [];
  state.textures = [];
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
 * Creates one tint color uniform (a per-part override, REQ-CMP-015).
 *
 * @param hex - Initial `#rrggbb` color (sRGB).
 * @returns The uniform node.
 */
export function createTintUniform(hex: HexColor): UniformNode<'color', Color> {
  return uniform(new Color(hex));
}

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
 * - `multiply`: `texel.rgb × tint`, alpha from the texel: a white tint keeps
 *   the authored texture colours; without a map the texel is white, so the
 *   result is the tint (AC-CMP-014.1, REQ-CMP-014 as amended 2026-10-09).
 * - `replace`: the flat tint color (AC-CMP-014.2) with the texel's alpha, so
 *   cut-out cards (hair, leaves) keep their silhouette (PM decision, M2-16);
 *   without a map the alpha is 1.
 *
 * The base color factor is ignored by tinted materials: the tint is the color.
 */
function buildMaterial(
  source: Material,
  mapping: TintMapping | undefined,
  uniforms: TintUniforms,
  mask: UniformNode<'float', number> | undefined,
  uses: TextureUse[],
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.name = source.name;
  material.side = source.side;
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.alphaTest = source.alphaTest;
  material.depthWrite = source.depthWrite;
  material.depthTest = source.depthTest;
  const map = useMap(source, uses);
  if (mapping === undefined) {
    material.color.copy(colorOf(source));
    material.map = map;
  } else {
    const tint = colorNodeOf(uniforms[mapping.slot]);
    const mode = mapping.mode ?? DEFAULT_TINT_MODE;
    let colorNode: Node;
    if (map === null) {
      colorNode = tint;
    } else if (mode === 'replace') {
      colorNode = vec4(tint, texture(map).a);
    } else {
      const texel = texture(map);
      colorNode = vec4(texel.rgb.mul(tint as unknown as Node<'vec3'>), texel.a);
    }
    material.colorNode = colorNode as MeshBasicNodeMaterial['colorNode'];
    material.userData[TINT_SLOT_USER_DATA] = mapping.slot;
  }
  if (mask !== undefined) material.maskNode = regionVisibleNode(mask);
  return material;
}

/**
 * Builds the toon material for one source material (spec 003). The base
 * color is the M1 tint logic over the `part.albedo` and `tint.<slot>`
 * builtins of a material compile context:
 *
 * - No mapping: base color factor × albedo (texel RGBA); tints ignored.
 * - `multiply`: `vec4(albedo.rgb × tint, albedo.a)` (REQ-CMP-014 as amended
 *   2026-10-09: a white tint shows the authored texture colours).
 * - `replace`: `vec4(tint, albedo.a)`: the flat tint with the texel alpha, so
 *   cut-out cards keep their silhouette (PM decision, M2-16; alpha 1 without
 *   a map).
 *
 * The source `opacity` scales the alpha, which is then tested against the
 * shared `alpha.cutoff` (A8). The region mask, when given, is an extra
 * discard (REQ-CMP-011), so hidden fragments write no MRT output either.
 */
function buildToonMaterial(
  source: Material,
  mapping: TintMapping | undefined,
  uniforms: TintUniforms,
  mask: UniformNode<'float', number> | undefined,
  options: TintMaterialOptions,
  uses: TextureUse[],
): MeshBasicNodeMaterial {
  const map = useMap(source, uses);
  const albedo = (
    map === null ? vec4(1, 1, 1, 1) : texture(map)
  ) as Node<'vec4'>;
  const tints: Partial<Record<TintSlot, Node>> = {};
  if (mapping !== undefined)
    tints[mapping.slot] = colorNodeOf(uniforms[mapping.slot]);
  const ctx = createStageContext({
    binder: options.binder,
    target: 'material',
    mode: options.mode ?? 'preview',
    backend: options.backend,
    sources: {'part.albedo': albedo},
    tints,
  });
  const part = ctx.builtin('part.albedo') as Node<'vec4'>;
  let base: Node<'vec4'>;
  if (mapping === undefined) {
    const c = colorOf(source);
    base = vec4(c.r, c.g, c.b, 1).mul(part);
  } else {
    const tint = vec3(ctx.builtin(`tint.${mapping.slot}`) as Node<'vec3'>);
    const mode = mapping.mode ?? DEFAULT_TINT_MODE;
    base =
      mode === 'replace'
        ? vec4(tint, part.a)
        : vec4(tint.mul(part.rgb), part.a);
  }
  if (source.opacity !== 1) base = vec4(base.rgb, base.a.mul(source.opacity));
  const material = createToonMaterial({
    ctx,
    base,
    lighting: options.lighting ?? 'toon',
    visible: mask === undefined ? undefined : regionVisibleNode(mask),
    name: source.name,
    side: source.side,
  });
  if (mapping !== undefined)
    material.userData[TINT_SLOT_USER_DATA] = mapping.slot;
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
 * With `options` the materials are pixel-pipeline toon materials instead
 * (spec 003 REQ-PIX-011..013, A8): lit by the view-space toon ramp of the
 * binder's uniforms, sub-cutoff fragments discarded, opaque, writing the
 * scene MRT outputs (`createSceneMrt`). Part textures always sample with
 * mipmaps (REQ-PIX-038), through a mipmapped clone when the registry texture
 * has none ({@link mipmappedTexture}; the registry texture is not modified).
 *
 * Calling it again rebuilds from the original materials and disposes the ones
 * it created before. Originals stay owned by the registry. Meshes linked with
 * {@link linkMaterial} follow.
 *
 * @param part - Loaded part (its `scene` is modified in place).
 * @param map - The part entry's `tintSlots`.
 * @param uniforms - Uniforms from {@link createTintUniforms}.
 * @param mask - Region mask from `createRegionMask`, for bodies.
 * @param options - Pixel-pipeline binding; omitted = unlit M1 materials.
 */
export function applyTintMaterial(
  part: Parameters<ApplyTintMaterial>[0],
  map: Parameters<ApplyTintMaterial>[1],
  uniforms: TintUniforms,
  mask?: RegionMask,
  options?: TintMaterialOptions,
): void {
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
      state = {original: mesh.material, created: [], textures: []};
      STATE.set(mesh, state);
    }
    disposeCreated(state);
    const meshMask = hasRegionId(mesh.geometry) ? maskNode : undefined;
    const uses = state.textures;
    const build = (source: Material) =>
      options === undefined
        ? buildMaterial(
            source,
            byName.get(source.name),
            uniforms,
            meshMask,
            uses,
          )
        : buildToonMaterial(
            source,
            byName.get(source.name),
            uniforms,
            meshMask,
            options,
            uses,
          );
    const next = Array.isArray(state.original)
      ? state.original.map(build)
      : build(state.original);
    state.created = Array.isArray(next) ? next : [next];
    setMeshMaterial(mesh, next);
  }
}

applyTintMaterial satisfies ApplyTintMaterial;

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
    disposeCreated(state);
    STATE.delete(object);
    setMeshMaterial(object, state.original);
  });
}

/** Options of {@link createPartMaterials}. */
export interface PartMaterialsOptions {
  /** The part entry's `tintSlots` (material name to tint slot and mode). */
  readonly tintSlots: PartEntry['tintSlots'];
  /** One color uniform per tint slot: shared character tints or per-part overrides. */
  readonly uniforms: TintUniforms;
  /** Region mask uniform, read by meshes that carry `regionId` (bodies). */
  readonly mask?: RegionMask;
  /** Pixel-pipeline binding (toon materials); omitted = the unlit M1 materials. */
  readonly material?: TintMaterialOptions;
}

/**
 * Materials of one part owned by one character assembly (M3-05): built from
 * the part's original (registry) materials, given to the meshes that
 * {@link MaterialLinker.link} receives, never assigned to the registry scene.
 * Two assemblies (two renderers) on one registry therefore keep their own
 * tints, masks and toon bindings, and the cached part scenes stay unmodified.
 */
export interface PartMaterials extends MaterialLinker {
  /**
   * Rebuilds every material (new uniforms, a new toon binding or a different
   * set of overridden tint slots) and reassigns it to the linked clones; the
   * previous materials are disposed.
   *
   * @param next - Changed options; omitted fields keep their value.
   */
  rebuild(next: Partial<Omit<PartMaterialsOptions, 'tintSlots'>>): void;
  /** Number of materials currently built (tests, diagnostics). */
  readonly materialCount: number;
  /**
   * Disposes the materials it built and releases their textures; linked
   * clones get their source mesh's original material back.
   */
  dispose(): void;
}

/** Built materials of one source mesh and the clones that show them. */
interface SourceMaterials {
  material: Material | Material[];
  created: Material[];
  textures: TextureUse[];
  readonly clones: Set<Mesh>;
}

/**
 * Creates the materials of one part for one assembly (see {@link PartMaterials}).
 * Each source mesh of `part.scene` gets materials built lazily on first
 * {@link MaterialLinker.link}, with the same tint, hide and toon semantics as
 * {@link applyTintMaterial} (REQ-CMP-011/013/014, spec 003). The source
 * materials are read, never replaced.
 *
 * @param part - Loaded part (its scene is read only).
 * @param options - Tint mapping, uniforms, mask and toon binding.
 * @returns The part's material set.
 */
export function createPartMaterials(
  part: Parameters<ApplyTintMaterial>[0],
  options: PartMaterialsOptions,
): PartMaterials {
  const byName = new Map<string, TintMapping>();
  for (const mapping of options.tintSlots)
    byName.set(mapping.material, mapping);
  let uniforms = options.uniforms;
  let mask = options.mask;
  let material = options.material;
  const sources = new Map<Mesh, SourceMaterials>();
  let disposed = false;

  /** The registry material of a source mesh (the original even if M1 code re-tinted it). */
  const originalOf = (source: Mesh): Material | Material[] =>
    STATE.get(source)?.original ?? source.material;

  const build = (source: Mesh, state: SourceMaterials): void => {
    const maskNode =
      mask !== undefined && hasRegionId(source.geometry)
        ? maskNodeOf(mask)
        : undefined;
    const uses: TextureUse[] = [];
    const one = (m: Material): Material =>
      material === undefined
        ? buildMaterial(m, byName.get(m.name), uniforms, maskNode, uses)
        : buildToonMaterial(
            m,
            byName.get(m.name),
            uniforms,
            maskNode,
            material,
            uses,
          );
    const original = originalOf(source);
    const next = Array.isArray(original) ? original.map(one) : one(original);
    state.material = next;
    state.created = Array.isArray(next) ? next : [next];
    state.textures = uses;
  };

  const release = (state: SourceMaterials): void => {
    for (const m of state.created) m.dispose();
    for (const [map, used] of state.textures)
      releaseMipmappedTexture(map, used);
    state.created = [];
    state.textures = [];
  };

  return {
    link(source, clone) {
      if (disposed) throw new Error('createPartMaterials: disposed');
      let state = sources.get(source);
      if (state === undefined) {
        state = {
          material: source.material,
          created: [],
          textures: [],
          clones: new Set(),
        };
        build(source, state);
        sources.set(source, state);
      }
      state.clones.add(clone);
      clone.material = state.material;
    },

    unlink(source, clone) {
      sources.get(source)?.clones.delete(clone);
    },

    rebuild(next) {
      if (disposed) return;
      if (next.uniforms !== undefined) uniforms = next.uniforms;
      if ('mask' in next) mask = next.mask;
      if ('material' in next) material = next.material;
      for (const [source, state] of sources) {
        release(state);
        build(source, state);
        for (const clone of state.clones) clone.material = state.material;
      }
    },

    get materialCount() {
      let n = 0;
      for (const state of sources.values()) n += state.created.length;
      return n;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [source, state] of sources) {
        release(state);
        const original = originalOf(source);
        for (const clone of state.clones) clone.material = original;
        state.clones.clear();
      }
      sources.clear();
    },
  };
}
