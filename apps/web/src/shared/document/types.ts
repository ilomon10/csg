import type {EasyCategoryId, ProjectDocument} from '@csg/parts-schema';

/** Which feature a history entry belongs to (spec 009 `HistoryEntry.feature`). */
export type HistoryFeature =
  'composer' | 'anatomy' | 'render' | 'animation' | 'graph';

export type {EasyCategoryId};

/** UI context restored on undo/redo (REQ-UX-024, REQ-UX-051). */
export interface HistoryContext {
  readonly inspectorTab?: string;
  readonly dock?: string;
  readonly selection?: readonly string[];
  readonly easyCategory?: EasyCategoryId;
  /** Control to focus after the undo (AC-UX-051.3). */
  readonly focusKey?: string;
}

/** One undoable edit of the project document. `apply` is pure. */
export interface DocCommand {
  /** Resolved text, for example "Equip Ponytail". */
  readonly label: string;
  readonly feature: HistoryFeature;
  readonly context?: HistoryContext;
  /** Same key less than 500 ms apart folds into one entry (REQ-UX-023). */
  readonly coalesceKey?: string;
  /** Returns the next document, or null (or the same object) for "no change": nothing is recorded. */
  apply(doc: ProjectDocument): ProjectDocument | null;
}

/** What `undo()`/`redo()` hand back so the shell can restore UI context. */
export interface HistoryEntry {
  readonly label: string;
  readonly feature: HistoryFeature;
  readonly context: HistoryContext;
}

/** Immutable snapshot of the store; a new object is created only when something changed. */
export interface DocumentState {
  readonly projectId: string | null;
  readonly doc: ProjectDocument | null;
  /** Bumped by every document change, including undo and redo. */
  readonly revision: number;
  readonly savedRevision: number;
  readonly readOnly: boolean;
  readonly selection: readonly string[];
  readonly undo: {readonly label: string} | null;
  readonly redo: {readonly label: string} | null;
  readonly historyLength: number;
}

/** The single document store with one shared undo history (REQ-UX-022). */
export interface DocumentStore {
  getState(): DocumentState;
  subscribe(listener: () => void): () => void;
  dispatch(cmd: DocCommand): void;
  /** Everything dispatched until `endGesture()` becomes one entry (pointer drag, REQ-UX-023). */
  beginGesture(key: string): void;
  endGesture(): void;
  undo(): HistoryEntry | null;
  redo(): HistoryEntry | null;
  /** Replaces the document and clears the history (REQ-UX-099). */
  open(projectId: string, doc: ProjectDocument): void;
  markSaved(revision: number): void;
  setSelection(ids: readonly string[]): void;
  setReadOnly(readOnly: boolean): void;
}
