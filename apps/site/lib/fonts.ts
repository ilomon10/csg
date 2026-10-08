import localFont from 'next/font/local';

// Three self-hosted OFL families (REQ-WEB-036), served from our own origin by
// next/font with metric-matched fallbacks. Files come from @fontsource packages.

/** Pixel display face, headings >= 24px only. Design grid: 1/8 em. */
export const silkscreen = localFont({
  src: '../node_modules/@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2',
  weight: '400',
  display: 'swap',
  variable: '--font-silkscreen',
  adjustFontFallback: 'Arial',
});

/** Body and UI sans. */
export const geist = localFont({
  src: '../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist',
  adjustFontFallback: 'Arial',
});

/** Code. */
export const geistMono = localFont({
  src: '../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist-mono',
  preload: false,
  adjustFontFallback: false,
});
