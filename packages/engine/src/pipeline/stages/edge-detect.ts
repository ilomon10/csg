/**
 * Edge-detect stage (spec 003 REQ-PIX-015, REQ-PIX-016, REQ-PIX-017 note A2;
 * spec 006 `post.edgeDetect@1` with the `source` output of amendment A3;
 * m2-plan 2.4). Emitter-shaped (REQ-PIX-035): pure, creates no material and no
 * render target.
 *
 * Neighbours are integer texel fetches (`TextureNode.load`, no filtering) at
 * `screenPos + offset`, with constant offsets unrolled at compile time
 * (`-3..3`, masked by the `width` input; REQ-SGF-042). Off-cell neighbours are
 * masked out (a clamped fetch is never trusted).
 *
 * Host contract (M2-14): the post builtins `scene.color`, `scene.normal`,
 * `scene.depth` and `scene.partId` must be `TextureNode`s over the scene-pass
 * MRT attachments (spec 003 m2-plan 2.3). The stage reads `rgba` of
 * `scene.color`, `xyz` of `scene.normal`, `w` of `scene.depth` (the same
 * `normalDepth` attachment may back both) and `r` of `scene.partId`.
 */
import {
  abs,
  clamp,
  cos,
  dot,
  float,
  ivec2,
  max,
  normalize,
  radians,
  select,
  step,
  vec2,
  vec4,
} from 'three/tsl';
import type {Node, TextureNode} from 'three/webgpu';
import type {RenderSettings} from '@csg/parts-schema';
import type {
  CompileContext,
  StageEmitter,
  TslNode,
} from '@csg/shader-graph/tsl';

/** Spec 006 catalog type of the stage. */
export const EDGE_DETECT_NODE_TYPE = 'post.edgeDetect@1';

/** Catalog input socket IDs of `post.edgeDetect@1`. */
export const EDGE_DETECT_CATALOG_INPUTS = [
  'alpha',
  'cutoff',
  'depthThresholdPx',
  'normalThresholdDeg',
  'width',
] as const;

/**
 * Extra inputs of the M2 stage (spec 003 "M2 stage functions" table): in M4
 * the built-in graph gates the outputs with `math.select@1` instead.
 */
export const EDGE_DETECT_EXTRA_INPUTS = [
  'outerEnabled',
  'innerEnabled',
] as const;

/** Output socket IDs of `post.edgeDetect@1`. */
export const EDGE_DETECT_OUTPUTS = ['outer', 'inner', 'source'] as const;

/** An input socket ID of {@link edgeDetect}. */
export type EdgeDetectInput =
  | (typeof EDGE_DETECT_CATALOG_INPUTS)[number]
  | (typeof EDGE_DETECT_EXTRA_INPUTS)[number];

/** An output socket ID of {@link edgeDetect}. */
export type EdgeDetectOutput = (typeof EDGE_DETECT_OUTPUTS)[number];

/** Values of the multi-select field `sources` (spec 006), in canonical order. */
export const EDGE_SOURCES = ['id', 'depth', 'normal'] as const;

/** One inner-line source (REQ-PIX-016). */
export type EdgeSource = (typeof EDGE_SOURCES)[number];

/** Fields of {@link edgeDetect}. */
export interface EdgeDetectFields {
  /** Enabled inner-line sources (compile-time; spec 007 `outline.inner.sources`). */
  readonly sources: readonly EdgeSource[];
}

/** Largest outer outline width (REQ-PIX-015; registry max of `width`, REQ-SGF-042). */
export const OUTLINE_MAX_WIDTH_PX = 3;

/** A neighbour offset `(dx, dy)` in top-left cell pixels and when it applies. */
export interface NeighbourOffset {
  readonly dx: number;
  readonly dy: number;
  /** Chebyshev distance `max(|dx|, |dy|)`. */
  readonly distance: number;
  /**
   * Smallest outer width whose neighbourhood contains the offset: the
   * distance, except for the diagonals of ring 1, which width 1 (the
   * 4-neighbourhood) excludes (REQ-PIX-015).
   */
  readonly minWidth: number;
}

