import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';

/**
 * Bundle checks over the built `apps/web/dist`. Build first: `pnpm --filter @csg/web build`
 * (`pnpm e2e` builds `dist-e2e`, not `dist`). Without `dist` the suite is skipped locally, but
 * it FAILS when `CI` is set, so the bundle and CSP gates cannot pass by not running.
 */
const dist = resolve(import.meta.dirname, '../apps/web/dist');
const built = existsSync(join(dist, 'index.html'));
const suite = built || process.env['CI'] ? describe : describe.skip;
suite(
  'web production build (skipped: run `pnpm --filter @csg/web build` first)',
  () => {
    it('the production build exists (fails in CI when missing)', () => {
      expect(built, `${dist} is missing: run pnpm build before the tests`).toBe(
        true,
      );
    });

    const read = (rel: string) => readFileSync(join(dist, rel), 'utf8');
    const gz = (rel: string) =>
      gzipSync(readFileSync(join(dist, rel)), {level: 9}).length;
    const jsFiles = built
      ? readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js'))
      : [];

    it('AC-GEN-007.3: the build emitted JS and no e2e or test host leaked into dist', () => {
      expect(jsFiles.length).toBeGreaterThan(0);
      const all = readdirSync(dist, {recursive: true, encoding: 'utf8'});
      // `tsc -b` also writes declaration files into dist when it runs after the build; ignore them.
      const shipped = all.filter(
        f => !/\.d\.ts$|\.tsbuildinfo$|^(src|e2e|scripts)\//.test(f),
      );
      expect(
        shipped.filter(f => /export-host|e2e-host|test-host/.test(f)),
      ).toEqual([]);
      for (const f of jsFiles) {
        expect(read(`assets/${f}`), f).not.toMatch(
          /export-host|e2e-host|test-host/,
        );
      }
    });

    interface ManifestChunk {
      file: string;
      isEntry?: boolean;
      imports?: string[];
      dynamicImports?: string[];
    }
    const manifest = built
      ? (JSON.parse(read('.vite/manifest.json')) as Record<
          string,
          ManifestChunk
        >)
      : {};
    const fileOf = (key: string): string => manifest[key]?.file ?? '';

    /** Entry chunk plus its static import graph (manifest `imports`, which are static only). */
    function initialGraph(): string[] {
      const seen = new Set<string>();
      const queue = Object.keys(manifest).filter(k => manifest[k]?.isEntry);
      expect(queue.length).toBeGreaterThan(0);
      while (queue.length > 0) {
        const key = queue.pop() ?? '';
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(...(manifest[key]?.imports ?? []));
      }
      return [...seen].map(fileOf);
    }

    it('AC-GEN-007.1 / AC-GEN-007.3: initial JS (entry plus static imports) is <= 400 KB gzipped (a, size half of 007.1; LCP is not measured here)', () => {
      const graph = initialGraph();
      expect(graph.length).toBeGreaterThan(0);
      const total = graph.reduce((sum, f) => sum + gz(f), 0);
      expect(total).toBeLessThanOrEqual(400 * 1000);
      // Everything index.html loads or preloads is part of that static graph.
      const html = read('index.html');
      for (const m of html.matchAll(
        /<(?:script|link)\b[^>]*(?:src|href)="\/(assets\/[^"]+\.js)"/g,
      )) {
        expect(graph).toContain(m[1] ?? '');
      }
    });

    it('AC-GEN-007.3: no initial chunk contains three or @csg/engine, and the engine chunk is reached only through dynamic imports', () => {
      const graph = initialGraph();
      const markers =
        /isObject3D|isBufferGeometry|WebGPURenderer|WebGLRenderer|@csg\/engine/;
      for (const f of graph) expect(read(f), f).not.toMatch(markers);
      const engine = Object.keys(manifest).filter(k => {
        const f = fileOf(k);
        return f.endsWith('.js') && !/worker/.test(f) && markers.test(read(f));
      });
      expect(engine.length).toBeGreaterThan(0);
      // (c) The engine chunk is imported statically only by chunks outside the initial graph
      // (the lazy `preview-engine` wrapper), never by the entry or its static imports ...
      for (const key of engine) {
        expect(graph).not.toContain(fileOf(key));
        for (const [from, chunk] of Object.entries(manifest)) {
          if (!(chunk.imports ?? []).includes(key)) continue;
          expect(graph, `${from} -> ${key}`).not.toContain(fileOf(from));
        }
      }
      // ... and it is reachable from the entry along dynamic edges (lazy views, then viewport).
      const reach = new Set<string>();
      const queue = Object.keys(manifest).filter(k => manifest[k]?.isEntry);
      while (queue.length > 0) {
        const key = queue.pop() ?? '';
        if (reach.has(key)) continue;
        reach.add(key);
        const c = manifest[key];
        queue.push(...(c?.imports ?? []), ...(c?.dynamicImports ?? []));
      }
      for (const key of engine) expect(reach.has(key)).toBe(true);
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
