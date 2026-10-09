import {t} from '../../shared/i18n';
import {Suspense, useEffect, useRef} from 'react';
import type {ReactElement} from 'react';
import {useDocument} from '../../shared/document';
import {useShortcutScope} from '../../shared/shortcuts';
import {Announcer, ToastRegion} from '../../shared/ui';
import {CommandPalette} from './command-palette';
import {CrashProbe, useCrashEvents} from './crash-hooks';
import {DiagnosticsDialog} from './diagnostics-dialog';
import {ErrorBoundary} from './error-boundary';
import {HelpOverlay} from './help-overlay';
import {useMiniStore} from './mini-store';
import {RestoreDialog} from './restore-dialog';
import type {ShellServices} from './services';
import {ShareLinkHost} from './share-link-host';
import {SettingsDialog} from './settings-dialog';
import {ShellProvider, usePrefs, useRoute, useShell} from './shell-context';
import {TabLockBanner} from './tab-lock-banner';
import {TopBar} from './top-bar';
import {EasyView, HomeView, ProView, WizardView} from './view-slots';

function ActiveView(): ReactElement {
  const {state, store} = useShell();
  const route = useRoute();
  const {workspace} = usePrefs();
  const phase = useMiniStore(state, s => s.phase);
  const restorePending = useMiniStore(state, s => s.restore !== null);
  const openId = useDocument(store, s => s.projectId);
  if (phase === 'booting')
    return <p className="shell-status">{t('view.starting')}</p>;
  if (restorePending) return <HomeView />;
  switch (route.view) {
    case 'wizard':
      return <WizardView />;
    case 'project':
      if (openId !== route.projectId) {
        return <p className="shell-status">{t('view.loading')}</p>;
      }
      return workspace === 'pro' ? <ProView /> : <EasyView />;
    default:
      return <HomeView />;
  }
}

function Main(): ReactElement {
  const {diagnostics} = useShell();
  const route = useRoute();
  const ref = useRef<HTMLElement>(null);
  const scope = route.view === 'wizard' ? 'wizard' : 'home';
  useShortcutScope(scope, ref);
  return (
    <main
      id="shell-main"
      ref={ref}
      className="shell-main"
      data-region={t('main.label')}
      aria-label={t('main.label')}
      tabIndex={-1}
    >
      <ErrorBoundary
        kind="region"
        name={t('main.label')}
        onCrash={code => diagnostics.recordError(code)}
      >
        <CrashProbe scope="region" name={t('main.label')} />
        <Suspense
          fallback={<p className="shell-status">{t('view.loading')}</p>}
        >
          <ActiveView />
        </Suspense>
      </ErrorBoundary>
    </main>
  );
}

/** The editor shell body: top bar, banner, active view and overlays. */
export function ShellBody(): ReactElement {
  const services = useShell();
  useCrashEvents(services.win);
  useEffect(() => {
    void services.start();
    return services.attachShortcuts();
  }, [services]);
  return (
    <div className="shell">
      <a
        className="shell-skip"
        href="#shell-main"
        onClick={e => {
          e.preventDefault();
          document.getElementById('shell-main')?.focus();
        }}
      >
        {t('skip.main')}
      </a>
      <TopBar />
      <TabLockBanner />
      <Main />
      <CommandPalette />
      <HelpOverlay />
      <SettingsDialog />
      <DiagnosticsDialog />
      <RestoreDialog />
      <ShareLinkHost />
      <ToastRegion id="csg-toasts" />
      <Announcer />
    </div>
  );
}

/** Root of the shell: the root error boundary around the provider (REQ-UX-044). */
export function Shell({
  services,
}: {
  readonly services: ShellServices;
}): ReactElement {
  return (
    <ErrorBoundary
      kind="root"
      name="root"
      onCrash={code => services.diagnostics.recordError(code)}
      downloadBackup={() => services.downloadBackup()}
      reload={() => services.win.location.reload()}
    >
      <CrashProbe scope="root" />
      <ShellProvider services={services}>
        <ShellBody />
      </ShellProvider>
    </ErrorBoundary>
  );
}
