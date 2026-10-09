import {t} from '../../../shared/i18n';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {
  MAX_PROJECT_JSON_BYTES,
  parseProjectDocumentJson,
} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import {openExport} from '../../../features/export';
import type {
  ProjectListMeta,
  ProjectRepository,
} from '../../../shared/persistence';
import {toastQueue} from '../../../shared/ui';
import {createNewProjectDocument} from '../../viewport';
import {useMiniStore} from '../../shell/mini-store';
import {motionReduced} from '../../shell/prefs-store';
import {usePrefs, useShell} from '../../shell/shell-context';
import {HomeScreen} from './home-screen';
import type {HomeItemActions} from './home-screen';
import {
  PRESET_PREFIX,
  cryptoUint32,
  orderLineup,
  pickUniform,
} from './lineup-model';
import type {HomeItem} from './lineup-model';
import {useHomeFrames} from './use-home-frames';
import type {HomeFramesDeps} from './use-home-frames';

/** Optional seams for tests; the app renders `<HomeView />` bare. */
export interface HomeViewProps {
  /** Uniform 32-bit integers; default `crypto.getRandomValues` (REQ-UX-077). */
  readonly random?: () => number;
  readonly frames?: Pick<HomeFramesDeps, 'create' | 'host'>;
}

interface LoadedSpec {
  readonly editedAt: number;
  readonly spec: CharacterSpec;
}

const SPEC_BATCH = 6;

