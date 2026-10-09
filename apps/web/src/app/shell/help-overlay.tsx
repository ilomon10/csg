import {commandTitle, t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {useRef} from 'react';
import type {ReactElement} from 'react';
import {
  DEFAULT_SHORTCUTS,
  detectPlatform,
  formatChord,
  parseChord,
  useShortcutScope,
} from '../../shared/shortcuts';
import type {ShortcutDef, ShortcutScope} from '../../shared/shortcuts';
import {Dialog} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {useShell} from './shell-context';

const SCOPE_ORDER: readonly ShortcutScope[] = [
  'global',
  'viewport',
  'library',
  'inspector',
  'timeline',
  'graph',
  'easy-preview',
  'easy-panel',
  'home',
  'wizard',
  'modal',
  'prop-fitting',
  'palette',
  'help',
  'tour',
];

/** Registry entries grouped by scope, each entry exactly once (AC-UX-020.1). */
export function groupShortcuts(
  defs: readonly ShortcutDef[],
): Array<{scope: ShortcutScope; defs: ShortcutDef[]}> {
  return SCOPE_ORDER.flatMap(scope => {
    const inScope = defs.filter(d => d.scope === scope);
    return inScope.length > 0 ? [{scope, defs: inScope}] : [];
  });
}

function HelpBody(): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useShortcutScope('modal', ref);
  const platform = detectPlatform();
  return (
    <div ref={ref} className="shell-help">
      {groupShortcuts(DEFAULT_SHORTCUTS).map(group => (
        <section key={group.scope} aria-labelledby={`help-${group.scope}`}>
          <h3 id={`help-${group.scope}`} className="csg-label">
            {t(`help.scope.${group.scope}` as MessageKey)}
          </h3>
          <ul className="shell-help__list">
            {group.defs.map(def => (
              <li
                key={`${def.scope}:${def.commandId}:${def.keys.join('|')}:${def.when ?? ''}`}
                className="shell-help__row"
              >
                <span>{commandTitle(def.commandId)}</span>
                <span className="shell-help__keys">
                  {def.keys.map(key => (
                    <kbd key={key} className="csg-mono shell-kbd">
                      {formatChord(parseChord(key), platform)}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The shortcut overlay, generated from the registry (REQ-UX-020). */
export function HelpOverlay(): ReactElement {
  const {overlays} = useShell();
  const open = useMiniStore(overlays, o => o.help);
  return (
    <Dialog
      open={open}
      onClose={() => overlays.update({help: false})}
      title={t('help.title')}
      width={640}
    >
      {open ? <HelpBody /> : null}
    </Dialog>
  );
}
