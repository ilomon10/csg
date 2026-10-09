import {useCallback, useState} from 'react';
import type {RenderSettings} from '@csg/parts-schema';
import {useDocument} from '../../shared/document';
import type {DocumentStore} from '../../shared/document';
import {dispatchRenderPatch} from './render-model';
import type {RenderIssue, RenderPatch} from './render-model';
import {measureStructural} from './structural-timing';
import type {StructuralTiming} from './structural-timing';

/** Options of one edit. */
export interface ApplyOptions {
  /** Folds keyboard bursts into one undo entry (REQ-UX-023). */
  readonly coalesceKey?: string;
  /** Recompiles or resizes: its time to show is measured and reported. */
  readonly structural?: string;
}

/** What the panels get from {@link useRenderEditor}. */
export interface RenderEditor {
  readonly render: RenderSettings | null;
  readonly readOnly: boolean;
  /** Field errors of the last rejected edit; cleared by the next accepted one. */
  readonly issues: readonly RenderIssue[];
  /** Validates and dispatches one `render` command; returns the errors (empty on success). */
  apply(
    label: string,
    patch: RenderPatch,
    options?: ApplyOptions,
  ): readonly RenderIssue[];
  clearIssues(): void;
}

/** Binds a panel to the open project's render settings. */
export function useRenderEditor(
  store: DocumentStore,
  timing?: StructuralTiming,
): RenderEditor {
  const render = useDocument(store, s => s.doc?.render ?? null);
  const readOnly = useDocument(store, s => s.readOnly);
  const [issues, setIssues] = useState<readonly RenderIssue[]>([]);
  const apply = useCallback(
    (label: string, patch: RenderPatch, options: ApplyOptions = {}) => {
      let result: readonly RenderIssue[] = [];
      const run = () => {
        result = dispatchRenderPatch(store, label, patch, options.coalesceKey);
      };
      if (timing && options.structural) {
        void measureStructural(options.structural, run, timing);
      } else {
        run();
      }
      setIssues(result);
      return result;
    },
    [store, timing],
  );
  return {render, readOnly, issues, apply, clearIssues: () => setIssues([])};
}
