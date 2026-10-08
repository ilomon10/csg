/**
 * Union-bounds framing (REQ-PIX-007..009, 015.3). Pure math; the pivot is a pixel
 * corner (spec 003 amendment A6): continuous top-left point `(floor(W/2), H - pivotRowPx)`.
 */
import type {CameraPreset, RenderSettings} from '@csg/parts-schema';
import type {Framing, FramingBox} from '../contracts/pipeline';

/**
 * The settings fields framing reads. Structural so the real `RenderSettings` is
 * accepted (the contract's `RenderSettings` is still a stand-in alias).
 */
export interface FramingSettings {
  readonly resolution: Readonly<RenderSettings['resolution']>;
  readonly camera: Readonly<RenderSettings['camera']>;
  readonly outline: {
    readonly outer: Readonly<RenderSettings['outline']['outer']>;
  };
}

const PRESET_ELEVATION_DEG: Record<Exclude<CameraPreset, 'custom'>, number> = {
  side: 0,
  'three-quarter': 35,
  isometric: 30,
};

/** Relative tolerance so an exact fit is not reported as clipped. */
const CLIP_EPS = 1e-9;

/** Camera elevation in degrees: preset value, or `camera.elevationDeg` for `custom`. */
export function cameraElevationDeg(camera: FramingSettings['camera']): number {
  return camera.preset === 'custom'
    ? camera.elevationDeg
    : PRESET_ELEVATION_DEG[camera.preset];
}

/**
 * Computes the one fixed framing of an export from every frame's screen box.
 * Auto mode picks the smallest world-units-per-pixel that fits the union bounds
 * inflated by `outerWidth + 1` px (AC-PIX-015.3) to the left, right and top of the
 * pivot; geometry below the pivot row clips. A numeric `camera.framing` is used
 * verbatim (REQ-PIX-009). `clipped` lists each (label, direction) with any extent
 * outside the cell (no margin), sorted by label then direction.
 */
export function computeFraming(
  boxes: ReadonlyArray<FramingBox>,
  settings: FramingSettings,
): Framing {
  const {width, height} = settings.resolution;
  const {pivotRowPx, framing} = settings.camera;
  const leftPx = Math.floor(width / 2);
  const rightPx = width - leftPx;
  const upPx = height - pivotRowPx;
  const downPx = pivotRowPx;

  let worldPerPx: number;
  if (framing === 'auto') {
    const outer = settings.outline.outer;
    const margin = (outer.enabled ? outer.widthPx : 0) + 1;
    // Room left for the character on each side; at least 1 px so the ratio stays finite.
    const availRight = Math.max(rightPx - margin, 1);
    const availLeft = Math.max(leftPx - margin, 1);
    const availUp = Math.max(upPx - margin, 1);
    let s = 0;
    for (const {box} of boxes) {
      s = Math.max(s, box.maxX / availRight, -box.minX / availLeft);
      s = Math.max(s, box.maxY / availUp);
    }
    // Empty or degenerate bounds: fall back to 1 world unit per pixel.
    worldPerPx = s > 0 ? s : 1;
  } else {
    worldPerPx = framing;
  }

  const clippedKeys = new Map<string, {label: string; direction: number}>();
  for (const {label, direction, box} of boxes) {
    const eps = CLIP_EPS * worldPerPx;
    const outside =
      box.maxX > rightPx * worldPerPx + eps ||
      box.minX < -leftPx * worldPerPx - eps ||
      box.maxY > upPx * worldPerPx + eps ||
      box.minY < -downPx * worldPerPx - eps;
    if (outside)
      clippedKeys.set(`${label}\u0000${direction}`, {label, direction});
  }
  const clipped = [...clippedKeys.values()].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : a.direction - b.direction,
  );

  return {
    worldPerPx,
    elevationDeg: cameraElevationDeg(settings.camera),
    frustum: {
      left: -leftPx * worldPerPx,
      right: rightPx * worldPerPx,
      top: upPx * worldPerPx,
      bottom: -downPx * worldPerPx,
    },
    pivotPx: [leftPx, height - 1 - pivotRowPx],
    clipped,
  };
}
