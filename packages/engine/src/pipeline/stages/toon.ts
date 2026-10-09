/**
 * Toon stages (spec 003 REQ-PIX-011, REQ-PIX-012, REQ-PIX-013 as amended by
 * A5; spec 006 `toon.ramp@1`, `toon.rim@1`; m2-plan 2.2). Emitter-shaped
 * (REQ-PIX-035): pure functions of the compile context, their input nodes and
 * their fields; they create no material and no render target.
 *
 * The CPU twins ({@link toonBandIndex}, {@link toonBandLight},
 * {@link toonRimValue}, {@link toonColor}) evaluate the same formulas in
 * JavaScript; tests use them as the oracle for the GPU output.
 *
 * Legacy: the material rim (`toon.rim@1`: {@link toonRim},
 * {@link toonCombine}, {@link toonRimValue}, {@link toonColor}) is the A5
 * look that FX-J (user D2) replaced with the screen-space post stage
 * `rimEdge` (`./rim`, `post.rimEdge@1`). It stays only for the spec 006
 * catalog entry and is deprecated; the built-in pipeline never uses it.
 *
 * Builtins: the emitters read `normal`, `viewDir` and `light.dir` through
 * `ctx.builtin`. In M2 the material stage context supplies them; in M4 the
 * graph compiler must supply the same builtins for user graphs (as it must
 * the post builtins `scene.*`, `screenPos` and `resolution` of the post
 * stages).
 */
import {clamp, dot, float, max, normalize, select, step, vec3} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {
  CompileContext,
  StageEmitter,
  TslNode,
} from '@csg/shader-graph/tsl';

/** Spec 006 catalog type of {@link toonRamp}. */
export const TOON_RAMP_NODE_TYPE = 'toon.ramp@1';

/** Spec 006 catalog type of {@link toonRim}. */
export const TOON_RIM_NODE_TYPE = 'toon.rim@1';

/** Input socket IDs of `toon.ramp@1`. */
export const TOON_RAMP_INPUTS = [
  'normal',
  'lightDir',
  'base',
  'steps',
  't1',
  't2',
  't3',
  'ambient',
] as const;

/** Output socket IDs of `toon.ramp@1`. */
export const TOON_RAMP_OUTPUTS = ['color', 'light'] as const;

/** Input socket IDs of `toon.rim@1`. */
export const TOON_RIM_INPUTS = [
  'normal',
  'viewDir',
  'lightDir',
  'width',
  'strength',
] as const;

/** Output socket IDs of `toon.rim@1`. */
export const TOON_RIM_OUTPUTS = ['rim'] as const;

/** Input IDs of {@link toonCombine} (math nodes in M4, no catalog entry). */
export const TOON_COMBINE_INPUTS = ['color', 'rim'] as const;

/** Output IDs of {@link toonCombine}. */
export const TOON_COMBINE_OUTPUTS = ['color'] as const;

/** An input socket ID of {@link toonRamp}. */
export type ToonRampInput = (typeof TOON_RAMP_INPUTS)[number];
/** An output socket ID of {@link toonRamp}. */
export type ToonRampOutput = (typeof TOON_RAMP_OUTPUTS)[number];
/** An input socket ID of {@link toonRim}. */
export type ToonRimInput = (typeof TOON_RIM_INPUTS)[number];
/** An output socket ID of {@link toonRim}. */
export type ToonRimOutput = (typeof TOON_RIM_OUTPUTS)[number];
/** An input ID of {@link toonCombine}. */
export type ToonCombineInput = (typeof TOON_COMBINE_INPUTS)[number];
/** An output ID of {@link toonCombine}. */
export type ToonCombineOutput = (typeof TOON_COMBINE_OUTPUTS)[number];

/**
 * `toon.ramp@1` (REQ-PIX-011, A5). With `λ = max(dot(N, L), 0)` the band
 * index `k` is the number of thresholds `t_j ≤ λ` among the first
 * `steps - 1` (`t2` counts only for `steps ≥ 3`, `t3` only for `steps = 4`),
 * so a value exactly on a threshold goes to the brighter band. Band
 * brightness `light = ambient + (1 - ambient) · k / (steps - 1)`, and
 * `color = base.rgb · light` (linear). Branch-free; identical in WGSL and
 * GLSL ES 3.0. `N` and `L` are normalized here, so unnormalized inputs are
 * safe.
 *
 * @param _ctx - Compile context (unused: everything arrives as inputs).
 * @param inputs - `normal`, `lightDir` (view space), `base` (linear RGB or
 *   RGBA; alpha is ignored), `steps` (int 2..4), `t1..t3`, `ambient`.
 * @returns `color` (vec3, linear) and `light` (the band brightness `light_k`).
 */