/**
 * Outer-outline neighbour offsets in darken priority order (REQ-PIX-017 note
 * A2): smallest Chebyshev distance first, then row-major (`dy` ascending, then
 * `dx` ascending). For width 1 this yields up, left, right, down
 * (AC-PIX-017.2).
 *
 * @param maxWidth - Largest width covered (default {@link OUTLINE_MAX_WIDTH_PX}).
 * @returns Offsets without `(0, 0)`, sorted.
 */
export function darkenNeighbourOffsets(
  maxWidth: number = OUTLINE_MAX_WIDTH_PX,
): NeighbourOffset[] {
  const out: NeighbourOffset[] = [];
  for (let dy = -maxWidth; dy <= maxWidth; dy++) {
    for (let dx = -maxWidth; dx <= maxWidth; dx++) {
      if (dx === 0 && dy === 0) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const diagonal1 = distance === 1 && dx !== 0 && dy !== 0;
      out.push({dx, dy, distance, minWidth: diagonal1 ? 2 : distance});
    }
  }
  // Generated in row-major order; a stable sort by distance keeps it per ring.
  return out.sort((a, b) => a.distance - b.distance);
}

/** The 4-neighbourhood compared for inner lines: up, left, right, down (REQ-PIX-016). */
export const INNER_NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> =
  [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ];

/**
 * Inner-line sources enabled by `RenderSettings.outline.inner`, in canonical
 * order (spec 007 reserved field `outline.inner.sources`).
 *
 * @param inner - `RenderSettings.outline.inner`.
 * @returns The `sources` field value.
 */
export function edgeSourcesFromSettings(
  inner: RenderSettings['outline']['inner'],
): EdgeSource[] {
  const out: EdgeSource[] = [];
  if (inner.partId) out.push('id');
  if (inner.depth) out.push('depth');
  if (inner.normal) out.push('normal');
  return out;
}

/**
 * Tie rule for "drawn on the farther pixel" (REQ-PIX-016) when both pixels
 * have the same depth: the pixel with the larger part ID draws; with equal IDs
 * too, the pixel whose neighbour lies up or left of it (the later pixel in
 * row-major order). Exactly one pixel of every edge pair draws.
 *
 * @param dx - Neighbour offset x.
 * @param dy - Neighbour offset y.
 * @returns True when the neighbour precedes the pixel in row-major order.
 */
export function neighbourPrecedes(dx: number, dy: number): boolean {
  return dy < 0 || (dy === 0 && dx < 0);
}

/** Scene MRT texture behind a host builtin (see the module host contract). */
export function sceneTexture(ctx: CompileContext, name: string): TextureNode {
  const node = ctx.builtin(name) as Partial<TextureNode>;
  if (node.isTextureNode !== true || typeof node.load !== 'function') {
    throw new Error(
      `builtin "${name}" must be a TextureNode for neighbour fetches`,
    );
  }
  return node as TextureNode;
}

/** A neighbour fetch: the texel and a 0/1 in-cell mask. */
interface Texel {
  readonly value: Node<'vec4'>;
  readonly inCell: Node<'float'>;
}

/**
 * Integer fetch of `name` at `screenPos + (dx, dy)` (top-left origin; three
 * flips render-target fetches on WebGL). Coordinates are clamped into the
 * cell; `inCell` is 0 for off-cell offsets.
 *
 * @param ctx - Post compile context.
 * @param name - `scene.color`, `scene.normal`, `scene.depth` or `scene.partId`.
 * @param dx - Offset x in pixels.
 * @param dy - Offset y in pixels (down is positive).
 * @returns The texel (RGBA) and the in-cell mask.
 */
export function loadSceneTexel(
  ctx: CompileContext,
  name: string,
  dx: number,
  dy: number,
): Texel {
  const tex = sceneTexture(ctx, name);
  const px = ctx.builtin('screenPos') as Node<'vec2'>;
  const res = ctx.builtin('resolution') as Node<'vec2'>;
  const last = res.sub(1);
  const p = px.add(vec2(dx, dy));
  let inCell: Node<'float'> = float(1);
  if (dx < 0) inCell = inCell.mul(step(float(0), p.x));
  if (dx > 0) inCell = inCell.mul(step(p.x, last.x));
  if (dy < 0) inCell = inCell.mul(step(float(0), p.y));
  if (dy > 0) inCell = inCell.mul(step(p.y, last.y));
  const q = dx === 0 && dy === 0 ? px : clamp(p, vec2(0, 0), last);
  return {value: tex.load(ivec2(q)) as unknown as Node<'vec4'>, inCell};
}

