/**
 * Screen-space rim edge stage (spec 003 REQ-PIX-012 and REQ-PIX-025 as
 * amended by FX-J, user D2 "brighter + punchier"; spec 006 `post.rimEdge@1`).
 * Emitter-shaped (REQ-PIX-035): a pure function of the compile context, its
 * input nodes and its fields; it creates no material and no render target.
 *
 * - Rim offset: the screen-projected light `L.xy` quantized to one of the 8
 *   neighbours ({@link rimOffset}); none when `|L.xy| < 1e-6`.
 * - Rim pixel: a covered pixel `p` whose neighbour `p + o` is uncovered
 *   (positions outside the cell count as uncovered).
 * - Combine (PM decision FX-J, 2026-10-09): with the material band
 *   brightness `light = light_k` (builtin `scene.light`) and the pixel colour
 *   `c = base · light_k`, the rim colour is
 *   `clamp(base · (light_k + strength), 0, 1) = clamp(c · (light_k + strength)
 *   / light_k, 0, 1)` per linear channel, so the rim stays visible on the
 *   brightest band; pixels with `light_k = 0` keep their colour.
 *
 * `rim.enabled`, `rim.strength` and the light direction are uniforms: no
 * recompile when they change (REQ-PIX-034). The CPU twins
 * ({@link rimOffset}, {@link rimMask}, {@link rimCombine}) are the test
 * oracles.
 */
import {
  clamp,
  float,
  ivec2,
  length,
  max,
  select,
  step,
  vec2,
  vec4,
} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {
  CompileContext,
  StageEmitter,
  TslNode,
} from '@csg/shader-graph/tsl';
import {loadSceneTexel, pick, sceneTexture} from './edge-detect';

/** Spec 006 catalog type of the stage. */
export const RIM_EDGE_NODE_TYPE = 'post.rimEdge@1';

/** Input socket IDs of `post.rimEdge@1` (spec 006, AC-SGF-043.6). */
export const RIM_EDGE_INPUTS = [
  'color',
  'coverage',
  'cutoff',
  'lightDir',
  'light',
  'strength',
  'enabled',
] as const;

/** Output socket IDs of `post.rimEdge@1`. */
export const RIM_EDGE_OUTPUTS = ['color', 'rim'] as const;

/** An input socket ID of {@link rimEdge}. */
export type RimEdgeInput = (typeof RIM_EDGE_INPUTS)[number];

/** An output socket ID of {@link rimEdge}. */
export type RimEdgeOutput = (typeof RIM_EDGE_OUTPUTS)[number];

/** `|L.xy|` below this means "light from the viewer": no rim offset (REQ-PIX-012 note). */
export const RIM_MIN_SCREEN_LIGHT = 1e-6;

/**
 * `cos(67.5°) = sin(22.5°)`: a normalized screen light component at or above
 * it puts the offset on that side of the axis (sector boundaries at
 * `22.5° + k · 45°`).
 */
const SECTOR_EDGE = 0.3826834323650898;

/** The 8 offsets of the sectors `d = 0..7` (REQ-PIX-012 note), top-left pixel coordinates. */
const SECTOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * `post.rimEdge@1`; see the module comment.
 *
 * The neighbour coverage is read from the alpha of `scene.color` at
 * `screenPos + o` (the source of the catalog default of `coverage`), with the
 * same `cutoff`; `o` is computed per pixel from the `lightDir` uniform (8-way,
 * branch-free), so a light change never recompiles.
 *
 * @param ctx - Post compile context (`scene.color`, `screenPos`, `resolution`).
 * @param inputs - `color` (linear RGBA, normally from `post.alphaCutoff@1`),
 *   `coverage` (this pixel's coverage alpha), `cutoff`, `lightDir` (view
 *   space), `light` (`scene.light`), `strength`, `enabled` (bool).
 * @param _fields - No fields.
 * @returns `color` (rim pixels brightened, alpha kept) and `rim` (0/1).
 */
