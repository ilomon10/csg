import {t} from '../../shared/i18n';
import {useRef} from 'react';
import type {ReactElement} from 'react';
import {useShortcutScope} from '../../shared/shortcuts';
import {Button, Dialog, SegmentedControl} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {usePrefs, useShell} from './shell-context';

function SettingsBody(): ReactElement {
  const {prefs} = useShell();
  const p = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  useShortcutScope('modal', ref);
  const motion =
    p.reduceMotion === 'system' ? 'system' : p.reduceMotion ? 'on' : 'off';
  return (
    <div ref={ref} className="shell-settings">
      <div className="shell-field">
        <span id="set-theme" className="csg-label">
          {t('settings.theme')}
        </span>
        <SegmentedControl
          mode="radio"
          labelledBy="set-theme"
          value={p.theme}
          onChange={id =>
            prefs.set({
              theme:
                id === 'light' ? 'light' : id === 'system' ? 'system' : 'dark',
            })
          }
          segments={[
            {id: 'dark', label: t('settings.theme.dark')},
            {id: 'light', label: t('settings.theme.light')},
            {id: 'system', label: t('settings.theme.system')},
          ]}
        />
      </div>
      <div className="shell-field">
        <span id="set-motion" className="csg-label">
          {t('settings.reduceMotion')}
        </span>
        <SegmentedControl
          mode="radio"
          labelledBy="set-motion"
          value={motion}
          onChange={id =>
            prefs.set({reduceMotion: id === 'system' ? 'system' : id === 'on'})
          }
          segments={[
            {id: 'system', label: t('settings.reduceMotion.system')},
            {id: 'on', label: t('settings.reduceMotion.on')},
            {id: 'off', label: t('settings.reduceMotion.off')},
          ]}
        />
      </div>
      <label className="shell-check">
        <input
          type="checkbox"
          checked={p.singleKeyShortcuts}
          onChange={e => prefs.set({singleKeyShortcuts: e.target.checked})}
        />
        <span>
          {t('settings.singleKey')}
          <small className="shell-hint">{t('settings.singleKeyHint')}</small>
        </span>
      </label>
      <label className="shell-check">
        <input
          type="checkbox"
          checked={p.showHomeOnStartup}
          onChange={e => prefs.set({showHomeOnStartup: e.target.checked})}
        />
        <span>{t('settings.showHome')}</span>
      </label>
    </div>
  );
}

/** Settings dialog (REQ-UX-034, REQ-UX-016, REQ-UX-038, REQ-UX-087). */
export function SettingsDialog(): ReactElement {
  const {overlays} = useShell();
  const open = useMiniStore(overlays, o => o.settings);
  const close = () => overlays.update({settings: false});
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('settings.title')}
      width={460}
      footer={<Button onClick={close}>{t('settings.close')}</Button>}
    >
      {open ? <SettingsBody /> : null}
    </Dialog>
  );
}
