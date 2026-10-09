import {t} from '../../shared/i18n';
import type {ReactElement} from 'react';
import {Button} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {useShell} from './shell-context';

/** Banner of a project open in another tab (REQ-UX-029): editing is disabled until takeover. */
export function TabLockBanner(): ReactElement | null {
  const services = useShell();
  const readOnly = useMiniStore(services.state, s => s.lock === 'read-only');
  if (!readOnly) return null;
  return (
    <div className="shell-banner" role="status" data-testid="tab-lock-banner">
      <strong>{t('tab.banner')}</strong>
      <span className="shell-hide-s">{t('tab.bannerBody')}</span>
      <Button small onClick={() => void services.takeOver()}>
        {t('tab.takeover')}
      </Button>
    </div>
  );
}