export const rimEdge: StageEmitter<RimEdgeInput, RimEdgeOutput> = (
  ctx,
  inputs,
  _fields,
) => {
  const color = inputs.color as Node<'vec4'>;
  const cutoff = inputs.cutoff as Node<'float'>;
  const l = inputs.lightDir as Node<'vec3'>;
  const light = inputs.light as Node<'float'>;
  const strength = inputs.strength as Node<'float'>;
  const enabled = select(inputs.enabled as Node<'bool'>, float(1), float(0));

  // Rim offset (top-left coordinates, y down): 8-way quantization of L.xy.
  const len = length(vec2(l.x, l.y));
  const hasOffset = step(float(RIM_MIN_SCREEN_LIGHT), len);
  const safeLen = max(len, float(RIM_MIN_SCREEN_LIGHT));
  const nx = l.x.div(safeLen);
  const ny = l.y.div(safeLen);
  const dx = step(float(SECTOR_EDGE), nx).sub(
    step(float(SECTOR_EDGE), nx.negate()),
  );
  const dy = step(float(SECTOR_EDGE), ny.negate()).sub(
    step(float(SECTOR_EDGE), ny),
  );

  // Neighbour coverage at p + o (off-cell = uncovered).
  const tex = sceneTexture(ctx, 'scene.color');
  const px = ctx.builtin('screenPos') as Node<'vec2'>;
  const last = (ctx.builtin('resolution') as Node<'vec2'>).sub(1);
  const q = px.add(vec2(dx, dy));
  const inCell = step(float(0), q.x)
    .mul(step(float(0), q.y))
    .mul(step(q.x, last.x))
    .mul(step(q.y, last.y));
  const fetched = tex.load(
    ivec2(clamp(q, vec2(0, 0), last)),
  ) as unknown as Node<'vec4'>;
  const neighbourCovered = step(cutoff, fetched.a).mul(inCell);

  const covered = step(cutoff, inputs.coverage as Node<'float'>);
  const rim = covered
    .mul(float(1).sub(neighbourCovered))
    .mul(hasOffset)
    .mul(enabled);

  // clamp(base · (light_k + strength)) with base = c / light_k; light_k = 0 keeps c.
  const lit = step(float(1e-6), light);
  const scale = light.add(strength).div(max(light, float(1e-6)));
  const brightened = vec4(
    clamp(color.rgb.mul(scale), float(0), float(1)),
    color.a,
  );
  return {color: pick(color, brightened, rim.mul(lit)), rim};
};

/**
 * Default inputs of {@link rimEdge} in the built-in post pipeline (spec 006
 * catalog defaults): `coverage ← scene.color` alpha at this pixel,
 * `cutoff ← render.alphaCutoff`, `lightDir ← light.dir`,
 * `light ← scene.light`, and the reserved uniforms `rim.strength`,
 * `rim.enabled` (spec 007).
 *
 * @param ctx - A post compile context.
 * @returns Every input except `color`.
 */
export function defaultRimEdgeInputs(
  ctx: CompileContext,
): Record<Exclude<RimEdgeInput, 'color'>, TslNode> {
  return {
    coverage: loadSceneTexel(ctx, 'scene.color', 0, 0).value.a,
    cutoff: ctx.builtin('render.alphaCutoff'),
    lightDir: ctx.builtin('light.dir'),
    light: ctx.builtin('scene.light'),
    strength: ctx.uniform('rim.strength', 'float', undefined),
    enabled: ctx.uniform('rim.enabled', 'bool', undefined),
  };
}

// ---------------------------------------------------------------------------
// CPU twins (test oracles; not used on the render path).

/**
 * Rim offset of REQ-PIX-012 (FX-J note): with `θ` the angle of `L.xy` in
 * degrees counter-clockwise from screen-right in `[0, 360)`, the sector is
 * `d = floor(θ / 45 + 0.5) mod 8` (exact ties go counter-clockwise) and the
 * offset is `(1,0), (1,-1), (0,-1), (-1,-1), (-1,0), (-1,1), (0,1), (1,1)`
 * for `d = 0..7` (top-left pixel coordinates, y down).
 *
 * @param lightDir - View-space light direction (x right, y up, z to viewer).
 * @returns `(dx, dy)`, or `null` when `|L.xy| < 1e-6`.
 */
export function rimOffset(
  lightDir: readonly [number, number, number],
): readonly [number, number] | null {
  const [x, y] = lightDir;
  if (Math.hypot(x, y) < RIM_MIN_SCREEN_LIGHT) return null;
  let theta = (Math.atan2(y, x) * 180) / Math.PI;
  if (theta < 0) theta += 360;
  const d = Math.floor(theta / 45 + 0.5) % 8;
  return SECTOR_OFFSETS[d] ?? null;
}

/**
 * Rim pixels of a coverage mask (row-major, `true` = covered).
 *
 * @param covered - `width · height` coverage flags.
 * @param width - Grid width.
 * @param height - Grid height.
 * @param lightDir - View-space light direction.
 * @returns 1 on rim pixels, else 0.
 */
export function rimMask(
  covered: readonly boolean[],
  width: number,
  height: number,
  lightDir: readonly [number, number, number],
): Uint8Array {
  const out = new Uint8Array(width * height);
  const o = rimOffset(lightDir);
  if (o === null) return out;
  const at = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    covered[y * width + x] === true;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) && !at(x + o[0], y + o[1])) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * One linear channel of a rim pixel: `clamp(c · (light_k + strength) /
 * light_k, 0, 1)` = `clamp(base · (light_k + strength), 0, 1)`; `c` when
 * `light_k = 0`.
 *
 * @param c - Linear channel of the pixel (`base · light_k`).
 * @param light - `light_k`.
 * @param strength - `rim.strength`.
 * @returns The rim channel.
 */
export function rimCombine(c: number, light: number, strength: number): number {
  if (light <= 0) return c;
  return Math.min(Math.max((c * (light + strength)) / light, 0), 1);
}
