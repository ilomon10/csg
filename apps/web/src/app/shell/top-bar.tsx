import {t} from '../../shared/i18n';
import {useRef, useState, useSyncExternalStore} from 'react';
import type {ReactElement} from 'react';
import {
  formatChord,
  parseChord,
  DEFAULT_SHORTCUTS,
  detectPlatform,
} from '../../shared/shortcuts';
import {Icon, IconButton, SegmentedControl} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {usePrefs, useRoute, useShell} from './shell-context';

/** Display chord of a command's first default binding, e.g. `Ctrl+K`. */
export function chordFor(commandId: string): string | null {
  const def = DEFAULT_SHORTCUTS.find(d => d.commandId === commandId);
  const key = def?.keys[0];
  return key === undefined
    ? null
    : formatChord(parseChord(key), detectPlatform());
}

function SaveStatus(): ReactElement {
  const {state, retrySave} = useShell();
  const status = useMiniStore(state, s => s.saveStatus);
  const text = t(`save.${status}`);
  const icon =
    status === 'saved' ? 'check' : status === 'failed' ? 'warning' : 'dots';
  if (status === 'failed') {
    return (
      <button
        type="button"
        className="csg-btn csg-btn--ghost shell-save"
        data-status={status}
        onClick={() => void retrySave()}
      >
        <Icon name={icon} />
        {text}
      </button>
    );
  }
  return (
    <span className="shell-save csg-mono" data-status={status}>
      <Icon name={icon} />
      {text}
    </span>
  );
}

function ProjectName(): ReactElement | null {
  const {state, renameProject} = useShell();
  const name = useMiniStore(state, s => s.projectName);
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (name === null) return null;
  const commit = () => {
    if (draft !== null && draft.trim() !== '' && draft.trim() !== name) {
      void renameProject(draft);
    }
    setDraft(null);
  };
  return (
    <input
      ref={input}
      className="shell-name"
      aria-label={t('bar.projectName')}
      maxLength={64}
      value={draft ?? name}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') input.current?.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function RendererBadge(): ReactElement | null {
  const {diagnostics, overlays} = useShell();
  const backend = useMiniStore(diagnostics.status, s => s.backend);
  if (backend === null) return null;
  const label = t(`renderer.${backend}`);
  return (
    <button
      type="button"
      className="shell-badge csg-mono"
      data-backend={backend}
      aria-label={t('bar.rendererBadge', {backend: label})}
      title={backend === 'webgl2' ? t('renderer.webgl2Hint') : undefined}
      onClick={() => overlays.update({diagnostics: true})}
    >
      {backend === 'webgl2' ? <Icon name="info" /> : null}
      {label}
    </button>
  );
}

/**
 * The top bar (REQ-UX-001, REQ-UX-027, REQ-UX-042, REQ-UX-053): logo, project name, save state,
 * then search, renderer badge, help, settings and the Easy | Pro toggle. The toggle is shown
 * here only, and only while a project is open.
 */
export function TopBar(): ReactElement {
  const services = useShell();
  const {router, overlays, prefs} = services;
  const route = useRoute();
  const {workspace} = usePrefs();
  const restorePending = useMiniStore(services.state, s => s.restore !== null);
  useSyncExternalStore(overlays.subscribe, overlays.get);
  const inProject = route.view === 'project' && !restorePending;
  const barActions = useMiniStore(services.topBarActions, s => s.actions);
  const palette = chordFor('app.commandPalette');
  return (
    <header
      className="shell-bar"
      data-region={t('bar.label')}
      aria-label={t('bar.label')}
    >
      {route.view === 'home' || route.view === 'startup' ? null : (
        <button
          type="button"
          className="csg-btn csg-btn--icon"
          aria-label={t('bar.home')}
          title={t('bar.home')}
          onClick={() => void router.navigate({view: 'home'})}
        >
          <Icon name="home" />
        </button>
      )}
      <h1 className="shell-logo csg-display">
        <Icon name="logo" />
        <span className="shell-logo__text">{t('app.name')}</span>
      </h1>
      {inProject ? <ProjectName /> : null}
      {inProject ? <SaveStatus /> : null}
      {inProject
        ? barActions.map(a => (
            <button
              key={a.id}
              type="button"
              className="csg-btn"
              data-testid={`bar-action-${a.id}`}
              aria-expanded={a.expanded}
              aria-controls={a.controls}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))
        : null}
      <div className="shell-grow" />
      <button
        type="button"
        className="csg-btn shell-search"
        onClick={() => overlays.update({palette: true})}
      >
        <Icon name="search" />
        <span className="shell-hide-s">{t('bar.search')}</span>
        {palette === null ? null : (
          <kbd className="csg-mono shell-kbd shell-hide-s">{palette}</kbd>
        )}
      </button>
      <RendererBadge />
      <button
        type="button"
        className="csg-btn csg-btn--icon"
        aria-label={t('bar.help')}
        title={t('bar.help')}
        onClick={() => overlays.update({help: true})}
      >
        <Icon name="help" />
      </button>
      <IconButton
        icon="gear"
        label={t('bar.settings')}
        onClick={() => overlays.update({settings: true})}
      />
      {inProject ? (
        <SegmentedControl
          mode="radio"
          label={t('bar.workspace')}
          value={workspace}
          onChange={id => prefs.set({workspace: id === 'pro' ? 'pro' : 'easy'})}
          segments={[
            {id: 'easy', label: t('bar.easy')},
            {id: 'pro', label: t('bar.pro')},
          ]}
        />
      ) : null}
    </header>
  );
}
