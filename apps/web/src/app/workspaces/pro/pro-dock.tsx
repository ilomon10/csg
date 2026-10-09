import {t} from '../../../shared/i18n';
import type {KeyboardEvent, ReactElement} from 'react';
import {Timeline} from '../../../features/animation';
import {Tabs} from '../../../shared/ui';
import type {TabItem} from '../../../shared/ui';
import {useDocument} from '../../../shared/document';
import type {DocumentStore} from '../../../shared/document';
import {useViewport} from '../../../shared/viewport';
import {sharedViewportStore} from '../../viewport';

/** Dock tab ids (REQ-UX-005). */
export type DockTab = 'timeline' | 'material-graph' | 'post-graph';

/** The dock tabs in order. */
export const DOCK_TABS: readonly TabItem[] = [
  {id: 'timeline', label: t('pro.dock.timeline')},
  {id: 'material-graph', label: t('pro.dock.materialGraph')},
  {id: 'post-graph', label: t('pro.dock.postGraph')},
];

/**
 * The timeline of the preview clip. Frame, play state and "Show export frames" live in the
 * shared viewport store, so seeking, play/pause and frame stepping drive the viewport
 * (REQ-ANM-017, REQ-ANM-018).
 */
function DockTimeline({store}: {readonly store: DocumentStore}): ReactElement {
  const clip = useViewport(sharedViewportStore, s => s.previewClip);
  const playing = useViewport(sharedViewportStore, s => s.playing);
  const frame = useViewport(sharedViewportStore, s => s.frame);
  const exportFrames = useViewport(
    sharedViewportStore,
    s => s.showExportFrames,
  );
  const frameCount = useDocument(
    store,
    s => s.doc?.render.animations.find(a => a.clipId === clip)?.frameCount ?? 8,
  );
  return (
    <Timeline
      frameCount={frameCount}
      frame={frame}
      playing={playing}
      onFrameChange={f => sharedViewportStore.seekToFrame(f)}
      onPlayingChange={on => sharedViewportStore.setPlaying(on)}
      exportFrames={exportFrames}
      onExportFramesChange={on => sharedViewportStore.setShowExportFrames(on)}
    />
  );
}

/** Props of {@link ProDock}. */
export interface ProDockProps {
  readonly store: DocumentStore;
  readonly tab: DockTab;
  readonly onTab: (tab: DockTab) => void;
  readonly collapsed: boolean;
  readonly maximized: boolean;
  /** Escape on the tab list while maximized restores the dock (AC-UX-005.2). */
  readonly onRestore: () => void;
}

/**
 * The bottom dock (REQ-UX-005): Timeline, Material graph and Post graph. The graph tabs show a
 * notice until the shader graph editor arrives (M4).
 */
export function ProDock({
  store,
  tab,
  onTab,
  collapsed,
  maximized,
  onRestore,
}: ProDockProps): ReactElement {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key === 'Escape' &&
      maximized &&
      (e.target as HTMLElement).getAttribute('role') === 'tab'
    ) {
      e.preventDefault();
      e.stopPropagation();
      onRestore();
    }
  };
  return (
    <div className="pro-dock__inner" onKeyDown={onKeyDown}>
      <Tabs
        label={t('pro.dockTabs')}
        tabs={DOCK_TABS}
        value={tab}
        onChange={id => onTab(id as DockTab)}
        panelClassName="pro-dock__panel"
      >
        {active =>
          collapsed ? null : active === 'timeline' ? (
            <DockTimeline store={store} />
          ) : (
            <p className="pro-hint" data-testid="graph-notice">
              {t('pro.dock.graphSoon')}
            </p>
          )
        }
      </Tabs>
    </div>
  );
}