/** 1 when `cond` holds, else 0. */
function mask(cond: Node<'bool'>): Node<'float'> {
  return select(cond, float(1), float(0));
}

/**
 * `a` where `t = 0`, `b` where `t = 1` (exact for finite inputs; `t` must be 0
 * or 1). Branch-free replacement for `select` over texture fetches.
 *
 * @param a - Value for `t = 0`.
 * @param b - Value for `t = 1`.
 * @param t - 0/1 weight.
 * @returns The blended node.
 */
export function pick(
  a: Node<'vec4'>,
  b: Node<'vec4'>,
  t: Node<'float'>,
): Node<'vec4'> {
  return a.mul(float(1).sub(t)).add(b.mul(t));
}

/**
 * `post.edgeDetect@1`: outer outline mask, inner line mask and the colour the
 * outline darkens (REQ-PIX-015, -016, -017).
 *
 * - `outer` = 1 on uncovered pixels (`alpha < cutoff`) with a covered pixel in
 *   the 4-neighbourhood (width 1) or the Chebyshev square of radius `width`
 *   (2–3), when `outerEnabled`.
 * - `inner` = 1 on covered pixels that have a covered 4-neighbour differing in
 *   part ID (`id`), in depth by strictly more than `depthThresholdPx` (`depth`)
 *   or in normal by more than `normalThresholdDeg` (`normal`), and that are the
 *   farther pixel of the pair (smaller depth; ties: {@link neighbourPrecedes}),
 *   when `innerEnabled`.
 * - `source` = linear RGBA of the darken neighbour (smallest Chebyshev ring,
 *   then row-major; {@link darkenNeighbourOffsets}) on outer pixels, the
 *   pixel's own scene colour on inner pixels, `(0, 0, 0, 0)` elsewhere.
 *
 * The centre coverage uses the `alpha` input; neighbour coverage reads the
 * alpha of `scene.color` at the offset with the same `cutoff`.
 *
 * @param ctx - Post compile context (scene textures, `screenPos`, `resolution`).
 * @param inputs - Catalog inputs plus `outerEnabled` / `innerEnabled` (bool).
 * @param fields - `sources`.
 * @returns `outer`, `inner` (float 0/1) and `source` (vec4).
 */
export const edgeDetect: StageEmitter<
  EdgeDetectInput,
  EdgeDetectOutput,
  EdgeDetectFields
