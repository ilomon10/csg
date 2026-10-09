/**
 * Test-only mount of the export dialog for `e2e/export.spec.ts` (M3-16). The shell mounts the
 * dialog for real once the top bar lands (M3-15). This entry is reached only through
 * `export-host.html`, which only `vite.e2e.config.ts` builds: the production build (`vite.config.ts`)
 * has no input for it, so nothing here ships.
 */
import '../trusted-types';
import '../csp-setup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {createProjectDocument} from '@csg/parts-schema';
import type {ProjectDocument} from '@csg/parts-schema';
import {ExportDialog, openExport} from '../../features/export';
import type {ExportHostDeps} from '../../features/export';
import '../../shared/ui';
import {EXPORT_WORKER_URL, createWorkerScriptUrl} from '../trusted-types';
import {engineHost} from '../viewport';
import {
  createPreviewCharacter,
  createPreviewSettings,
} from '../viewport/default-character';

const params = new URLSearchParams(location.search);
const frames = Number(params.get('frames') ?? '0');

function makeDoc(): ProjectDocument {
  const base = createProjectDocument(createPreviewCharacter());
  const render = createPreviewSettings();
  return {
    ...base,
    render:
      frames > 0
        ? {
            ...render,
            animations: render.animations.map(a => ({
              ...a,
              frameCount: frames,
            })),
          }
        : render,
  };
}

const doc = makeDoc();

const deps: ExportHostDeps = {
  getDocument: () => doc,
  getRegistry: () => engineHost.registry(),
  async acquireRenderer() {
    const canvas = document.createElement('canvas');
    return engineHost.lease(canvas, {
      settings: doc.render,
      onError: () => undefined,
    });
  },
  createWorker: () =>
    new Worker(createWorkerScriptUrl(EXPORT_WORKER_URL) as unknown as string, {
      type: 'module',
      name: 'export',
    }),
  appVersion: 'e2e',
  threeVersion: 'r186',
};

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <button type="button" id="open-export" onClick={() => openExport()}>
      Export
    </button>
    <ExportDialog deps={deps} />
  </StrictMode>,
);
