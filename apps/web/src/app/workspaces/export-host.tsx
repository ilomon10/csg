import {useMemo} from 'react';
import type {ReactElement} from 'react';
import type {StyleUnsupportedNotice} from '@csg/engine';
import type {ExportSettings} from '@csg/parts-schema';
import {ExportDialog} from '../../features/export';
import type {ExportHostDeps} from '../../features/export';
import {toastQueue} from '../../shared/ui';
import {APP_VERSION, THREE_VERSION} from '../shell/renderer-status';
import {useShell} from '../shell/shell-context';
import {EXPORT_WORKER_URL, createWorkerScriptUrl} from '../trusted-types';
import {engineHost} from '../viewport';
import type {Catalog} from '../../shared/catalog';
import {useDocument} from '../../shared/document';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Props of {@link WorkspaceExportDialog}. */
export interface WorkspaceExportDialogProps {
  /** Supplies the style and species pairs that render (REQ-CMP-043, REQ-CMP-044). */
  readonly catalog: Catalog;
}

/**
 * Mounts the export dialog for the open project (spec 005, REQ-UX-064). Easy and Pro each mount
 * one, so there is exactly one. It supplies the engine host, the worker policy and the document
 * store; the export feature itself imports nothing from the app.
 */
export function WorkspaceExportDialog({
  catalog,
}: WorkspaceExportDialogProps): ReactElement {
  const {store} = useShell();
  const style = useDocument(store, s => s.doc?.character.style);
  const species = useDocument(store, s => s.doc?.character.species);
  const styleNotice = useMemo<StyleUnsupportedNotice | null>(() => {
    if (style === undefined || species === undefined) return null;
    if (
      catalog.availableCombos.some(([s, sp]) => s === style && sp === species)
    ) {
      return null;
    }
    const label = `${cap(style)} ${cap(species)}`;
    return {
      code: 'CMP_STYLE_UNSUPPORTED',
      message: `${label} is coming soon. Showing Realistic Human for now.`,
      style,
      species,
      fallback: {style: 'realistic', species: 'human'},
      label,
      fallbackLabel: 'Realistic Human',
    };
  }, [catalog, style, species]);
  const deps = useMemo<ExportHostDeps>(
    () => ({
      getDocument: () => store.getState().doc,
      getRegistry: () => engineHost.registry(),
      // The mounted viewport keeps the one renderer; the export borrows it (the engine's
      // exclusive operations pause and restore the preview). With no viewport, a fresh lease.
      acquireRenderer: async () => {
        // A viewport lease may still be loading (Export clicked right after opening): wait.
        const ready = await engineHost.borrowWhenReady();
        if (!ready.ok) return ready;
        if (ready.value !== null) return {ok: true, value: ready.value};
        return engineHost.lease(document.createElement('canvas'), {
          settings: store.getState().doc!.render,
          onError: () => undefined,
        });
      },
      createWorker: () =>
        new Worker(
          createWorkerScriptUrl(EXPORT_WORKER_URL) as unknown as string,
          {type: 'module', name: 'export'},
        ),
      appVersion: APP_VERSION,
      threeVersion: THREE_VERSION,
      styleNotice,
      onSettingsChange: (settings: ExportSettings) => {
        store.dispatch({
          label: 'Export settings',
          feature: 'render',
          apply: doc =>
            JSON.stringify(doc.export) === JSON.stringify(settings)
              ? null
              : {...doc, export: settings},
        });
      },
      onDownloaded: zipName =>
        toastQueue.push({message: `Exported ${zipName}`, tone: 'info'}),
    }),
    [store, styleNotice],
  );
  return <ExportDialog deps={deps} />;
}
