// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createDefaultCharacterSpec,
  createProjectDocument,
  defaultRenderSettings,
} from '@csg/parts-schema';
import type {AssetLicense, ProjectDocument} from '@csg/parts-schema';
import {ExportDialog, closeExport, openExport} from './index';
import type {ExportHostDeps} from './index';

const CC0: AssetLicense = {
  license: 'CC0-1.0',
  author: 'Test',
  commercialUse: 'yes',
  attributionRequired: false,
};
const UNKNOWN: AssetLicense = {
  license: 'other',
  author: 'Someone',
  commercialUse: 'unknown',
  attributionRequired: false,
};

function makeDoc(
  over: {size?: number; frames?: number; scales?: number[]} = {},
) {
  const base = createProjectDocument(createDefaultCharacterSpec());
  const render = {
    ...defaultRenderSettings('side'),
    resolution: {width: over.size ?? 32, height: over.size ?? 32},
    directions: 1 as const,
    animations: [
      {
        clipId: 'builtin:test/walk' as never,
        label: 'walk',
        frameCount: over.frames ?? 2,
        fps: 8,
        loop: true,
        timing: 'fit' as const,
      },
    ],
  };
  return {
    ...base,
    render,
    export: {...base.export, scales: over.scales ?? [1]},
  } as ProjectDocument;
}

interface Harness {
  deps: ExportHostDeps;
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  posted: unknown[];
  setDoc(d: ProjectDocument): void;
}

function harness(
  doc: ProjectDocument,
  opts: {
    unknownRef?: string;
    slow?: boolean;
    notice?: ExportHostDeps['styleNotice'];
  } = {},
): Harness {
  let current = doc;
  const posted: unknown[] = [];
  const release = vi.fn();
  const frameCount = 2;
  const acquire = vi.fn(async () => ({
    ok: true as const,
    value: {
      backend: 'webgl2' as const,
      renderer: {
        backend: 'webgl2' as const,
        setCharacter: async () => ({ok: true as const, value: undefined}),
        prepareFrames: async () => ({
          ok: true as const,
          value: {
            settings: current.render,
            jobs: Array.from({length: frameCount}, () => ({})),
            framing: {pivotPx: [8, 14]},
            warnings: [],
            mirrored: new Map(),
          },
        }),
        async *renderFrames(
          _p: unknown,
          o: {signal?: AbortSignal; onProgress?: (p: unknown) => void},
        ) {
          for (let i = 0; i < frameCount; i++) {
            if (opts.slow) {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, 5000);
                o.signal?.addEventListener('abort', () => {
                  clearTimeout(t);
                  reject({code: 'EXP_CANCELLED', message: 'cancelled'});
                });
              });
            }
            o.onProgress?.({phase: 'render', done: i + 1, total: frameCount});
            yield {
              clipId: 'walk',
              direction: 0,
              frame: i,
              sourceFrame: i,
              timeSec: i / 8,
              durationMs: 125,
              width: 32,
              height: 32,
              pixels: new Uint8ClampedArray(32 * 32 * 4),
            };
          }
        },
      },
      registry: {
        licenseOf: (ref: string) => (ref === opts.unknownRef ? UNKNOWN : CC0),
      },
      release,
    },
  }));
  const deps = {
    getDocument: () => current,
    getRegistry: async () =>
      ({
        licenseOf: (ref: string) => (ref === opts.unknownRef ? UNKNOWN : CC0),
      }) as never,
    acquireRenderer: acquire as never,
    createWorker: () => {
      const listeners: Record<string, Array<(e: unknown) => void>> = {};
      return {
        addEventListener: (t: string, f: (e: unknown) => void) =>
          (listeners[t] ??= []).push(f),
        postMessage: (req: {id: number; context: unknown}) => {
          posted.push(req);
          queueMicrotask(() => {
            const send = (data: unknown) =>
              listeners['message']?.forEach(f => f({data}));
            send({
              type: 'progress',
              id: req.id,
              phase: 'encode',
              done: 1,
              total: 1,
            });
            send({
              type: 'done',
              id: req.id,
              zipName: 'character.zip',
              zip: new Uint8Array([80, 75, 5, 6]),
              files: [{name: 'CREDITS.txt', mime: 'text/plain', size: 10}],
              warnings: [],
            });
          });
        },
        terminate: () => undefined,
      } as unknown as Worker;
    },
    appVersion: 'test',
    threeVersion: 'r186',
    styleNotice: opts.notice ?? null,
  } satisfies ExportHostDeps;
  return {deps, acquire, release, posted, setDoc: d => (current = d)};
}

