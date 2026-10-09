/**
 * Engine implementation of `CompileContext` (spec 007 Data and contracts,
 * REQ-PIX-035, m2-plan 2.4). Pipeline stages and, from M4, compiled graphs
 * read builtins and uniforms only through this context.
 *
 * Create one context per compile: builtin nodes are cached per context (same
 * name ⇒ same node during one compile), uniforms live in the shared
 * {@link SettingsBinder} (same key ⇒ same node across compiles, so a value
 * change never recompiles, AC-PIX-034.1).
 */
import {
  float,
  floor,
  int,
  normalView,
  screenCoordinate,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {TINT_SLOTS} from '@csg/parts-schema';
import type {RenderSettings, TintSlot} from '@csg/parts-schema';
import type {Node} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import type {SettingsBinder, UniformSocketType} from './settings-binder';

/** Builtins the host supplies (scene pass textures, material inputs). */
export const HOST_BUILTINS = [
  'part.albedo',
  'partId',
  'scene.color',
  'scene.normal',
  'scene.depth',
  'scene.partId',
  'scene.light',
] as const;

/** Name of a host-supplied builtin. */
export type HostBuiltin = (typeof HOST_BUILTINS)[number];

/** Builtins the context derives itself (spec 007 list plus M2-01 A4). */
export const ENGINE_BUILTINS = [
  'normal',
  'viewDir',
  'light.dir',
  'uv',
  'screenPos',
  'resolution',
  'texelSize',
  'time',
  'render.paletteLut',
  'render.paletteDarkest',
  'render.paletteEnabled',
  'render.ditherMode',
  'render.ditherStrength',
  'render.alphaCutoff',
] as const;

/** Name of an engine-derived builtin. */
export type EngineBuiltin = (typeof ENGINE_BUILTINS)[number];

/** Builtins valid only when compiling a material (spec 007 Built-in values, target M). */
const MATERIAL_ONLY: ReadonlySet<string> = new Set([
  'normal',
  'viewDir',
  'part.albedo',
  'partId',
]);

/** Builtins valid only when compiling the post pipeline (spec 007 Built-in values, target P). */
const POST_ONLY: ReadonlySet<string> = new Set([
  'scene.light',
  'scene.color',
  'scene.normal',
  'scene.depth',
  'scene.partId',
  'render.paletteLut',
  'render.paletteEnabled',
  'render.paletteDarkest',
  'render.ditherMode',
  'render.ditherStrength',
  'render.alphaCutoff',
]);

const ENGINE_SET: ReadonlySet<string> = new Set(ENGINE_BUILTINS);
const TINT_SET: ReadonlySet<string> = new Set(TINT_SLOTS);

/** Options of {@link createStageContext}. */
export interface StageContextOptions {
  /** Shared uniform owner (one per renderer). */
  readonly binder: SettingsBinder;
  /** Pipeline part being compiled. */
  readonly target: CompileContext['target'];
  /** Preview, deterministic export or the node-editor preview. */
  readonly mode: CompileContext['mode'];
  /** Active backend. */
  readonly backend: CompileContext['backend'];
  /** Host-supplied builtins; a missing one throws when requested. */
  readonly sources?: Readonly<Partial<Record<HostBuiltin, TslNode>>>;
  /** `tint.<slot>` builtins (material target; `createTintUniforms`). */
  readonly tints?: Readonly<Partial<Record<TintSlot, TslNode>>>;
}

/** The engine's `CompileContext`, with the typed dither mode stages read as a field default. */
export interface StageContext extends CompileContext {
  /** Shared binder of this context. */
  readonly binder: SettingsBinder;
  /** `palette.dither.mode` of the applied settings (`render.ditherMode`, a compile-time field default). */
  readonly ditherMode: RenderSettings['palette']['dither']['mode'];
  /**
   * `render.ditherMode` as a number for the `post.bayerDither@1` field
   * `matrix` default: 0 (none, or palette `none`), 2, 4 or 8.
   */
  readonly ditherMatrixSize: 0 | 2 | 4 | 8;
}

/**
 * Creates the engine `CompileContext` (spec 007 Built-in values, REQ-SGF-043,
 * REQ-PIX-035).
 *
 * Material (M): `normal` (`normalView`), `viewDir` (`vec3(0, 0, 1)`,
 * orthographic), `uv` (mesh UV), `tint.<slot>`, `part.albedo`, `partId` (host).
 * Both: `light.dir` (CPU-derived view-space uniform, REQ-PIX-013; in post
 * since FX-J for `post.rimEdge@1`), `screenPos` (`vec2` integer cell pixel, top-left origin), `resolution`
 * (`vec2` W, H), `texelSize`, `time` (host-set uniform in preview, constant 0
 * in export, REQ-SGF-032); in post `uv` is `(screenPos + 0.5) / resolution`.
 * Post (P): `scene.color|normal|depth|partId|light` (host; `scene.light` is
 * the float band brightness `light_k`, spec 007), `render.paletteLut`,
 * `render.paletteDarkest` (linear RGBA, A = 1), `render.paletteEnabled` (bool),
 * `render.ditherMode` (`int` matrix size 0/2/4/8; the typed mode is
 * {@link StageContext.ditherMode}), `render.ditherStrength` and
 * `render.alphaCutoff` (the reserved uniforms `dither.strength` and
 * `alpha.cutoff`, spec 007 rule 3).
 *
 * @param options - Binder, target, mode, backend and host builtins.
 * @returns A context; `builtin()` throws on an unknown or unavailable name
 *   (becomes `SGF_EMIT_FAILED` in M4, AC-SGF-043.4).
 */
export function createStageContext(options: StageContextOptions): StageContext {
  const {binder, target, mode, backend, sources = {}, tints = {}} = options;
  const cache = new Map<string, TslNode>();
  const cached = (name: string): TslNode => {
    let node = cache.get(name);
    if (node === undefined) {
      node = resolve(name);
      cache.set(name, node);
    }
    return node;
  };

  const resolve = (name: string): TslNode => {
    if (name.startsWith('tint.')) {
      const slot = name.slice('tint.'.length);
      if (!TINT_SET.has(slot)) throw new Error(`unknown builtin "${name}"`);
      if (target !== 'material') {
        throw new Error(`builtin "${name}" is only available in materials`);
      }
      const node = tints[slot as TintSlot];
      if (node === undefined) {
        throw new Error(`builtin "${name}" is not supplied by the host`);
      }
      return node;
    }
    if (MATERIAL_ONLY.has(name) && target !== 'material') {
      throw new Error(`builtin "${name}" is only available in materials`);
    }
    if (POST_ONLY.has(name) && target !== 'post') {
      throw new Error(`builtin "${name}" is only available in post`);
    }
    if ((HOST_BUILTINS as readonly string[]).includes(name)) {
      const node = sources[name as HostBuiltin];
      if (node === undefined) {
        throw new Error(`builtin "${name}" is not supplied by the host`);
      }
      return node;
    }
    if (!ENGINE_SET.has(name)) throw new Error(`unknown builtin "${name}"`);
    switch (name as EngineBuiltin) {
      case 'normal':
        return normalView;
      case 'viewDir':
        return vec3(0, 0, 1);
      case 'light.dir':
        return binder.lightDir;
      case 'uv':
        return target === 'material'
          ? uv()
          : (cached('screenPos') as Node<'vec2'>)
              .add(0.5)
              .div(binder.resolution);
      case 'screenPos':
        // three flips WebGL frag coords to the WebGPU top-left convention;
        // frag coords are pixel centers (x + 0.5), floor gives the index.
        return vec2(floor(screenCoordinate));
      case 'resolution':
        return binder.resolution;
      case 'texelSize':
        return vec2(1, 1).div(binder.resolution);
      case 'time':
        return mode === 'export' ? float(0) : binder.time;
      case 'render.paletteLut':
        return binder.paletteLutNode();
      case 'render.paletteDarkest':
        return vec4(binder.paletteDarkest, 1);
      case 'render.paletteEnabled':
        return binder.paletteEnabled;
      case 'render.ditherMode':
        return int(binder.ditherMatrixSize);
      case 'render.ditherStrength':
        return binder.uniform('dither.strength', 'float', undefined);
      case 'render.alphaCutoff':
        return binder.uniform('alpha.cutoff', 'float', undefined);
    }
  };

  return {
    target,
    mode,
    backend,
    binder,
    get ditherMatrixSize() {
      return binder.ditherMatrixSize;
    },
    get ditherMode() {
      return binder.settings?.palette.dither.mode ?? 'none';
    },
    builtin: cached,
    uniform(key: string, type: UniformSocketType, initial: unknown): TslNode {
      return binder.uniform(key, type, initial);
    },
  };
}
