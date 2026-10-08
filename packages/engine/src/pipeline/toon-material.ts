/**
 * Toon part material and the scene-pass MRT layout (spec 003 REQ-PIX-011..014,
 * REQ-PIX-023 A8, REQ-PIX-024; m2-plan 2.2 and 2.3).
 *
 * Parts render with an unlit `MeshBasicNodeMaterial` whose `colorNode` is the
 * toon stage output ({@link toonShade}): lighting is a view-space uniform, not
 * a three.js light, so it is the same for every camera preset and direction
 * (REQ-PIX-013). Fragments whose alpha is below the shared `alpha.cutoff`
 * uniform are discarded in the material, so they write no color, depth,
 * normal or part ID (A8, AC-PIX-023.2/.3). Works on WebGPU and WebGL2: TSL
 * only, no raw GLSL.
 *
 * The scene pass writes three MRT attachments ({@link createSceneMrt}):
 * `output` (linear RGB, A = coverage), `normalDepth` (view normal, depth in
 * output pixels from the pivot plane) and `partId` (`Object3D.userData.partId`).
 */
import {FrontSide} from 'three';
import type {Side} from 'three';
import {
  float,
  mrt,
  output as materialOutput,
  normalView,
  positionView,
  uniform,
  userData,
  vec3,
  vec4,
} from 'three/tsl';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {MRTNode, Node, UniformNode} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import {toonShade} from './stages/toon';

/** MRT attachment names of the scene pass, in attachment order (m2-plan 2.3). */
export const SCENE_MRT_KEYS = ['output', 'normalDepth', 'partId'] as const;

/** One MRT attachment name of the scene pass. */
export type SceneMrtKey = (typeof SCENE_MRT_KEYS)[number];

/**
 * `Object3D.userData` key holding the part ID written to the `partId`
 * attachment (REQ-PIX-014; 1 = body, 0 = background). Every mesh rendered by
 * the scene pass must set it (the assembly does, from `partIdFor`).
 */
export const PART_ID_USER_DATA = 'partId';

/** `material.userData` key marking a material built by {@link createToonMaterial}. */
export const TOON_MATERIAL_USER_DATA = 'csgToon';

/** Lighting of a part material. */
export type PartLighting = 'toon' | 'unlit';

/**
 * Uniforms that turn view-space depth into output pixels from the pivot
 * plane (m2-plan 2.3, REQ-PIX-016 A9): `depth = (pivotDistance +
 * positionView.z) · pxPerWorld`, positive toward the camera.
 */
export interface SceneDepthUniforms {
  /** Distance from the camera to the pivot plane along the view axis (world units). */
  readonly pivotDistance: UniformNode<'float', number>;
  /** Output pixels per world unit (`1 / Framing.worldPerPx`). */
  readonly pxPerWorld: UniformNode<'float', number>;
}

/**
 * Creates the depth uniforms of the scene pass (one set per renderer).
 *
 * @returns Uniforms initialised to `pivotDistance = 0`, `pxPerWorld = 1`.
 */
export function createSceneDepthUniforms(): SceneDepthUniforms {
  return {pivotDistance: uniform(0), pxPerWorld: uniform(1)};
}

/**
 * Writes the camera-to-pivot distance and the framing scale into the depth
 * uniforms (no recompile).
 *
 * @param depth - Uniforms from {@link createSceneDepthUniforms}.
 * @param cameraDistance - Camera to pivot plane distance (world units, > 0).
 * @param worldPerPx - World units per output pixel (`Framing.worldPerPx`, > 0).
 */
export function setSceneDepth(
  depth: SceneDepthUniforms,
  cameraDistance: number,
  worldPerPx: number,
): void {
  depth.pivotDistance.value = cameraDistance;
  depth.pxPerWorld.value = 1 / worldPerPx;
}

/**
 * The per-fragment nodes of the scene MRT (m2-plan 2.3): `output` is the
 * material output; `normalDepth` = `vec4(normalView, depthPx)`; `partId` =
 * `vec4(userData.partId, 0, 0, 1)`. Evaluated in each object's material
 * context, after the material's discards.
 *
 * @param depth - Depth uniforms.
 * @returns One node per {@link SCENE_MRT_KEYS} entry, except `output`.
 */
