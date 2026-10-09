import {t} from '../../../shared/i18n';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import type {TintSlot} from '@csg/parts-schema';
import {
  CharacterFileMenu,
  PartLibrary,
  RandomizeMenu,
} from '../../../features/composer';
import {openExport} from '../../../features/export';
import type {Catalog} from '../../../shared/catalog';
import {useDocument} from '../../../shared/document';
import type {CommandDef} from '../../../shared/shortcuts';
import {useShortcutScope} from '../../../shared/shortcuts';
import {Button, IconButton, Splitter, announce} from '../../../shared/ui';
import {CharacterViewport, useBusyRefs} from '../../viewport';
import {usePrefs, useShell} from '../../shell/shell-context';
import {WorkspaceExportDialog} from '../export-host';
import {
  clearFocusRequest,
  focusByKey,
  peekFocusRequest,
} from '../focus-request';
import type {InspectorTab} from '../focus-request';
import {
  VIEW_ONLY_BELOW,
  useCatalog,
  useCharacterName,
  useProjectTarget,
  useRenderSource,
  useStructuralTiming,
  useWindowSize,
} from '../use-workspace';
import {useWorkspaceCommands} from '../use-workspace-commands';
import {ProDock} from './pro-dock';
import type {DockTab} from './pro-dock';
import {INSPECTOR_TABS, ProInspector} from './pro-inspector';
import {LIMITS, clampLayout, dockMax, layoutMode} from './pro-layout';
import './pro.css';
import {useMeasuredHeight} from './use-measure';

const DEFAULTS = {library: 280, inspector: 320, dock: 240} as const;
const PERSIST_DELAY_MS = 200;

/**
 * The Pro workspace (REQ-UX-001 to REQ-UX-006): part library, viewport, inspector tabs and a
 * bottom dock, each a named landmark, with splitters that work by pointer and keyboard and
 * persist, and drawers at narrower widths. It edits the same document as Easy.
 */
export function ProView(): ReactElement {
  const catalog = useCatalog();
  if (catalog === null) {
    return (
      <p className="pro-status" role="status">
        {t('ws.loading')}
      </p>
    );
  }
  return <ProBody catalog={catalog} />;
}

function focusSelectedTab(root: HTMLElement | null): void {
  requestAnimationFrame(() => {
    root
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  });
}

