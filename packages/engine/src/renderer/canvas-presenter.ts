/**
 * Shows the finished cell on the canvas (m2-plan 2.1 item 5, spec 003
 * REQ-PIX-030/031): a second `RenderPipeline` whose output is an integer
 * texel fetch of the cell target at the integer screen pixel, with
 * `outputColorTransform` off, drawn into the default framebuffer. The canvas
 * drawing buffer is the cell size, so screen pixel = cell pixel; the bytes
 * the export reads are the bytes shown (no filtering, no color transform).
 * Upscaling is CSS only (`image-rendering: pixelated`, REQ-PIX-031).
 *
 * For `mirrorWest` (REQ-PIX-006) the preview of a west-facing direction is the
 * flipped east-facing cell, exactly like the export: column `x` shows cell
 * column `axis − x` with `axis = 2·pivotColumn − 1`; columns that fall outside
 * the cell are transparent. The flip is a uniform, so toggling it never
 * recompiles.
 */
import type {RenderTarget} from 'three';
import {
  clamp,
  float,
  floor,
  ivec2,
  mix,
  screenCoordinate,
  step,
  texture,
  uniform,
  vec2,
} from 'three/tsl';
import {RenderPipeline} from 'three/webgpu';
import type {Node, WebGPURenderer} from 'three/webgpu';

/** Draws the preview cell on the canvas. */
export interface PreviewPresenter {
  /**
   * Draws the cell into the canvas (default framebuffer).
   *
   * @param mirrorAxisPx `2·pivotColumn − 1` to show the horizontally flipped
   *   cell (mirrored west direction), or `null` for the cell as is.
   */
  present(mirrorAxisPx: number | null): void;
  /** Releases the presentation material. */
  dispose(): void;
}

/** Options of {@link createCanvasPresenter}. */
export interface CanvasPresenterOptions {
  /**
   * Where to present: `null` (default) = the canvas. A cell-sized RGBA8
   * target lets GPU tests read the presented bytes back (vitest browser mode
   * loses the WebGPU instance when presenting to a canvas).
   */
  readonly output?: RenderTarget | null;
}

/**
 * Creates the canvas presenter of a cell target. The target must keep its
 * texture object (resizing it with `setSize` is fine).
 *
 * @param renderer An initialized renderer whose canvas shows the preview.
 * @param cell The pipeline's RGBA8 `NoColorSpace` cell target.
 * @param options Output override (tests).
 * @returns The presenter.
 */
export function createCanvasPresenter(
  renderer: WebGPURenderer,
  cell: RenderTarget,
  options: CanvasPresenterOptions = {},
): PreviewPresenter {
  const outputTarget = options.output ?? null;
  const mirror = uniform(0);
  const axis = uniform(0);
  const width = uniform(1);
  const px = floor(screenCoordinate.x);
  const py = floor(screenCoordinate.y);
  const sx = mix(px, axis.sub(px), mirror);
  const last = width.sub(1);
  const inside = step(float(0), sx).mul(step(sx, last));
  const output = texture(cell.texture)
    .load(ivec2(vec2(clamp(sx, float(0), last), py)))
    .mul(inside);
  const pipeline = new RenderPipeline(renderer, output as Node<'vec4'>);
  pipeline.outputColorTransform = false;
  return {
    present(mirrorAxisPx: number | null): void {
      mirror.value = mirrorAxisPx === null ? 0 : 1;
      axis.value = mirrorAxisPx ?? 0;
      width.value = cell.width;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(outputTarget);
      try {
        pipeline.render();
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    dispose(): void {
      pipeline.dispose();
    },
  };
}
