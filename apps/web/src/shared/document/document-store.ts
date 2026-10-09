import type {ProjectDocument} from '@csg/parts-schema';
import type {
  DocCommand,
  DocumentState,
  DocumentStore,
  HistoryContext,
  HistoryEntry,
  HistoryFeature,
} from './types';

/** Entries kept in the history (REQ-UX-022: at least 200). */
export const HISTORY_LIMIT = 200;
/** Edits on one coalesce key closer than this fold into one entry (REQ-UX-023). */
export const COALESCE_WINDOW_MS = 500;

interface Entry {
  label: string;
  feature: HistoryFeature;
  context: HistoryContext;
  /** Immutable snapshots; unchanged subtrees are shared with neighbours. */
  before: ProjectDocument;
  after: ProjectDocument;
  key: string | undefined;
  lastAt: number;
  gesture: boolean;
}

/** Options of {@link createDocumentStore}. */
export interface DocumentStoreOptions {
  readonly limit?: number;
  /** Clock for coalescing; injectable so tests need no fake timers. */
  readonly now?: () => number;
}

/**
 * Creates the document store: one `ProjectDocument`, one linear history of immutable
 * snapshots (D1), selection and save bookkeeping. Serializable state only.
 */
export function createDocumentStore(
  options: DocumentStoreOptions = {},
): DocumentStore {
  const limit = options.limit ?? HISTORY_LIMIT;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();

  let entries: Entry[] = [];
  /** Number of applied entries; `entries[cursor]` is the next redo. */
  let cursor = 0;
  let gestureKey: string | null = null;
  let gestureEntry: Entry | null = null;

  let projectId: string | null = null;
  let doc: ProjectDocument | null = null;
  let revision = 0;
  let savedRevision = 0;
  let readOnly = false;
  let selection: readonly string[] = [];
  let state: DocumentState = snapshot();

  function snapshot(): DocumentState {
    const undo = cursor > 0 ? entries[cursor - 1] : undefined;
    const redo = entries[cursor];
    return {
      projectId,
      doc,
      revision,
      savedRevision,
      readOnly,
      selection,
      undo: undo ? {label: undo.label} : null,
      redo: redo ? {label: redo.label} : null,
      historyLength: entries.length,
    };
  }

  function publish(): void {
    state = snapshot();
    for (const listener of [...listeners]) listener();
  }

  function setDoc(next: ProjectDocument): void {
    doc = next;
    revision += 1;
  }

  function restore(entry: Entry, target: ProjectDocument): HistoryEntry {
    setDoc(target);
    if (entry.context.selection) selection = entry.context.selection;
    return {
      label: entry.label,
      feature: entry.feature,
      context: entry.context,
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(cmd: DocCommand) {
      if (readOnly || doc === null) return;
      const before = doc;
      const after = cmd.apply(before);
      if (after === null || after === before) return;
      const time = now();
      setDoc(after);

      const top = cursor > 0 ? entries[cursor - 1] : undefined;
      // Inside a gesture every command folds into the gesture's single entry.
      if (
        gestureKey !== null &&
        gestureEntry !== null &&
        top === gestureEntry
      ) {
        gestureEntry.after = after;
        gestureEntry.label = cmd.label;
        gestureEntry.lastAt = time;
        publish();
        return;
      }
      if (
        gestureKey === null &&
        top &&
        !top.gesture &&
        cmd.coalesceKey !== undefined &&
        top.key === cmd.coalesceKey &&
        time - top.lastAt < COALESCE_WINDOW_MS &&
        cursor === entries.length
      ) {
        top.after = after;
        top.label = cmd.label;
        top.lastAt = time;
        publish();
        return;
      }
      const entry: Entry = {
        label: cmd.label,
        feature: cmd.feature,
        context: cmd.context ?? {},
        before,
        after,
        key: cmd.coalesceKey,
        lastAt: time,
        gesture: gestureKey !== null,
      };
      // A new command clears the redo branch (REQ-UX-024).
      entries = entries.slice(0, cursor);
      entries.push(entry);
      if (entries.length > limit)
        entries = entries.slice(entries.length - limit);
      cursor = entries.length;
      if (gestureKey !== null) gestureEntry = entry;
      publish();
    },
    beginGesture(key) {
      gestureKey = key;
      gestureEntry = null;
    },
    endGesture() {
      gestureKey = null;
      gestureEntry = null;
    },
    undo() {
      if (readOnly || cursor === 0) return null;
      const entry = entries[cursor - 1];
      if (!entry) return null;
      cursor -= 1;
      const result = restore(entry, entry.before);
      publish();
      return result;
    },
    redo() {
      if (readOnly) return null;
      const entry = entries[cursor];
      if (!entry) return null;
      cursor += 1;
      const result = restore(entry, entry.after);
      publish();
      return result;
    },
    open(id, next) {
      projectId = id;
      doc = next;
      entries = [];
      cursor = 0;
      gestureKey = null;
      gestureEntry = null;
      selection = [];
      readOnly = false;
      revision += 1;
      savedRevision = revision;
      publish();
    },
    markSaved(saved) {
      if (saved === savedRevision) return;
      savedRevision = saved;
      publish();
    },
    setSelection(ids) {
      selection = [...ids];
      publish();
    },
    setReadOnly(value) {
      if (value === readOnly) return;
      readOnly = value;
      publish();
    },
  };
}
