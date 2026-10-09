/**
 * M3 performance cases (m3-plan §5, task M3-17), through the character renderer with the perf
 * character (8 equipped parts) at 64 px. Report only; budgets fail only with `CSG_PERF_GATE=1`
 * on the reference machine (the golden container is a software rasterizer).
 *
 * - Preview (AC-PIX-032.1, AC-GEN-007.2, REQ-PIX-032): p95 frame interval <= 16.7 ms with each
 *   shipped look preset (REQ-EDT-044), the looks the Easy and Pro workspaces offer.
 * - Export (REQ-EXP-026 / AC-EXP-026.1, REQ-PIX-033 / AC-PIX-033.1): the P-07 reference export
 *   (64 px, 8 directions, 4 clips x 8 frames, scale 1, `aseprite-json`) end to end through the
 *   renderer and the export worker, 5 times: median total <= 10 s, median encode + package
 *   <= 3 s, average render <= 20 ms per frame including readback.
 * - Structural rebuild (REQ-PIX-034 / AC-PIX-034.2): switching between look presets rebuilds the
 *   post stages and shows the new frame within 300 ms (cold and warm). The engine share of
 *   AC-UX-067.1 (cached part swap, style change to chibi: <= 150 ms to the new frame) is measured
 *   on the same renderer.
 */