> = (ctx, inputs, fields) => {
  const alpha = inputs.alpha as Node<'float'>;
  const cutoff = inputs.cutoff as Node<'float'>;
  const width = clamp(
    float(inputs.width as Node<'int'>),
    float(1),
    float(OUTLINE_MAX_WIDTH_PX),
  );
  const outerOn = mask(inputs.outerEnabled as Node<'bool'>);
  const innerOn = mask(inputs.innerEnabled as Node<'bool'>);
  const covered = step(cutoff, alpha);

  // One fetch node per (texture, offset), shared by every use in this compile.
  const fetched = new Map<string, Texel>();
  const fetch = (name: string, dx: number, dy: number): Texel => {
    const key = `${name}@${dx},${dy}`;
    let t = fetched.get(key);
    if (t === undefined) {
      t = loadSceneTexel(ctx, name, dx, dy);
      fetched.set(key, t);
    }
    return t;
  };
  const colorAt = (dx: number, dy: number) => fetch('scene.color', dx, dy);

  // Outer outline + darken source. Priority: first offset wins, so the chain
  // runs from the last offset to the first. Blends use exact 0/1 weights
  // (`a·0 + b·1 = b`) instead of `select` with texture-fetch branches, which
  // three r186 cannot build on the GLSL backend (flipY `toVar` outside a stack).
  const offsets = darkenNeighbourOffsets();
  let any: Node<'float'> = float(0);
  let neighbour: Node<'vec4'> = vec4(0, 0, 0, 0);
  for (let i = offsets.length - 1; i >= 0; i--) {
    const o = offsets[i];
    if (o === undefined) continue;
    const t = colorAt(o.dx, o.dy);
    const valid = step(cutoff, t.value.a)
      .mul(t.inCell)
      .mul(step(float(o.minWidth), width));
    any = max(any, valid);
    neighbour = pick(neighbour, t.value, valid);
  }
  const outer = float(1).sub(covered).mul(any).mul(outerOn);

  // Inner lines on the 4-neighbourhood.
  const sources = new Set(fields.sources);
  let inner: Node<'float'> = float(0);
  if (sources.size > 0) {
    // Depth decides the farther pixel for every source.
    const ndAt = (dx: number, dy: number) => fetch('scene.depth', dx, dy);
    const nAt = (dx: number, dy: number) => fetch('scene.normal', dx, dy);
    const idAt = (dx: number, dy: number) => fetch('scene.partId', dx, dy);
    const dP = ndAt(0, 0).value.w;
    const idP = idAt(0, 0).value.r;
    const nP = sources.has('normal')
      ? normalize(nAt(0, 0).value.xyz)
      : undefined;
    const depthThreshold = inputs.depthThresholdPx as Node<'float'>;
    const cosThreshold = cos(
      radians(inputs.normalThresholdDeg as Node<'float'>),
    );

    let found: Node<'float'> = float(0);
    for (const [dx, dy] of INNER_NEIGHBOUR_OFFSETS) {
      const c = colorAt(dx, dy);
      const dN = ndAt(dx, dy).value.w;
      const idN = idAt(dx, dy).value.r;
      const idDiff = abs(idP.sub(idN));
      let edge: Node<'float'> = float(0);
      if (sources.has('id')) edge = max(edge, mask(idDiff.greaterThan(0.5)));
      if (sources.has('depth')) {
        edge = max(edge, mask(abs(dP.sub(dN)).greaterThan(depthThreshold)));
      }
      if (nP !== undefined) {
        const nN = normalize(nAt(dx, dy).value.xyz);
        edge = max(edge, mask(dot(nP, nN).lessThan(cosThreshold)));
      }
      const tie = mask(idP.greaterThan(idN)).add(
        neighbourPrecedes(dx, dy) ? mask(idDiff.lessThan(0.5)) : float(0),
      );
      const farther = mask(dP.lessThan(dN)).add(mask(dP.equal(dN)).mul(tie));
      found = max(
        found,
        edge.mul(farther).mul(step(cutoff, c.value.a)).mul(c.inCell),
      );
    }
    inner = covered.mul(found).mul(innerOn);
  }

  const own = colorAt(0, 0).value;
  // outer and inner are exclusive (uncovered vs covered pixels).
  const source = neighbour.mul(outer).add(own.mul(inner));
  return {outer, inner, source};
};

/**
 * Default inputs of {@link edgeDetect} in the built-in post pipeline (spec 007
 * reserved IDs): `alpha ← scene.color.a`, `cutoff ← render.alphaCutoff`,
 * `width ← outline.outer.widthPx`, thresholds and enables from `outline.*`.
 *
 * @param ctx - A post compile context.
 * @returns The input record.
 */
export function defaultEdgeDetectInputs(
  ctx: CompileContext,
): Record<EdgeDetectInput, TslNode> {
  return {
    alpha: loadSceneTexel(ctx, 'scene.color', 0, 0).value.a,
    cutoff: ctx.builtin('render.alphaCutoff'),
    depthThresholdPx: ctx.uniform(
      'outline.inner.depthThresholdPx',
      'float',
      undefined,
    ),
    normalThresholdDeg: ctx.uniform(
      'outline.inner.normalThresholdDeg',
      'float',
      undefined,
    ),
    width: ctx.uniform('outline.outer.widthPx', 'int', undefined),
    outerEnabled: ctx.uniform('outline.outer.enabled', 'bool', undefined),
    innerEnabled: ctx.uniform('outline.inner.enabled', 'bool', undefined),
  };
}