let clicks: HTMLAnchorElement[] = [];
// The dialog loads the engine-backed run module lazily. Warm that import once so the first test
// is not charged for a cold transform (it exceeds findBy's 1 s under a loaded machine).
beforeAll(async () => {
  await import('./run-export');
}, 60_000);
beforeEach(() => {
  clicks = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this);
  });
});
afterEach(() => {
  act(() => closeExport());
  cleanup();
  vi.restoreAllMocks();
});

async function openAndWait(h: Harness) {
  render(<ExportDialog deps={h.deps} />);
  act(() => openExport());
  const start = await screen.findByTestId('export-start');
  await waitFor(() =>
    expect((start as HTMLButtonElement).disabled).toBe(false),
  );
  return start;
}

describe('ExportDialog', () => {
  it('AC-EXP-025.1: a 9216 px wide sheet is refused before any renderer is taken', async () => {
    const h = harness(makeDoc({size: 128, frames: 9, scales: [8]}));
    render(<ExportDialog deps={h.deps} />);
    act(() => openExport());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('EXP_TOO_LARGE');
    expect(
      (screen.getByTestId('export-start') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(h.acquire).not.toHaveBeenCalled();
  });

  it('AC-CMP-044.1: an unsupported style disables Export with the reason as text and description', async () => {
    const h = harness(makeDoc(), {
      notice: {
        code: 'CMP_STYLE_UNSUPPORTED',
        message: 'x',
        style: 'voxel',
        species: 'human',
        fallback: {style: 'realistic', species: 'human'},
        label: 'Voxel',
        fallbackLabel: 'Realistic',
      },
    });
    render(<ExportDialog deps={h.deps} />);
    act(() => openExport());
    const reason = await screen.findByTestId('export-blocked');
    expect(reason.textContent).toContain(
      'Voxel is coming soon. Choose a supported style to export.',
    );
    const btn = screen.getByTestId('export-start') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('AC-EXP-021.2: CC0 only shows no licence dialog; AC-EXP-017.1: one ZIP download', async () => {
    const h = harness(makeDoc());
    const start = await openAndWait(h);
    await userEvent.click(start);
    await screen.findByTestId('export-done');
    expect(screen.queryByText('Unknown license')).toBeNull();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('character.zip');
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it('AC-EXP-021.1: an unknown licence blocks rendering until confirmed; cancel exports nothing', async () => {
    const doc = makeDoc();
    const h = harness(doc, {unknownRef: doc.character.body.ref});
    const start = await openAndWait(h);
    await userEvent.click(start);
    expect(await screen.findByText('Unknown license')).toBeTruthy();
    expect(screen.getByText(doc.character.body.ref)).toBeTruthy();
    expect(h.acquire).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('licence-cancel'));
    expect(h.acquire).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
    await userEvent.click(await screen.findByTestId('export-start'));
    await userEvent.click(await screen.findByTestId('licence-confirm'));
    await screen.findByTestId('export-done');
    expect(h.acquire).toHaveBeenCalledTimes(1);
  });

  it('AC-EXP-023.1: progress reaches the live region', async () => {
    const h = harness(makeDoc());
    const start = await openAndWait(h);
    await userEvent.click(start);
    await screen.findByTestId('export-done');
    const live = screen.getByTestId('export-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('Export complete');
  });

  it('AC-EXP-024.1: cancel stops within 250 ms, no download, renderer released', async () => {
    const h = harness(makeDoc(), {slow: true});
    const start = await openAndWait(h);
    await userEvent.click(start);
    const cancel = await screen.findByTestId('export-cancel');
    const t0 = performance.now();
    await userEvent.click(cancel);
    await screen.findByTestId('export-cancelled');
    expect(performance.now() - t0).toBeLessThan(250);
    expect(clicks).toHaveLength(0);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it('REQ-EXP-024: the export uses the document as of the click, not later edits', async () => {
    const doc = makeDoc();
    const h = harness(doc);
    const start = await openAndWait(h);
    await userEvent.click(start);
    h.setDoc({...doc, character: {...doc.character, name: 'Changed later'}});
    await screen.findByTestId('export-done');
    const req = h.posted[0] as {context: {characterName: string}};
    expect(req.context.characterName).toBe(doc.character.name);
  });
});
