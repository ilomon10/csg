import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8');

function block(selector: string, from = css): Record<string, string> {
  const start = from.indexOf(selector + ' {');
  if (start < 0) throw new Error(`missing block ${selector}`);
  const body = from.slice(
    from.indexOf('{', start) + 1,
    from.indexOf('}', start),
  );
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g))
    out[m[1]!] = m[2]!.trim();
  return out;
}

const THEMES: Record<string, Record<string, string>> = {
  dark: block(':root'),
  light: block(":root[data-theme='light']"),
};

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ['bg', 'panel', 'panel-2', 'panel-sunk', 'overlay'];
/** [foreground, background, min ratio] */
const PAIRS: Array<[string, string, number]> = [
  ...SURFACES.flatMap((s): Array<[string, string, number]> => [
    ['text', s, 4.5],
    ['muted', s, 4.5],
    ['accent-fg', s, 4.5],
    ['danger', s, 4.5],
    ['success-fg', s, 4.5],
    ['focus', s, 3],
    ['edge', s, 3],
  ]),
  ['text', 'tile-selected', 4.5],
  ['muted', 'tile-selected', 4.5],
  ['accent-fg', 'tile-selected', 3],
  ['edge', 'tile-selected', 3],
  ['accent-ink', 'accent', 4.5],
  ['accent-ink', 'accent-hover', 4.5],
  // The amber fill is not a boundary on its own: its label (accent-ink) identifies it, and
  // outlined states use accent-edge / accent-fg.
  ['accent-edge', 'panel', 3],
];

describe('design tokens', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    it(`AC-UX-035.1: every text and indicator pair meets its threshold in the ${theme} theme`, () => {
      const failures: string[] = [];
      for (const [fg, bg, min] of PAIRS) {
        const f = tokens[fg];
        const b = tokens[bg];
        if (!f || !b || !f.startsWith('#') || !b.startsWith('#')) {
          failures.push(`${fg}/${bg}: missing token`);
          continue;
        }
        const r = ratio(f, b);
        if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('AC-UX-034.1: the dark tokens match the approved mockup', () => {
    expect(THEMES.dark).toMatchObject({
      bg: '#13151a',
      panel: '#1b1e24',
      'panel-2': '#262a32',
      line: '#363c46',
      text: '#ecebe4',
      muted: '#9ca3ac',
      accent: '#ffb21f',
      'accent-ink': '#1a1100',
      focus: '#46e0a0',
      danger: '#ff7a6b',
    });
  });

  it('AC-UX-034.2: the system-theme block repeats the light tokens exactly', () => {
    const media = css.slice(
      css.indexOf('@media (prefers-color-scheme: light)'),
    );
    const system = block(":root[data-theme='system']", media);
    expect(system).toEqual(THEMES.light);
  });

  it('AC-UX-038.1: reduced motion zeroes the transition durations', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*--dur: 0ms/);
    expect(css).toMatch(/data-reduce-motion='true'\][\s\S]*--dur: 0ms/);
  });
});

describe('fonts', () => {
  const fonts = readFileSync(join(here, 'fonts.css'), 'utf8');
  it('AC-UX-034.3: fonts are self-hosted woff2 files with OFL texts and no remote URL', () => {
    expect(fonts).not.toMatch(/https?:|\/\//);
    const files = [...fonts.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map(
      m => m[1]!,
    );
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files)
      expect(existsSync(join(here, 'fonts', f))).toBe(true);
    for (const f of ['pixelify-sans', 'figtree', 'jetbrains-mono']) {
      expect(existsSync(join(here, 'fonts', `OFL-${f}.txt`))).toBe(true);
    }
    expect(fonts.match(/font-display: swap/g)?.length).toBe(files.length);
  });
});