import {
  anatomyPresetSchema,
  clipManifestSchema,
  defaultExportSettings,
  defaultRenderSettings,
  parseRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {AssetLicense, CharacterSpec} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import type {RenderedFrame, RenderSettings} from '../../src/contracts/pipeline';
import {createExportWorkerClient} from '../../src/export/worker-client';
import type {ExportContext, ExportProgress} from '../../src/export/types';
import {
  LOOK_PRESET_IDS,
  loadLookPreset,
  lookFields,
} from '../golden/look-preset-data';
import {
  PERF_CLIPS,
  createPerfRenderer,
  equippedPartCount,
  gpuIdle,
  median,
  ms,
  perfCharacter,
  perfGate,
  reportEnvironment,
  runPreviewLoop,
  summary,
  writePerfReport,
} from './perf-harness';
import type {PerfRenderer} from './perf-harness';

const WALK = 'builtin:quaternius-ual/walk';
const CELL = 64;
const PREVIEW_MS = 5_000;
const FRAME_BUDGET_MS = 16.7;
/** Same allowance and reason as preview.gpu.ts: rAF timestamps read 16.6..16.8 ms on time. */
const TIMER_ALLOWANCE_MS = 0.5;
const EXPORT_RUNS = 5;
const EXPORT_BUDGET_MS = 10_000;
const ENCODE_BUDGET_MS = 3_000;
const RENDER_PER_FRAME_BUDGET_MS = 20;
const REBUILD_BUDGET_MS = 300;
const CHANGE_BUDGET_MS = 150;
const ALT_HAIR = 'builtin:quaternius-ubc/hair-buzzed';

const PACK_URLS = import.meta.glob('../../../../assets/packs/*/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
});
const CHIBI_URLS = import.meta.glob(
  '../../../../assets/packs/quaternius-ubc/presets/anatomy/chibi.json',
  {query: '?url', import: 'default', eager: true},
);

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** RenderSettings of a 64 px, 8-direction case with `animations`, optionally with a look preset. */
function settingsWith(
  animations: RenderSettings['animations'],
  look: Record<string, unknown> = {},
): RenderSettings {
  const parsed = parseRenderSettings({
    resolution: {width: CELL, height: CELL},
    camera: {preset: 'three-quarter'},
    directions: 8,
    animations,
    ...look,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

const walk8 = (): RenderSettings['animations'] => [
  {clipId: WALK, label: 'walk', frameCount: 8, fps: 8, loop: true},
];

/** The P-07 reference export settings (REQ-EXP-026). */
function p07Settings(): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    resolution: {width: CELL, height: CELL},
    directions: 8,
    mirrorWest: false,
    animations: PERF_CLIPS.map(clipId => ({
      clipId,
      label: clipId.slice(clipId.lastIndexOf('/') + 1),
      frameCount: 8,
      fps: 8,
      loop: true,
    })),
  };
}

/** Credits of the perf character and the P-07 clips from the built manifests (REQ-EXP-020). */
async function p07Credits(
  spec: CharacterSpec,
  clips: readonly string[],
): Promise<ExportContext['credits']> {
  const licenses = new Map<string, AssetLicense>();
  for (const [path, url] of Object.entries(PACK_URLS)) {
    if (path.endsWith('/manifest.json')) {
      const m = partManifestSchema.parse(await json(url));
      for (const p of m.parts)
        licenses.set(`builtin:${m.packId}/${p.id}`, p.license ?? m.license);
    } else if (path.endsWith('/clips.json')) {
      const m = clipManifestSchema.parse(await json(url));
      for (const c of m.clips)
        licenses.set(`builtin:${m.packId}/${c.id}`, m.license);
    }
  }
  const out: Array<ExportContext['credits'][number]> = [];
  const add = (ref: string, kind: 'body' | 'part' | 'clip') => {
    const license = licenses.get(ref);
    if (license === undefined) throw new Error(`no license for ${ref}`);
    out.push({ref, kind, license});
  };
  add(spec.body.ref, 'body');
  for (const sel of Object.values(spec.parts)) add(sel.ref, 'part');
  for (const ref of clips) add(ref, 'clip');
  return out;
}

/** Applies a change and waits until the redrawn preview frame is finished on the GPU. */
async function timeToFrame(
  p: PerfRenderer,
  change: () => Promise<{ok: boolean; error?: {message: string}}>,
): Promise<number> {
  const r = p.renderer;
  const before = r.pipelineStats.frames;
  const t0 = performance.now();
  const res = await change();
  await gpuIdle(r.renderer);
  const elapsed = performance.now() - t0;
  if (!res.ok) throw new Error(res.error?.message ?? 'change failed');
  expect(r.pipelineStats.frames).toBeGreaterThan(before);
  return elapsed;
}

let live: PerfRenderer | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

describe('M3 performance (M3-17)', () => {
  it('AC-PIX-032.1, AC-GEN-007.2: 8 parts at 64 px with every look preset, p95 frame time <= 16.7 ms', async () => {
    const perLook: Record<string, unknown> = {};
    let worstP95 = 0;
    let env: Record<string, unknown> = {};
    for (const id of LOOK_PRESET_IDS) {
      const preset = await loadLookPreset(id);
      live = await createPerfRenderer({
        settings: settingsWith(walk8(), lookFields(preset)),
      });
      const loop = await runPreviewLoop(live, WALK, PREVIEW_MS);
      const intervals = summary(loop.intervals);
      env = await reportEnvironment(live.renderer.renderer);
      perLook[id] = {
        framesDrawn: loop.frames,
        fps: ms(loop.frames / (PREVIEW_MS / 1000)),
        frameIntervalMs: intervals,
        drawCpuMs: summary(loop.drawCpu),
      };
      worstP95 = Math.max(worstP95, intervals.p95);
      live.dispose();
      live = undefined;
    }
    await writePerfReport('m3-preview-looks', {
      ac: ['AC-PIX-032.1', 'AC-GEN-007.2'],
      ...env,
      resolution: CELL,
      parts: 8,
      durationMsPerLook: PREVIEW_MS,
      budgetP95Ms: FRAME_BUDGET_MS,
      looks: perLook,
      worstP95Ms: worstP95,
    });
    expect(Number.isFinite(worstP95)).toBe(true);
    if (await perfGate())
      expect(worstP95).toBeLessThanOrEqual(
        FRAME_BUDGET_MS + TIMER_ALLOWANCE_MS,
      );
  }, 300_000);

  it('AC-EXP-026.1, AC-PIX-033.1: P-07 export end to end through the export worker, 5 runs, median total <= 10 s and encode + package <= 3 s', async () => {
    const settings = p07Settings();
    live = await createPerfRenderer({settings});
    const spec = perfCharacter();
    expect(equippedPartCount(spec)).toBe(8);
    const credits = await p07Credits(spec, PERF_CLIPS);
    const exportSettings = defaultExportSettings();
    expect([exportSettings.metadata, exportSettings.scales]).toEqual([
      'aseprite-json',
      [1],
    ]);
    const client = createExportWorkerClient({
      createWorker: () =>
        new Worker(
          new URL('../../src/export/export.worker.ts', import.meta.url),
          {type: 'module'},
        ),
    });
    const r = live.renderer;
    const runs: Array<{
      prepareMs: number;
      renderMs: number;
      encodeMs: number;
      totalMs: number;
      frames: number;
      zipBytes: number;
    }> = [];
    const zips: Uint8Array[] = [];
    for (let run = 0; run < EXPORT_RUNS; run++) {
      const t0 = performance.now();
      const prepared = await r.prepareFrames(settings);
      if (!prepared.ok) throw new Error(prepared.error.message);
      const t1 = performance.now();
      const frames: RenderedFrame[] = [];
      for await (const frame of r.renderFrames(prepared.value))
        frames.push(frame);
      const t2 = performance.now();
      const context: ExportContext = {
        render: settings,
        projectSha256: '0'.repeat(64),
        characterName: spec.name,
        credits,
        build: {
          appVersion: '0.0.0-perf',
          threeVersion: '0.186.1',
          backend: r.backend,
        },
        pivotPx: [
          prepared.value.framing.pivotPx[0],
          prepared.value.framing.pivotPx[1],
        ],
      };
      const phases: ExportProgress['phase'][] = [];
      const result = await client.run(frames, exportSettings, context, {
        onProgress: p => {
          if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
        },
      });
      const t3 = performance.now();
      if (!result.ok) throw new Error(result.error.message);
      expect(phases).toContain('encode');
      zips.push(result.value.zip);
      runs.push({
        prepareMs: t1 - t0,
        renderMs: t2 - t1,
        encodeMs: t3 - t2,
        totalMs: t3 - t0,
        frames: prepared.value.jobs.length,
        zipBytes: result.value.zip.byteLength,
      });
    }
    // P-04: performance work never changes output; every run gives the same ZIP.
    for (const zip of zips.slice(1)) {
      expect(
        zip.length === zips[0]!.length &&
          zip.every((v, k) => v === zips[0]![k]),
      ).toBe(true);
    }
    const totals = runs.map(x => x.totalMs);
    const encodes = runs.map(x => x.encodeMs);
    const perFrame = runs.map(x => x.renderMs / Math.max(1, x.frames));
    expect(runs.every(x => x.frames === 4 * 8 * 8)).toBe(true);
    await writePerfReport('m3-export-p07', {
      ac: ['AC-EXP-026.1', 'AC-PIX-033.1'],
      ...(await reportEnvironment(r.renderer)),
      case: '64 px, 8 directions, 4 clips (idle, walk, jog, sword-attack) x 8 frames, scale 1, aseprite-json, perf character (8 parts), export worker',
      budgets: {
        totalMs: EXPORT_BUDGET_MS,
        encodePackageMs: ENCODE_BUDGET_MS,
        renderPerFrameMs: RENDER_PER_FRAME_BUDGET_MS,
      },
      runs: runs.map(x => ({
        prepareMs: ms(x.prepareMs),
        renderMs: ms(x.renderMs),
        encodePackageMs: ms(x.encodeMs),
        totalMs: ms(x.totalMs),
        zipBytes: x.zipBytes,
      })),
      medianTotalMs: ms(median(totals)),
      medianEncodePackageMs: ms(median(encodes)),
      medianRenderPerFrameMs: ms(median(perFrame)),
    });
    if (await perfGate()) {
      expect(median(totals)).toBeLessThanOrEqual(EXPORT_BUDGET_MS);
      expect(median(encodes)).toBeLessThanOrEqual(ENCODE_BUDGET_MS);
      expect(median(perFrame)).toBeLessThanOrEqual(RENDER_PER_FRAME_BUDGET_MS);
    }
  }, 900_000);

  it('AC-PIX-034.2, AC-UX-067.1 (engine share): look preset switches rebuild within 300 ms; a cached part swap and a style change show within 150 ms', async () => {
    const looks = await Promise.all(
      LOOK_PRESET_IDS.map(async id => ({
        id,
        settings: settingsWith(walk8(), lookFields(await loadLookPreset(id))),
      })),
    );
    live = await createPerfRenderer({settings: looks[0]!.settings});
    const p = live;
    const r = p.renderer;
    r.seek(0.2);
    await gpuIdle(r.renderer);

    // Look presets: each switch cold (first compile), then two warm cycles.
    const order = [...looks.slice(1), looks[0]!];
    const cold: Record<string, number> = {};
    for (const look of order)
      cold[look.id] = await timeToFrame(p, () =>
        r.setRenderSettings(look.settings),
      );
    const warm: number[] = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const look of order)
        warm.push(
          await timeToFrame(p, () => r.setRenderSettings(look.settings)),
        );
    }

    // Character changes with cached parts (AC-UX-067.1 engine share).
    const base = perfCharacter();
    const swapped: CharacterSpec = {
      ...base,
      parts: {...base.parts, hair: {ref: ALT_HAIR}},
    };
    const chibiUrl = Object.values(CHIBI_URLS)[0];
    if (chibiUrl === undefined) throw new Error('chibi preset not served');
    const chibi: CharacterSpec = {
      ...base,
      style: 'chibi',
      anatomy: anatomyPresetSchema.parse(await json(chibiUrl)).values,
    };
    const partSwapCold = await timeToFrame(p, () => r.setCharacter(swapped));
    const partSwap: number[] = [];
    const styleChange: number[] = [];
    for (let i = 0; i < 4; i++) {
      partSwap.push(await timeToFrame(p, () => r.setCharacter(base)));
      partSwap.push(await timeToFrame(p, () => r.setCharacter(swapped)));
    }
    await timeToFrame(p, () => r.setCharacter(base));
    for (let i = 0; i < 4; i++) {
      styleChange.push(await timeToFrame(p, () => r.setCharacter(chibi)));
      styleChange.push(await timeToFrame(p, () => r.setCharacter(base)));
    }

    const coldValues = Object.values(cold);
    await writePerfReport('m3-structural', {
      ac: ['AC-PIX-034.2', 'AC-UX-067.1'],
      ...(await reportEnvironment(r.renderer)),
      measure: 'change -> preview frame drawn -> GPU idle (no readback)',
      budgets: {rebuildMs: REBUILD_BUDGET_MS, changeMs: CHANGE_BUDGET_MS},
      lookSwitchColdMs: Object.fromEntries(
        Object.entries(cold).map(([k, v]) => [k, ms(v)]),
      ),
      lookSwitchWarmMs: summary(warm),
      partSwapColdMs: ms(partSwapCold),
      partSwapCachedMs: summary(partSwap),
      styleChangeMs: summary(styleChange),
    });
    if (await perfGate()) {
      expect(Math.max(...coldValues)).toBeLessThanOrEqual(REBUILD_BUDGET_MS);
      expect(Math.max(...warm)).toBeLessThanOrEqual(REBUILD_BUDGET_MS);
      expect(summary(partSwap).p95).toBeLessThanOrEqual(CHANGE_BUDGET_MS);
      expect(summary(styleChange).p95).toBeLessThanOrEqual(CHANGE_BUDGET_MS);
    }
  }, 300_000);
});