function ProBody({catalog}: {readonly catalog: Catalog}): ReactElement {
  const busyRefs = useBusyRefs();
  const services = useShell();
  const {prefs, store} = services;
  const prefsNow = usePrefs();
  const target = useProjectTarget(catalog);
  const render = useRenderSource();
  const name = useCharacterName();
  const {timing, onFramePresented} = useStructuralTiming();
  const {width, height: windowHeight} = useWindowSize();
  const mode = layoutMode(width);
  const rootRef = useRef<HTMLDivElement>(null);
  const libRef = useRef<HTMLElement>(null);
  const vpRef = useRef<HTMLElement>(null);
  const inspRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const areaHeight = useMeasuredHeight(rootRef) || windowHeight - 48;
  useShortcutScope('library', libRef);
  useShortcutScope('viewport', vpRef);
  useShortcutScope('inspector', inspRef);
  useShortcutScope('timeline', dockRef);

  const [request] = useState(peekFocusRequest);
  useEffect(() => {
    clearFocusRequest();
    if (request?.focusKey === undefined) return;
    const key = request.focusKey;
    let tries = 0;
    const attempt = (): void => {
      if (focusByKey(rootRef.current ?? document, key) || ++tries > 20) return;
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [request]);

  const [sizes, setSizes] = useState(() => {
    const l = prefs.get().layout;
    return {library: l.libraryPx, inspector: l.inspectorPx, dock: l.dockPx};
  });
  const latest = useRef(sizes);
  latest.current = sizes;
  const persist = useCallback(() => {
    const cur = prefs.get().layout;
    const s = latest.current;
    if (
      cur.libraryPx === s.library &&
      cur.inspectorPx === s.inspector &&
      cur.dockPx === s.dock
    ) {
      return;
    }
    prefs.set({
      layout: {
        ...cur,
        libraryPx: s.library,
        inspectorPx: s.inspector,
        dockPx: s.dock,
      },
    });
  }, [prefs]);
  useEffect(() => {
    const id = setTimeout(persist, PERSIST_DELAY_MS);
    return () => clearTimeout(id);
  }, [sizes, persist]);
  useEffect(() => persist, [persist]);

  const layout = clampLayout(
    {
      ...prefsNow.layout,
      libraryPx: sizes.library,
      inspectorPx: sizes.inspector,
      dockPx: sizes.dock,
    },
    windowHeight,
    areaHeight,
  );
  const setCollapsed = (
    part: 'library' | 'inspector' | 'dock',
    on: boolean,
  ) => {
    const cur = prefs.get().layout;
    prefs.set({layout: {...cur, collapsed: {...cur.collapsed, [part]: on}}});
  };

  const [maximized, setMaximized] = useState(false);
  const [drawer, setDrawer] = useState<'library' | 'inspector' | null>(
    request !== null && mode === 'tablet' ? 'inspector' : null,
  );
  const [tabletDockOpen, setTabletDockOpen] = useState(false);
  const docked = mode === 'full';
  const libDrawer = !docked;
  const inspDrawer = mode === 'tablet';
  const libCollapsed = docked && layout.collapsed.library;
  const inspCollapsed = !inspDrawer && layout.collapsed.inspector;
  const dockCollapsed =
    !maximized && (mode === 'tablet' ? !tabletDockOpen : layout.collapsed.dock);

  // The drawer toggles live in the shell top bar (REQ-UX-006), registered through services.
  const {topBarActions} = services;
  const drawerOpen = drawer;
  useEffect(() => {
    if (docked) {
      topBarActions.set({actions: []});
      return;
    }
    topBarActions.set({
      actions: [
        {
          id: 'library',
          label: t('pro.drawer.library'),
          expanded: drawerOpen === 'library',
          controls: 'pro-library',
          onClick: () => setDrawer(d => (d === 'library' ? null : 'library')),
        },
        ...(inspDrawer
          ? [
              {
                id: 'inspector',
                label: t('pro.drawer.inspector'),
                expanded: drawerOpen === 'inspector',
                controls: 'pro-inspector',
                onClick: () =>
                  setDrawer(d => (d === 'inspector' ? null : 'inspector')),
              },
            ]
          : []),
      ],
    });
  }, [docked, inspDrawer, drawerOpen, topBarActions]);
  useEffect(() => () => topBarActions.set({actions: []}), [topBarActions]);
  // The toggle sits in the top bar, outside this view: opening moves focus into the drawer so
  // Escape (handled on the root) closes it, and closing returns focus to the toggle (REQ-UX-006).
  const lastDrawer = useRef<'library' | 'inspector' | null>(null);
  useEffect(() => {
    const prev = lastDrawer.current;
    lastDrawer.current = drawer;
    if (drawer !== null) {
      const panel = drawer === 'library' ? libRef.current : inspRef.current;
      panel
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    } else if (prev !== null) {
      document
        .querySelector<HTMLElement>(`[data-testid="bar-action-${prev}"]`)
        ?.focus();
    }
  }, [drawer]);

  const setInspectorTab = (tab: InspectorTab) => {
    prefs.set({inspectorTab: tab});
    if (inspDrawer) setDrawer('inspector');
  };
  const showDock = (tab: DockTab) => {
    prefs.set({dockTab: tab});
    if (mode === 'tablet') setTabletDockOpen(true);
    else setCollapsed('dock', false);
    focusSelectedTab(dockRef.current);
  };
  const toggleDock = () => {
    if (mode === 'tablet') setTabletDockOpen(o => !o);
    else setCollapsed('dock', !prefs.get().layout.collapsed.dock);
  };
  const toggleMaximize = () => setMaximized(m => !m);

  const commands = useRef<() => readonly CommandDef[]>(() => []);
  commands.current = () => [
    {
      id: 'dock.toggle',
      titleKey: 'cmd.dock.toggle',
      category: 'dock',
      run: toggleDock,
    },
    {
      id: 'dock.timeline',
      titleKey: 'cmd.dock.timeline',
      category: 'dock',
      run: () => showDock('timeline'),
    },
    {
      id: 'dock.materialGraph',
      titleKey: 'cmd.dock.materialGraph',
      category: 'dock',
      run: () => showDock('material-graph'),
    },
    {
      id: 'dock.postGraph',
      titleKey: 'cmd.dock.postGraph',
      category: 'dock',
      run: () => showDock('post-graph'),
    },
    {
      id: 'dock.maximize',
      titleKey: 'cmd.dock.maximize',
      category: 'dock',
      run: toggleMaximize,
    },
    ...INSPECTOR_TABS.map((tab, i): CommandDef => ({
      id: `inspector.tab${i + 1}`,
      titleKey: `cmd.inspector.tab${i + 1}`,
      category: 'inspector',
      run: () => {
        setInspectorTab(tab);
        focusSelectedTab(inspRef.current);
        announce(t(`pro.tab.${tab}`));
      },
    })),
  ];
  useWorkspaceCommands(() => commands.current());

  const undo = useDocument(store, s => s.undo);
  const redo = useDocument(store, s => s.redo);
  const readOnly = useDocument(store, s => s.readOnly);
  const label = name === '' ? t('ws.character') : name;
  const dockHeight = dockCollapsed
    ? LIMITS.dockStrip
    : Math.min(layout.dockPx, dockMax(windowHeight, areaHeight));
  const colorChannel = request?.channel as TintSlot | undefined;

  const viewport = (
    <CharacterViewport
      target={target}
      render={render}
      label={label}
      variant="pro"
      onBackend={backend => services.diagnostics.reportRenderer({backend})}
      onFramePresented={onFramePresented}
    />
  );

  if (width < VIEW_ONLY_BELOW) {
    return (
      <div className="pro pro--view-only" data-testid="pro">
        <section
          className="pro-viewport"
          aria-label={t('pro.viewport')}
          data-region={t('pro.viewport')}
        >
          {viewport}
        </section>
        <p className="pro-hint pro-hint--center">{t('ws.viewOnly')}</p>
      </div>
    );
  }

  const style = {
    '--pro-lib': `${Math.min(layout.libraryPx, Math.round(width * 0.9))}px`,
    '--pro-insp': `${Math.min(layout.inspectorPx, Math.round(width * 0.9))}px`,
    '--pro-dock': `${dockHeight}px`,
  } as React.CSSProperties;

  const closeDrawer = () => setDrawer(null);
  const collapseButton = (
    part: 'library' | 'inspector',
    collapsed: boolean,
    drawerMode: boolean,
  ): ReactElement =>
    drawerMode ? (
      <IconButton
        icon="x"
        label={t('pro.drawer.close')}
        onClick={closeDrawer}
      />
    ) : (
      <IconButton
        icon={
          (part === 'library') === collapsed ? 'chevron-right' : 'chevron-left'
        }
        label={t(
          `pro.${collapsed ? 'expand' : 'collapse'}.${part}` as 'pro.expand.library',
        )}
        aria-expanded={!collapsed}
        aria-controls={`pro-${part}`}
        onClick={() => setCollapsed(part, !collapsed)}
      />
    );

  return (
    <div
      ref={rootRef}
      className="pro"
      data-testid="pro"
      data-mode={mode}
      data-maximized={maximized}
      style={style}
      onKeyDown={e => {
        if (e.key === 'Escape' && drawer !== null) {
          e.stopPropagation();
          closeDrawer();
        }
      }}
    >
      <div className="pro-upper" inert={maximized}>
        <aside
          ref={libRef}
          id="pro-library"
          className="pro-library"
          aria-label={t('pro.library')}
          data-region={t('pro.library')}
          data-drawer={libDrawer}
          data-open={drawer === 'library'}
          data-collapsed={libCollapsed}
          inert={libDrawer && drawer !== 'library'}
        >
          <div className="pro-head">
            <h2 className="pro-head__title csg-label" hidden={libCollapsed}>
              {t('pro.library')}
            </h2>
            {collapseButton('library', libCollapsed, libDrawer)}
          </div>
          <div className="pro-body" hidden={libCollapsed}>
            <PartLibrary
              target={target}
              catalog={catalog}
              busyRefs={busyRefs}
            />
          </div>
          <div className="pro-foot" hidden={libCollapsed}>
            <RandomizeMenu target={target} />
            <CharacterFileMenu target={target} catalog={catalog} />
          </div>
        </aside>
        {docked && !libCollapsed ? (
          <Splitter
            orientation="vertical"
            label={t('pro.resize.library')}
            value={layout.libraryPx}
            min={LIMITS.library.min}
            max={LIMITS.library.max}
            controls="pro-library"
            onChange={v => setSizes(s => ({...s, library: v}))}
            onReset={() => setSizes(s => ({...s, library: DEFAULTS.library}))}
          />
        ) : null}
        <section
          ref={vpRef}
          className="pro-viewport"
          aria-label={t('pro.viewport')}
          data-region={t('pro.viewport')}
        >
          {viewport}
        </section>
        {!inspDrawer && !inspCollapsed ? (
          <Splitter
            orientation="vertical"
            direction={-1}
            label={t('pro.resize.inspector')}
            value={layout.inspectorPx}
            min={LIMITS.inspector.min}
            max={LIMITS.inspector.max}
            controls="pro-inspector"
            onChange={v => setSizes(s => ({...s, inspector: v}))}
            onReset={() =>
              setSizes(s => ({...s, inspector: DEFAULTS.inspector}))
            }
          />
        ) : null}
        <aside
          ref={inspRef}
          id="pro-inspector"
          className="pro-inspector"
          aria-label={t('pro.inspector')}
          data-region={t('pro.inspector')}
          data-drawer={inspDrawer}
          data-open={drawer === 'inspector'}
          data-collapsed={inspCollapsed}
          inert={inspDrawer && drawer !== 'inspector'}
        >
          <div className="pro-head">
            <div className="pro-head__tools" hidden={inspCollapsed}>
              <IconButton
                icon="undo"
                label={
                  undo === null
                    ? t('easy.undo')
                    : t('easy.undoLabel', {label: undo.label})
                }
                disabled={undo === null || readOnly}
                onClick={() => services.stepHistory('undo')}
              />
              <IconButton
                icon="redo"
                label={
                  redo === null
                    ? t('easy.redo')
                    : t('easy.redoLabel', {label: redo.label})
                }
                disabled={redo === null || readOnly}
                onClick={() => services.stepHistory('redo')}
              />
              <Button
                small
                variant="primary"
                icon="download"
                onClick={() => openExport()}
              >
                {t('easy.export')}
              </Button>
            </div>
            {collapseButton('inspector', inspCollapsed, inspDrawer)}
          </div>
          <div className="pro-body" hidden={inspCollapsed}>
            <ProInspector
              catalog={catalog}
              target={target}
              store={store}
              tab={prefsNow.inspectorTab}
              onTab={setInspectorTab}
              timing={timing}
              {...(colorChannel ? {focusChannel: colorChannel} : {})}
            />
          </div>
        </aside>
      </div>
      {maximized ? null : (
        <Splitter
          orientation="horizontal"
          direction={-1}
          label={t('pro.resize.dock')}
          value={dockHeight}
          min={LIMITS.dockMin}
          max={dockMax(windowHeight, areaHeight)}
          controls="pro-dock"
          onChange={v => setSizes(s => ({...s, dock: v}))}
          onReset={() => setSizes(s => ({...s, dock: DEFAULTS.dock}))}
        />
      )}
      <section
        ref={dockRef}
        id="pro-dock"
        className="pro-dock"
        aria-label={t('pro.dock')}
        data-region={t('pro.dock')}
        data-collapsed={dockCollapsed}
        data-maximized={maximized}
      >
        <ProDock
          store={store}
          tab={prefsNow.dockTab}
          onTab={tab => showDock(tab)}
          collapsed={dockCollapsed}
          maximized={maximized}
          onRestore={() => {
            setMaximized(false);
            focusSelectedTab(dockRef.current);
          }}
        />
        <div className="pro-dock__tools">
          <IconButton
            icon={dockCollapsed ? 'chevron-right' : 'chevron-down'}
            label={t(dockCollapsed ? 'pro.expand.dock' : 'pro.collapse.dock')}
            aria-expanded={!dockCollapsed}
            aria-controls="pro-dock"
            onClick={toggleDock}
          />
          <Button
            small
            variant="ghost"
            aria-pressed={maximized}
            aria-keyshortcuts="Control+Shift+M"
            onClick={toggleMaximize}
          >
            {t(maximized ? 'pro.restore.dock' : 'pro.maximize.dock')}
          </Button>
        </div>
      </section>
      {drawer !== null ? (
        <button
          type="button"
          className="pro-scrim"
          tabIndex={-1}
          aria-label={t('pro.drawer.close')}
          onClick={closeDrawer}
        />
      ) : null}
      <WorkspaceExportDialog catalog={catalog} />
    </div>
  );
}