/** A hand-built scene MRT cell for {@link referenceEdgeDetect} (top-left rows). */
export interface MrtCell {
  readonly width: number;
  readonly height: number;
  /** Linear RGBA per pixel (`scene.color`). */
  readonly color: Float32Array;
  /** View normal xyz + depth in output px per pixel (`normalDepth`). */
  readonly normalDepth: Float32Array;
  /** Part ID per pixel (`partId`). */
  readonly partId: Float32Array;
}

/** Uniform values of {@link referenceEdgeDetect}. */
export interface EdgeDetectParams {
  readonly cutoff: number;
  readonly widthPx: number;
  readonly outerEnabled: boolean;
  readonly innerEnabled: boolean;
  readonly depthThresholdPx: number;
  readonly normalThresholdDeg: number;
  readonly sources: readonly EdgeSource[];
}

/** Per-pixel result of {@link referenceEdgeDetect}. */
export interface EdgeDetectResult {
  readonly outer: Uint8Array;
  readonly inner: Uint8Array;
  /** Linear RGBA per pixel. */
  readonly source: Float32Array;
}

/**
 * CPU oracle of {@link edgeDetect} with the same rules (tests only; not used by
 * the render path).
 *
 * @param cell - Scene MRT values.
 * @param p - Uniform values and sources.
 * @returns Outer and inner masks and the source colours.
 */
export function referenceEdgeDetect(
  cell: MrtCell,
  p: EdgeDetectParams,
): EdgeDetectResult {
  const {width: w, height: h} = cell;
  const n = w * h;
  const outer = new Uint8Array(n);
  const inner = new Uint8Array(n);
  const source = new Float32Array(n * 4);
  const widthPx = Math.min(Math.max(p.widthPx, 1), OUTLINE_MAX_WIDTH_PX);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  const covered = (i: number) =>
    i >= 0 && (cell.color[i * 4 + 3] ?? 0) >= p.cutoff;
  const offsets = darkenNeighbourOffsets();
  const cosT = Math.cos((p.normalThresholdDeg * Math.PI) / 180);
  const unit = (i: number): [number, number, number] => {
    const x = cell.normalDepth[i * 4] ?? 0;
    const y = cell.normalDepth[i * 4 + 1] ?? 0;
    const z = cell.normalDepth[i * 4 + 2] ?? 0;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  const copy = (to: number, from: number) => {
    for (let c = 0; c < 4; c++)
      source[to * 4 + c] = cell.color[from * 4 + c] ?? 0;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!covered(i)) {
        if (!p.outerEnabled) continue;
        for (const o of offsets) {
          if (o.minWidth > widthPx) continue;
          const j = at(x + o.dx, y + o.dy);
          if (covered(j)) {
            outer[i] = 1;
            copy(i, j);
            break;
          }
        }
        continue;
      }
      if (!p.innerEnabled || p.sources.length === 0) continue;
      const dP = cell.normalDepth[i * 4 + 3] ?? 0;
      const idP = cell.partId[i] ?? 0;
      for (const [dx, dy] of INNER_NEIGHBOUR_OFFSETS) {
        const j = at(x + dx, y + dy);
        if (!covered(j)) continue;
        const dN = cell.normalDepth[j * 4 + 3] ?? 0;
        const idN = cell.partId[j] ?? 0;
        let edge = false;
        if (p.sources.includes('id') && Math.abs(idP - idN) > 0.5) edge = true;
        if (
          p.sources.includes('depth') &&
          Math.abs(dP - dN) > p.depthThresholdPx
        ) {
          edge = true;
        }
        if (p.sources.includes('normal')) {
          const a = unit(i);
          const b = unit(j);
          if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < cosT) edge = true;
        }
        const farther =
          dP < dN ||
          (dP === dN &&
            (idP > idN || (idP === idN && neighbourPrecedes(dx, dy))));
        if (edge && farther) {
          inner[i] = 1;
          copy(i, i);
          break;
        }
      }
    }
  }
  return {outer, inner, source};
}