export function sceneMrtNodes(
  depth: SceneDepthUniforms,
): Record<Exclude<SceneMrtKey, 'output'>, TslNode> {
  const depthPx = depth.pivotDistance.add(positionView.z).mul(depth.pxPerWorld);
  const partId = userData(
    PART_ID_USER_DATA,
    'float',
  ) as unknown as Node<'float'>;
  return {
    normalDepth: vec4(normalView, depthPx),
    partId: vec4(partId, float(0), float(0), float(1)),
  };
}

/**
 * The MRT node of the scene pass (`pass(...).setMRT(createSceneMrt(depth))`).
 * The attachment names equal the keys, as PassNode requires.
 *
 * @param depth - Depth uniforms.
 * @param output - Node for the `output` attachment (default: the material
 *   output, three's `output` node).
 * @returns The MRT node.
 */
export function createSceneMrt(
  depth: SceneDepthUniforms,
  output?: TslNode,
): MRTNode {
  const nodes = sceneMrtNodes(depth);
  return mrt({
    output: output ?? materialOutput,
    normalDepth: nodes.normalDepth,
    partId: nodes.partId,
  });
}

/** Options of {@link createToonMaterial}. */
export interface ToonMaterialOptions {
  /** Material compile context (shared binder: `alpha.cutoff`, toon/rim/light uniforms). */
  readonly ctx: CompileContext;
  /** Linear base color with alpha (`vec4`): tinted albedo (spec 001). */
  readonly base: TslNode;
  /** `toon` (default) shades with REQ-PIX-011..013; `unlit` outputs `base` (AC-PIX-024.1). */
  readonly lighting?: PartLighting;
  /** Extra visibility condition (bool node), e.g. the region mask (REQ-CMP-011). */
  readonly visible?: TslNode;
  /** Material name (copied from the source material). */
  readonly name?: string;
  /** Face culling (default `FrontSide`). */
  readonly side?: Side;
}

/**
 * Coverage test of the material (A8): `alpha >= alpha.cutoff`, the same
 * comparison as the post coverage stage, on the same uniform. three's own
 * `alphaTest` discards `alpha <= cutoff` and is therefore not used.
 *
 * @param ctx - Material compile context.
 * @param alpha - Material alpha.
 * @returns Bool node, true when covered.
 */
export function coveredNode(ctx: CompileContext, alpha: TslNode): TslNode {
  const cutoff = ctx.uniform('alpha.cutoff', 'float', 0.5) as Node<'float'>;
  return (alpha as Node<'float'>).greaterThanEqual(cutoff);
}

/**
 * Creates the part material of the pixel pipeline: unlit node material whose
 * color is the toon shade of `base` (or `base` itself when unlit), opaque,
 * with the sub-cutoff discard of A8 and an optional extra visibility test.
 * Covered fragments output alpha 1 (opaque material); discarded ones write
 * nothing to any attachment. Uniform changes never recompile it.
 *
 * @param options - Context, base color, lighting, visibility, name, side.
 * @returns A new material; the caller disposes it.
 */
export function createToonMaterial(
  options: ToonMaterialOptions,
): MeshBasicNodeMaterial {
  const {
    ctx,
    lighting = 'toon',
    visible,
    name = '',
    side = FrontSide,
  } = options;
  const base = vec4(options.base as Node<'vec4'>);
  const rgb =
    lighting === 'toon'
      ? (toonShade(ctx, base) as Node<'vec3'>)
      : vec3(base.rgb);

  const material = new MeshBasicNodeMaterial();
  material.name = name;
  material.side = side;
  material.colorNode = vec4(rgb, base.a) as MeshBasicNodeMaterial['colorNode'];
  const covered = coveredNode(ctx, base.a) as Node<'bool'>;
  material.maskNode = (
    visible === undefined ? covered : covered.and(visible as Node<'bool'>)
  ) as MeshBasicNodeMaterial['maskNode'];
  // A8: coverage is decided by the discard above; no blending, depth always.
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.depthTest = true;
  material.toneMapped = false;
  material.fog = false;
  material.userData[TOON_MATERIAL_USER_DATA] = lighting;
  return material;
}