/** The home view: connects the home screen to the project repository, the catalog and the router. */
export function HomeView({
  random = cryptoUint32,
  frames: framesDeps,
}: HomeViewProps = {}): ReactElement {
  const services = useShell();
  const prefs = usePrefs();
  const catalog = useMiniStore(services.catalog, s => s.catalog);
  const restorePending = useMiniStore(services.state, s => s.restore !== null);
  const [metas, setMetas] = useState<readonly ProjectListMeta[] | null>(null);
  const [specVersion, setSpecVersion] = useState(0);
  const specs = useRef(new Map<string, LoadedSpec>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const keysSaved = useRef(new Set<string>());
  // updateMeta is read-modify-write: serialise every metadata write of this view.
  const metaQueue = useRef<Promise<unknown>>(Promise.resolve());
  const updateMeta = useCallback(
    (id: string, patch: Parameters<ProjectRepository['updateMeta']>[1]) => {
      const run = metaQueue.current.then(() =>
        services.repo()?.updateMeta(id, patch),
      );
      metaQueue.current = run.catch(() => undefined);
      return run;
    },
    [services],
  );

  const reload = useCallback(async (): Promise<readonly ProjectListMeta[]> => {
    const repo = services.repo();
    const list = repo === null ? [] : await repo.list();
    setMetas(list);
    return list;
  }, [services]);

  useEffect(() => {
    let live = true;
    void reload().then(() => undefined);
    const off = services.repo()?.onChange(() => {
      if (live) void reload();
    });
    return () => {
      live = false;
      off?.();
    };
  }, [services, reload]);

  const items = useMemo(
    () => orderLineup(metas ?? [], catalog?.characterPresets ?? []),
    [metas, catalog],
  );

  // Specs of the saved characters, nearest the front of the lineup first (REQ-UX-080).
  useEffect(() => {
    const repo = services.repo();
    if (repo === null || metas === null) return;
    let live = true;
    void (async () => {
      const wanted = items.filter(
        i =>
          i.kind === 'saved' &&
          specs.current.get(i.id)?.editedAt !== i.editedAt,
      );
      for (let k = 0; k < wanted.length; k += SPEC_BATCH) {
        const batch = wanted.slice(k, k + SPEC_BATCH);
        await Promise.all(
          batch.map(async item => {
            const result = await repo.get(item.id);
            if (result.ok && item.editedAt !== null) {
              specs.current.set(item.id, {
                editedAt: item.editedAt,
                spec: result.value.doc.character,
              });
            }
          }),
        );
        if (!live) return;
        setSpecVersion(v => v + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [services, metas, items]);

  const entries = useMemo(() => {
    void specVersion;
    const out: Array<{id: string; spec: CharacterSpec}> = [];
    for (const item of items) {
      if (item.kind === 'preset') {
        const preset = catalog?.characterPresets.find(
          p => `${PRESET_PREFIX}${p.id}` === item.id,
        );
        if (preset !== undefined)
          out.push({id: item.id, spec: preset.character});
      } else {
        const loaded = specs.current.get(item.id);
        if (loaded !== undefined) out.push({id: item.id, spec: loaded.spec});
      }
    }
    return out;
  }, [items, catalog, specVersion]);

  const {source, service} = useHomeFrames(catalog, {
    diagnostics: services.diagnostics,
    ...framesDeps,
  });

  const effectiveId =
    items.find(i => i.id === selectedId)?.id ?? items[0]?.id ?? null;

  // Frames: the selected character first, then outward. While the restore prompt is open no
  // project data may reach the engine (AC-UX-045.2).
  useEffect(() => {
    if (service === null || restorePending || entries.length === 0) return;
    const at = entries.findIndex(e => e.id === effectiveId);
    service.request(entries, at < 0 ? 0 : at);
  }, [service, restorePending, entries, effectiveId]);

  // Remember each saved character's frames key so Delete can remove its frames (AC-UX-079.2).
  useEffect(() => {
    if (source === null || metas === null) return;
    const sync = (): void => {
      const repo = services.repo();
      if (repo === null || service === null) return;
      for (const meta of metas) {
        const key = service.keyOf(meta.projectId);
        if (key === undefined || service.frames(key) === undefined) continue;
        if (meta.homeFramesKey === key) continue;
        const token = `${meta.projectId}:${key}`;
        if (keysSaved.current.has(token)) continue;
        keysSaved.current.add(token);
        void updateMeta(meta.projectId, {homeFramesKey: key});
      }
    };
    sync();
    return source.subscribe(sync);
  }, [source, service, metas, services, updateMeta]);

  const open = useCallback(
    (item: HomeItem) =>
      services.router.navigate({view: 'project', projectId: item.id}),
    [services],
  );

  const startFromPreset = useCallback(
    async (item: HomeItem) => {
      const repo = services.repo();
      const preset = catalog?.characterPresets.find(
        p => `${PRESET_PREFIX}${p.id}` === item.id,
      );
      if (repo === null || preset === undefined) {
        services.reportError('UX_STORAGE_UNAVAILABLE');
        return;
      }
      const projectId = globalThis.crypto.randomUUID();
      // The preset's camera sets the render defaults of the project (REQ-UX-078).
      const doc = createNewProjectDocument(
        preset.character,
        preset.camera ?? 'side',
      );
      const saved = await repo.put({
        format: 'sprite-project-record',
        version: 1,
        meta: {
          projectId,
          name: preset.name,
          lastEditedAt: Date.now(),
          pinned: false,
        },
        doc,
      });
      if (!saved.ok) {
        services.reportError(saved.error.code, 'error');
        return;
      }
      await services.router.navigate({view: 'project', projectId});
    },
    [services, catalog],
  );

  const onPrimary = useCallback(
    (item: HomeItem | null) => {
      if (item === null) void services.router.navigate({view: 'wizard'});
      else if (item.kind === 'saved') void open(item);
      else void startFromPreset(item);
    },
    [services, open, startFromPreset],
  );

  const actions: HomeItemActions = useMemo(
    () => ({
      open: item => void open(item),
      async duplicate(item) {
        const repo = services.repo();
        if (repo === null) return;
        const record = await repo.get(item.id);
        if (!record.ok) {
          services.reportError(record.error.code);
          return;
        }
        const projectId = globalThis.crypto.randomUUID();
        const name = t('home.copy', {name: item.name}).slice(0, 64);
        const put = await repo.put({
          ...record.value,
          meta: {
            projectId,
            name,
            lastEditedAt: Date.now(),
            pinned: false,
          },
        });
        if (!put.ok) {
          services.reportError(put.error.code, 'error');
          return;
        }
        await reload();
        setSelectedId(projectId);
        toastQueue.push({
          tone: 'success',
          message: t('home.toast.duplicated', {name}),
        });
      },
      async rename(item, name) {
        const result = await updateMeta(item.id, {name});
        if (result !== undefined && !result.ok) {
          services.reportError(result.error.code);
        }
        await reload();
      },
      async exportProject(item) {
        await open(item);
        const unsubscribe = services.store.subscribe(() => {
          if (services.store.getState().projectId !== item.id) return;
          unsubscribe();
          openExport();
        });
      },
      async togglePin(item) {
        const result = await updateMeta(item.id, {pinned: !item.pinned});
        if (result !== undefined && !result.ok) {
          services.reportError(result.error.code);
        }
        await reload();
        toastQueue.push({
          tone: 'info',
          message: t(
            item.pinned ? 'home.toast.unpinned' : 'home.toast.pinned',
            {
              name: item.name,
            },
          ),
        });
      },
      async remove(item) {
        const at = items.findIndex(i => i.id === item.id);
        const next = items[at + 1] ?? items[at - 1];
        await services.repo()?.remove(item.id);
        specs.current.delete(item.id);
        setSelectedId(next?.id ?? null);
        await reload();
        toastQueue.push({
          tone: 'info',
          message: t('home.toast.deleted', {name: item.name}),
        });
      },
    }),
    [services, items, open, reload, updateMeta],
  );

  const onRandom = useCallback(() => {
    const presets = items.filter(i => i.kind === 'preset');
    const pick = presets[pickUniform(presets.length, random)];
    if (pick !== undefined) setSelectedId(pick.id);
  }, [items, random]);

  const onOpenFile = useCallback(
    async (file: File) => {
      const invalid = (path: string): void => {
        toastQueue.push({
          tone: 'error',
          code: 'UX_PROJECT_INVALID',
          message: `${t('error.UX_PROJECT_INVALID')}${path === '' ? '' : ` (${path})`}`,
        });
      };
      if (file.size > MAX_PROJECT_JSON_BYTES) {
        invalid('');
        return;
      }
      const parsed = parseProjectDocumentJson(await file.text());
      const repo = services.repo();
      if (!parsed.ok) {
        invalid(parsed.issues[0]?.path ?? '');
        return;
      }
      if (repo === null) {
        services.reportError('UX_STORAGE_UNAVAILABLE');
        return;
      }
      const projectId = globalThis.crypto.randomUUID();
      const put = await repo.put({
        format: 'sprite-project-record',
        version: 1,
        meta: {
          projectId,
          name: parsed.value.character.name.slice(0, 64) || 'Imported',
          lastEditedAt: Date.now(),
          pinned: false,
        },
        doc: parsed.value,
      });
      if (!put.ok) {
        services.reportError(put.error.code, 'error');
        return;
      }
      await services.router.navigate({view: 'project', projectId});
    },
    [services],
  );

  return (
    <HomeScreen
      items={items}
      savedLoaded={metas !== null}
      catalogReady={catalog !== null}
      frames={source}
      reducedMotion={motionReduced(prefs, services.win)}
      selectedId={effectiveId}
      autoFocusNew={!restorePending}
      onSelect={setSelectedId}
      onPrimary={onPrimary}
      onNew={() => void services.router.navigate({view: 'wizard'})}
      onRandom={onRandom}
      onOpenFile={file => void onOpenFile(file)}
      actions={actions}
    />
  );
}
