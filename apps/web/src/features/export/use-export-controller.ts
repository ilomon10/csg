import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  EngineError,
  ExportPlan,
  ExportProgress,
  ExportWarning,
} from '@csg/engine';
import {defaultExportSettings} from '@csg/parts-schema';
import type {ExportSettings, ProjectDocument} from '@csg/parts-schema';
import {collectCredits} from './export-credits';
import {createZipDownload} from './export-download';
import type {ZipDownload} from './export-download';
import {EXPORT_TEXT} from './export-text';
import type {ExportHostDeps} from './export-types';
import type * as RunExportModule from './run-export';
import type {ExportOutcome} from './run-export';

type RunModule = typeof RunExportModule;

/** A settings change; `undefined` removes an optional field. */
export type ExportPatch = {
  [K in keyof ExportSettings]?: ExportSettings[K] | undefined;
};

/** Where the dialog is in the flow. */
export type ExportStage =
  'settings' | 'licence' | 'running' | 'done' | 'cancelled' | 'failed';

/** Finished export, as the dialog shows it. */
export interface ExportDone {
  readonly zipName: string;
  readonly size: number;
  readonly files: ReadonlyArray<{name: string; size: number}>;
  readonly warnings: readonly ExportWarning[];
  readonly notes: readonly EngineError[];
}

/** Plan of the current settings: the size refusal runs before any rendering (REQ-EXP-025). */
export type PlanState =
  | {readonly kind: 'loading'}
  | {readonly kind: 'ok'; readonly plan: ExportPlan}
  | {readonly kind: 'refused'; readonly error: EngineError};

/** State and actions of the export dialog. */
export interface ExportController {
  readonly stage: ExportStage;
  readonly doc: ProjectDocument | null;
  readonly settings: ExportSettings;
  readonly patch: (next: ExportPatch) => void;
  readonly plan: PlanState;
  readonly licenceWarnings: readonly ExportWarning[];
  readonly progress: ExportProgress | null;
  /** Text for the dialog's `aria-live` region: phase changes and quarters, not every frame. */
  readonly live: string;
  readonly done: ExportDone | null;
  readonly error: EngineError | null;
  readonly start: () => void;
  readonly confirmLicences: () => void;
  readonly backToSettings: () => void;
  readonly cancel: () => void;
  readonly downloadAgain: () => void;
}

function phaseText(p: ExportProgress): string {
  const label =
    p.phase === 'render'
      ? EXPORT_TEXT.rendering
      : p.phase === 'encode'
        ? EXPORT_TEXT.encoding
        : EXPORT_TEXT.packaging;
  return `${label} ${p.done} / ${p.total}`;
}

