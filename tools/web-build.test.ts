import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';

/**
 * Bundle checks over the built `apps/web/dist`. Build first: `pnpm --filter @csg/web build`
 * (`pnpm e2e` also builds). Without `dist` the tests are skipped, not passed silently: the
 * skip reason below is printed by Vitest.
 */
const dist = resolve(import.meta.dirname, '../apps/web/dist');
const built = existsSync(join(dist, 'index.html'));
const suite = built ? describe : describe.skip;
suite(
  'web production build (skipped: run `pnpm --filter @csg/web build` first)',
  () => {
    const read = (rel: string) => readFileSync(join(dist, rel), 'utf8');
    const gz = (rel: string) =>
      gzipSync(readFileSync(join(dist, rel)), {level: 9}).length;
    const jsFiles = built
      ? readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js'))
      : [];

    /** Entry chunk plus its static import graph (script, modulepreload, static imports). */
    function initialGraph(): string[] {
      const html = read('index.html');
      const seed = [
        ...html.matchAll(
          /<(?:script|link)\b[^>]*(?:src|href)="\/(assets\/[^"]+\.js)"/g,
        ),
      ].map(m => m[1] ?? '');
      const seen = new Set<string>();
      const queue = [...seed];
      while (queue.length > 0) {
        const f = queue.pop() ?? '';
        if (seen.has(f)) continue;
        seen.add(f);
        const src = read(f);
        // Static `import"./x.js"` and `from"./x.js"`; dynamic `import(...)` is excluded.
        for (const m of src.matchAll(
          /(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g,
        )) {
          queue.push(`assets/${m[1] ?? ''}`);
        }
      }
      return [...seen];
    }

    it('AC-GEN-007.1 / AC-GEN-007.3: initial JS (entry plus static imports) is <= 400 KB gzipped (a, size half of 007.1; LCP is not measured here)', () => {
      const graph = initialGraph();
      expect(graph.length).toBeGreaterThan(0);
      const total = graph.reduce((sum, f) => sum + gz(f), 0);
      expect(total).toBeLessThanOrEqual(400 * 1000);
    });

    it('AC-GEN-007.3: no initial chunk contains three or @csg/engine, and the engine chunk is dynamic and separate', () => {
      const graph = initialGraph();
      const markers =
        /isObject3D|isBufferGeometry|WebGPURenderer|WebGLRenderer|@csg\/engine/;
      for (const f of graph) expect(read(f), f).not.toMatch(markers);
      const engine = jsFiles.filter(
        f => markers.test(read(`assets/${f}`)) && !/worker/.test(f),
      );
      expect(engine.length).toBeGreaterThan(0);
      for (const f of engine) expect(graph).not.toContain(`assets/${f}`);
      const entry = graph.map(read).join('\n');
      for (const f of engine)
        expect(entry).toMatch(new RegExp(`import\\(\\s*[\`"']\\./${f}`));
    });

    it('AC-GEN-010.4: no built JS references a CDN decoder host or a decoder path that is not same-origin', () => {
      for (const f of jsFiles) {
        const src = read(`assets/${f}`);
        expect(src, f).not.toMatch(
          /gstatic\.com|unpkg\.com|jsdelivr\.net|cdnjs/,
        );
        for (const m of src.matchAll(/setDecoderPath\(\s*([^)]*)\)/g)) {
          expect(m[1] ?? '', f).not.toMatch(/^[`"']?(https?:)?\/\//);
        }
      }
    });

    it('AC-GEN-015.2: the built worker chunk contains no banned identifiers', () => {
      const workers = jsFiles.filter(f => /\.worker-/.test(f));
      expect(workers.length).toBeGreaterThan(0);
      for (const f of workers) {
        expect(read(`assets/${f}`), f).not.toMatch(
          /fetch\(|importScripts\(|import\(|WebSocket|EventSource|XMLHttpRequest|Function\(|eval\(/,
        );
      }
    });
  },
);