export const toonRamp: StageEmitter<ToonRampInput, ToonRampOutput> = (
  _ctx,
  inputs,
) => {
  const n = normalize(inputs.normal as Node<'vec3'>);
  const l = normalize(inputs.lightDir as Node<'vec3'>);
  const lambda = max(dot(n, l), float(0));
  const steps = float(inputs.steps as Node<'int'>);
  const t1 = inputs.t1 as Node<'float'>;
  const t2 = inputs.t2 as Node<'float'>;
  const t3 = inputs.t3 as Node<'float'>;
  // step(edge, x) = x >= edge ? 1 : 0, so t_j <= λ counts.
  const k = step(t1, lambda)
    .add(step(t2, lambda).mul(step(float(2.5), steps)))
    .add(step(t3, lambda).mul(step(float(3.5), steps)));
  const ambient = inputs.ambient as Node<'float'>;
  const light = ambient.add(
    float(1)
      .sub(ambient)
      .mul(k)
      .div(steps.sub(float(1))),
  );
  const base = vec3(inputs.base as Node<'vec3'>);
  return {color: base.mul(light), light};
};

/**
 * @deprecated Legacy `toon.rim@1` (A5 material rim), replaced by the
 * screen-space post stage {@link import('./rim').rimEdge | rimEdge}
 * (REQ-PIX-012 as amended by FX-J). Kept for the spec 006 catalog only.
 *
 * `toon.rim@1` (REQ-PIX-012, A5): `rim = step(1 - width, 1 - max(dot(N, V), 0))
 * · strength` where `dot(N, L) > 0`, and 0 elsewhere. With the orthographic
 * camera `V = (0, 0, 1)`, so `dot(N, V) = N.z`.
 *
 * @param _ctx - Compile context (unused).
 * @param inputs - `normal`, `viewDir`, `lightDir` (view space), `width`,
 *   `strength` (both 0..1).
 * @returns `rim`: 0 or `strength`.
 */
export const toonRim: StageEmitter<ToonRimInput, ToonRimOutput> = (
  _ctx,
  inputs,
) => {
  const n = normalize(inputs.normal as Node<'vec3'>);
  const v = normalize(inputs.viewDir as Node<'vec3'>);
  const l = normalize(inputs.lightDir as Node<'vec3'>);
  const width = inputs.width as Node<'float'>;
  const strength = inputs.strength as Node<'float'>;
  const facing = max(dot(n, v), float(0));
  const edge = step(float(1).sub(width), float(1).sub(facing)).mul(strength);
  return {rim: select(dot(n, l).greaterThan(float(0)), edge, float(0))};
};

/**
 * @deprecated Legacy A5 rim combine for `toon.rim@1`; the built-in look uses
 * {@link import('./rim').rimEdge | rimEdge} (FX-J).
 *
 * Combine of REQ-PIX-011 (A5): `clamp(color + rim, 0, 1)` per linear channel.
 * In M4 these are math nodes of `builtin:material-toon` (no catalog type).
 *
 * @param _ctx - Compile context (unused).
 * @param inputs - `color` (vec3, linear) and `rim` (float, added to RGB).
 * @returns `color` (vec3).
 */
export const toonCombine: StageEmitter<ToonCombineInput, ToonCombineOutput> = (
  _ctx,
  inputs,
) => {
  const color = vec3(inputs.color as Node<'vec3'>);
  const rim = inputs.rim as Node<'float'>;
  return {color: clamp(color.add(vec3(rim, rim, rim)), float(0), float(1))};
};

/**
 * Default inputs of {@link toonRamp} in `builtin:material-toon`: `normal`,
 * `light.dir`, and the reserved uniforms `toon.bands`, `toon.thresholds`
 * (split into `t1..t3`) and `light.ambient` (spec 007 reserved IDs).
 *
 * @param ctx - A material compile context.
 * @param base - Linear base color (tinted albedo, spec 001).
 * @returns The input record.
 */
export function defaultToonRampInputs(
  ctx: CompileContext,
  base: TslNode,
): Record<ToonRampInput, TslNode> {
  const thresholds = ctx.uniform('toon.thresholds', 'vec3', [
    1 / 3,
    2 / 3,
    2,
  ]) as Node<'vec3'>;
  return {
    normal: ctx.builtin('normal'),
    lightDir: ctx.builtin('light.dir'),
    base,
    steps: ctx.uniform('toon.bands', 'int', 3),
    t1: thresholds.x,
    t2: thresholds.y,
    t3: thresholds.z,
    ambient: ctx.uniform('light.ambient', 'float', 0.15),
  };
}