/** The export flow: snapshot, size check, licence gate, run, cancel, download. */
export function useExportController(
  deps: ExportHostDeps,
  open: boolean,
): ExportController {
  const [stage, setStage] = useState<ExportStage>('settings');
  const [doc, setDoc] = useState<ProjectDocument | null>(null);
  const [settings, setSettings] = useState<ExportSettings>(
    defaultExportSettings(),
  );
  const [plan, setPlan] = useState<PlanState>({kind: 'loading'});
  const [licenceWarnings, setLicenceWarnings] = useState<
    readonly ExportWarning[]
  >([]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [live, setLive] = useState('');
  const [done, setDone] = useState<ExportDone | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const [engine, setEngine] = useState<RunModule | null>(null);
  const abort = useRef<AbortController | null>(null);
  const download = useRef<ZipDownload | null>(null);
  const snapshot = useRef<ProjectDocument | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const lastBucket = useRef(-1);

  // Open: read the live document for the form, load the engine chunk.
  useEffect(() => {
    if (!open) return;
    const current = depsRef.current.getDocument();
    setDoc(current);
    setSettings(current?.export ?? defaultExportSettings());
    setStage('settings');
    setDone(null);
    setError(null);
    setProgress(null);
    let alive = true;
    void import('./run-export').then(m => {
      if (alive) setEngine(m);
    });
    return () => {
      alive = false;
      abort.current?.abort();
      download.current?.dispose();
      download.current = null;
    };
  }, [open]);

  // The size refusal, recomputed on every settings change (AC-EXP-025.1).
  useEffect(() => {
    if (!engine || !doc) {
      setPlan({kind: 'loading'});
      return;
    }
    const result = engine.planFor(doc, settings);
    setPlan(
      result.ok
        ? {kind: 'ok', plan: result.value}
        : {kind: 'refused', error: result.error},
    );
  }, [engine, doc, settings]);

  const patch = useCallback((next: ExportPatch) => {
    setSettings(prev => {
      const merged: Record<string, unknown> = {...prev, ...next};
      for (const [k, v] of Object.entries(merged)) {
        if (v === undefined) delete merged[k];
      }
      return merged as ExportSettings;
    });
  }, []);

  const reportProgress = useCallback((p: ExportProgress) => {
    setProgress(p);
    // Announce on phase changes and every quarter, not every frame.
    const bucket =
      p.total === 0 ? 0 : Math.min(4, Math.floor((p.done / p.total) * 4));
    const key = ['render', 'encode', 'package'].indexOf(p.phase) * 8 + bucket;
    if (key !== lastBucket.current) {
      lastBucket.current = key;
      setLive(phaseText(p));
    }
  }, []);

  const run = useCallback(
    async (
      snap: ProjectDocument,
      registry: Awaited<ReturnType<ExportHostDeps['getRegistry']>>,
    ) => {
      if (!engine) return;
      setStage('running');
      setProgress(null);
      lastBucket.current = -1;
      const controller = new AbortController();
      abort.current = controller;
      const outcome: ExportOutcome = await engine.runExport({
        snapshot: snap,
        settings,
        deps: depsRef.current,
        registry,
        signal: controller.signal,
        onProgress: reportProgress,
      });
      abort.current = null;
      if (outcome.kind === 'cancelled') {
        setStage('cancelled');
        setLive(EXPORT_TEXT.cancelled);
      } else if (outcome.kind === 'failed') {
        setError(outcome.error);
        setStage('failed');
        setLive(`${EXPORT_TEXT.failed}: ${outcome.error.code}`);
      } else {
        const dl = createZipDownload(outcome.zipName, outcome.zip);
        download.current?.dispose();
        download.current = dl;
        dl.save(); // exactly one download (AC-EXP-017.1)
        depsRef.current.onDownloaded?.(outcome.zipName);
        setDone({
          zipName: outcome.zipName,
          size: outcome.zip.byteLength,
          files: outcome.files,
          warnings: outcome.warnings,
          notes: outcome.notes,
        });
        setStage('done');
        setLive(`${EXPORT_TEXT.done}: ${outcome.zipName}`);
      }
    },
    [engine, settings, reportProgress],
  );

  const start = useCallback(() => {
    const live = depsRef.current.getDocument();
    if (!live || !engine || plan.kind !== 'ok') return;
    // The document as of this click; later edits cannot change this export.
    const snap = structuredClone(live);
    snapshot.current = snap;
    depsRef.current.onSettingsChange?.(settings);
    void (async () => {
      const registry = await depsRef.current.getRegistry();
      const warnings = engine.licenseWarnings(collectCredits(snap, registry));
      setLicenceWarnings(warnings);
      if (warnings.length > 0) {
        setStage('licence');
        return;
      }
      await run(snap, registry);
    })();
  }, [engine, plan.kind, settings, run]);

  const confirmLicences = useCallback(() => {
    const snap = snapshot.current;
    if (!snap) return;
    void depsRef.current.getRegistry().then(reg => run(snap, reg));
  }, [run]);

  const backToSettings = useCallback(() => {
    setStage('settings');
    setError(null);
    setDone(null);
    setProgress(null);
  }, []);

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  const downloadAgain = useCallback(() => {
    download.current?.save();
  }, []);

  return {
    stage,
    doc,
    settings,
    patch,
    plan,
    licenceWarnings,
    progress,
    live,
    done,
    error,
    start,
    confirmLicences,
    backToSettings,
    cancel,
    downloadAgain,
  };
}
