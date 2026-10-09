/** Hue 0..360, saturation 0..1, value 0..1. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** True for exactly `#` and six hex digits (REQ-CMP-016: `#12G` and `123456` are rejected). */
export function isHex6(text: string): boolean {
  return HEX6.test(text);
}

/** Parses `#rrggbb` to 0..255 channels; null when invalid. */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!isHex6(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** RGB 0..255 to lowercase `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Hex to HSV; null when the hex is invalid. */
export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(c => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return {h, s: max === 0 ? 0 : d / max, v: max};
}

/** HSV to lowercase `#rrggbb`. */
export function hsvToHex({h, s, v}: Hsv): string {
  const c = v * s;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hh / 60);
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector % 6] as readonly [number, number, number];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