/**
 * Default inputs of {@link toonRim} for a material graph (catalog defaults): `normal`,
 * `viewDir`, `light.dir`, and the reserved uniforms `rim.width` and
 * `rim.strength`. The `rim.enabled` gate is applied by the caller
 * ({@link toonRimEnabled}).
 *
 * @param ctx - A material compile context.
 * @returns The input record.
 */
export function defaultToonRimInputs(
  ctx: CompileContext,
): Record<ToonRimInput, TslNode> {
  return {
    normal: ctx.builtin('normal'),
    viewDir: ctx.builtin('viewDir'),
    lightDir: ctx.builtin('light.dir'),
    width: ctx.uniform('rim.width', 'float', 0.2),
    strength: ctx.uniform('rim.strength', 'float', 0.5),
  };
}

/**
 * The `rim.enabled` gate for a material graph using `toon.rim@1` (spec 007:
 * `math.select@1` on `toon.rim@1.rim` in M4): the bool uniform as a node. The
 * built-in pipeline gates its post rim stage with the same uniform.
 *
 * @param ctx - A material compile context.
 * @returns Bool node.
 */
export function toonRimEnabled(ctx: CompileContext): TslNode {
  return ctx.uniform('rim.enabled', 'bool', false);
}

/**
 * `builtin:material-toon` color (REQ-PIX-011, REQ-PIX-013): the toon ramp
 * only. The rim is no longer a material term: since FX-J (user D2) it is the
 * screen-space post stage `rimLight` (`./rim`, REQ-PIX-012 as amended), so
 * `rim.*` uniforms do not affect the material. {@link toonRim} and
 * {@link toonCombine} stay available for user material graphs (spec 006
 * catalog `toon.rim@1`). Uniform values change without a recompile
 * (REQ-PIX-034).
 *
 * @param ctx - A material compile context.
 * @param base - Linear base color (vec3 or vec4; alpha ignored).
 * @returns Linear lit `color` (vec3) and the band brightness `light`
 *   (`light_k`, written to the scene MRT for `scene.light`).
 */
export function toonShade(
  ctx: CompileContext,
  base: TslNode,
): Record<ToonRampOutput, TslNode> {
  return toonRamp(ctx, defaultToonRampInputs(ctx, base), {});
}

// ---------------------------------------------------------------------------
// CPU twins (test oracles; not used on the render path).

/**
 * Band index `k` of REQ-PIX-011 (A5): the number of the first `bands - 1`
 * thresholds that are `≤ λ`.
 *
 * @param lambda - `max(dot(N, L), 0)`.
 * @param thresholds - Ascending thresholds; only the first `bands - 1` count.
 * @param bands - 2, 3 or 4.
 * @returns `k` in `0 .. bands - 1`.
 */
export function toonBandIndex(
  lambda: number,
  thresholds: readonly number[],
  bands: number,
): number {
  let k = 0;
  for (let j = 0; j < bands - 1; j++) {
    const t = thresholds[j];
    if (t !== undefined && t <= lambda) k++;
  }
  return k;
}

/**
 * Band brightness `light_k = ambient + (1 - ambient) · k / (bands - 1)`.
 *
 * @param k - Band index.
 * @param bands - 2, 3 or 4.
 * @param ambient - 0..1.
 * @returns `light_k`.
 */
export function toonBandLight(
  k: number,
  bands: number,
  ambient: number,
): number {
  return ambient + ((1 - ambient) * k) / (bands - 1);
}

/**
 * @deprecated CPU twin of the legacy `toon.rim@1`; the built-in rim is
 * {@link import('./rim').rimEdge | rimEdge} (oracles `rimMask`, `rimCombine`).
 *
 * Rim scalar of REQ-PIX-012 (A5) for unit view-space vectors.
 *
 * @param n - Unit normal.
 * @param l - Unit light direction.
 * @param width - Rim width 0..1.
 * @param strength - Rim strength 0..1.
 * @returns 0 or `strength`.
 */
export function toonRimValue(
  n: readonly [number, number, number],
  l: readonly [number, number, number],
  width: number,
  strength: number,
): number {
  const nl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
  if (nl <= 0) return 0;
  return 1 - Math.max(n[2], 0) >= 1 - width ? strength : 0;
}

/**
 * @deprecated CPU twin of the legacy A5 combine (`toon.rim@1`); the built-in
 * rim is {@link import('./rim').rimEdge | rimEdge} (oracle `rimCombine`).
 *
 * One linear channel of the toon color: `clamp(base · light_k + rim, 0, 1)`.
 *
 * @param base - Linear base channel.
 * @param light - `light_k`.
 * @param rim - Rim scalar.
 * @returns Clamped linear value.
 */
export function toonColor(base: number, light: number, rim: number): number {
  return Math.min(Math.max(base * light + rim, 0), 1);
}
