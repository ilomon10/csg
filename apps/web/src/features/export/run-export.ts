/**
 * The export pipeline of the dialog: plan, render on the borrowed renderer, encode in the worker.
 * This module imports the engine at runtime, so the dialog loads it with a dynamic `import()`
 * after it opens (constitution P-07: three.js stays out of the initial chunk).
 */
import {
  createExportWorkerClient,
  exportDirectionLabels,
  emittedFrameCount,
  licenseWarnings,
  planExport,
} from '@csg/engine';
import type {
  EngineAssetRegistry,
  EngineError,
  ExportContext,
  ExportPlan,
  ExportProgress,
  ExportWarning,
  RenderedFrame,
} from '@csg/engine';
import type {ExportSettings, ProjectDocument} from '@csg/parts-schema';
import {collectCredits, projectSha256} from './export-credits';
import type {ExportHostDeps} from './export-types';

export {licenseWarnings, planExport};

/** Result of {@link runExport}. */
export type ExportOutcome =
  | {
      readonly kind: 'done';
      readonly zipName: string;
      readonly zip: Uint8Array;
      readonly files: ReadonlyArray<{name: string; size: number}>;
      readonly warnings: readonly ExportWarning[];
      /** Framing and fps notes from the sampler (`PIX_FRAMING_CLIPPED`, ...). */
      readonly notes: readonly EngineError[];
    }
  | {readonly kind: 'cancelled'}
  | {readonly kind: 'failed'; readonly error: EngineError};

/** Frames the plan expects before rendering: every clip, direction and emitted frame. */
export function estimateFrameCount(doc: ProjectDocument): number {
  const labels = exportDirectionLabels(
    doc.render.directions,
    doc.render.singleFacing,
  );
  const dirs = labels?.length ?? doc.render.directions;
  return doc.render.animations.reduce(
    (sum, a) => sum + emittedFrameCount(a) * dirs,
    0,
  );
}

/**
 * Checks the size limits before any rendering (REQ-EXP-025).
 *
 * @param doc Document whose render settings are exported.
 * @param settings Export settings.
 * @returns The plan or `EXP_TOO_LARGE` and friends.
 */
export function planFor(
  doc: ProjectDocument,
  settings: ExportSettings,
): ReturnType<typeof planExport> {
  return planExport(doc.render, settings, estimateFrameCount(doc));
}

function codeOf(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as {code: unknown}).code)
    : null;
}

function asError(e: unknown): EngineError {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const {code, message} = e as {code: unknown; message?: unknown};
    return {code: String(code), message: String(message ?? code)};
  }
  return {
    code: 'EXP_WORKER_FAILED',
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Input of {@link runExport}. */
export interface RunExportInput {
  /** Deep copy taken when the user clicked Export; never read from the live store again. */
  readonly snapshot: ProjectDocument;
  readonly settings: ExportSettings;
  readonly deps: ExportHostDeps;
  readonly registry: EngineAssetRegistry;
  readonly signal: AbortSignal;
  readonly onProgress: (p: ExportProgress) => void;
}

/**
 * Renders and packages the snapshot. Cancelling (the signal) stops rendering and encoding,
 * terminates the worker and frees the renderer (REQ-EXP-024). Never throws.
 */
export async function runExport(input: RunExportInput): Promise<ExportOutcome> {
  const {snapshot, settings, deps, registry, signal, onProgress} = input;
  const cancelled = (): ExportOutcome => ({kind: 'cancelled'});
  const leased = await deps.acquireRenderer();
  if (!leased.ok) return {kind: 'failed', error: leased.error};
  const lease = leased.value;
  let frames: RenderedFrame[] = [];
  try {
    if (signal.aborted) return cancelled();
    const loaded = await lease.renderer.setCharacter(snapshot.character);
    if (!loaded.ok) return {kind: 'failed', error: loaded.error};
    if (signal.aborted) return cancelled();
    const prepared = await lease.renderer.prepareFrames(snapshot.render, {
      signal,
    });
    if (!prepared.ok) {
      return prepared.error.code === 'EXP_CANCELLED'
        ? cancelled()
        : {kind: 'failed', error: prepared.error};
    }
    // The real plan: the sampler's job count is authoritative (REQ-EXP-025, before any frame).
    const plan: ReturnType<typeof planExport> = planExport(
      snapshot.render,
      settings,
      prepared.value.jobs.length,
    );
    if (!plan.ok) return {kind: 'failed', error: plan.error};
    const total = prepared.value.jobs.length;
    onProgress({phase: 'render', done: 0, total});
    for await (const frame of lease.renderer.renderFrames(prepared.value, {
      signal,
      onProgress: p => onProgress({phase: 'render', done: p.done, total}),
    })) {
      frames.push(frame);
    }
    if (signal.aborted) return cancelled();
    onProgress({phase: 'render', done: total, total});
    const context: ExportContext = {
      render: snapshot.render,
      projectSha256: await projectSha256(snapshot),
      characterName: snapshot.character.name,
      credits: collectCredits(snapshot, registry),
      build: {
        appVersion: deps.appVersion,
        threeVersion: deps.threeVersion,
        backend: lease.renderer.backend,
      },
      pivotPx: [
        prepared.value.framing.pivotPx[0],
        prepared.value.framing.pivotPx[1],
      ],
    };
    const client = createExportWorkerClient({createWorker: deps.createWorker});
    const sent = frames;
    frames = []; // the worker takes the pixel buffers (REQ-EXP-024: released)
    const result = await client.run(sent, settings, context, {
      signal,
      onProgress,
    });
    if (!result.ok) return {kind: 'failed', error: result.error};
    return {
      kind: 'done',
      zipName: result.value.zipName,
      zip: result.value.zip,
      files: result.value.files.map(f => ({name: f.name, size: f.size})),
      warnings: result.value.warnings,
      notes: prepared.value.warnings,
    };
  } catch (e) {
    if (codeOf(e) === 'EXP_CANCELLED') return cancelled();
    return {kind: 'failed', error: asError(e)};
  } finally {
    frames = [];
    lease.release();
  }
}

export type {ExportPlan};
