import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
  Result,
  StyleUnsupportedNotice,
} from '@csg/engine';
import type {ExportSettings, ProjectDocument} from '@csg/parts-schema';

/**
 * The renderer an export borrows (spec 005 REQ-EXP-001, spec 003 REQ-PIX-030). The app shell's
 * `RendererLease` from `engineHost.lease` fits this shape as is.
 */
export interface ExportRendererLease {
  /** Only the export side of the renderer is used. */
  readonly renderer: Pick<
    EngineCharacterRenderer,
    'setCharacter' | 'prepareFrames' | 'renderFrames' | 'backend'
  >;
  readonly registry: EngineAssetRegistry;
  /** Frees the renderer so the preview can take it back. Idempotent. */
  release(): void;
}

/**
 * What the host view passes to `ExportDialog`. Features never import `src/app`, so everything
 * that needs the engine host, the worker policy or the document store comes in here.
 */
export interface ExportHostDeps {
  /** The current project; the export works on a deep copy taken when the user clicks Export. */
  getDocument(): ProjectDocument | null;
  /** The shared asset registry (licences of the used assets, REQ-EXP-021). */
  getRegistry(): Promise<EngineAssetRegistry>;
  /**
   * Takes the renderer exclusively for one export and gives it back through `release()`
   * (architecture D4). Failures are results, never throws. Called only after the user has
   * confirmed any licence warning, so no rendering starts before that (AC-EXP-021.1). The export
   * calls `setCharacter(snapshot.character)` itself, so a fresh lease needs no setup.
   */
  acquireRenderer(): Promise<Result<ExportRendererLease, EngineError>>;
  /**
   * Creates a fresh export worker through the `csg-worker-url` Trusted Types policy
   * (REQ-GEN-014); called once per export. Typically
   * `() => new Worker(createWorkerScriptUrl(EXPORT_WORKER_URL), {type: 'module', name: 'export'})`.
   */
  createWorker(): Worker;
  /** App version for `CREDITS.txt` and the manifest. */
  readonly appVersion: string;
  /** Pinned three.js revision for the manifest, for example `r186`. */
  readonly threeVersion: string;
  /**
   * The active `CMP_STYLE_UNSUPPORTED` notice of the preview (REQ-CMP-043), or `null`. While it
   * is set, Export is disabled with the reason as visible text (REQ-CMP-044).
   */
  readonly styleNotice?: StyleUnsupportedNotice | null;
  /** Called with the settings when an export starts, so the host can store them (an undoable command). */
  onSettingsChange?(settings: ExportSettings): void;
  /** Called after a finished download; hosts may show a toast. */
  onDownloaded?(zipName: string): void;
}
