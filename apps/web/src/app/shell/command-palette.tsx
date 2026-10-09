import {commandTitle, t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {useMemo, useRef, useState} from 'react';
import type {KeyboardEvent, ReactElement} from 'react';
import {fuzzyRank, useShortcutScope} from '../../shared/shortcuts';
import type {CommandDef} from '../../shared/shortcuts';
import {Dialog} from '../../shared/ui';
import {chordFor} from './top-bar';
import {useMiniStore} from './mini-store';
import {useShell} from './shell-context';

/** Maximum rows rendered; ranking still covers every command. */
export const PALETTE_LIMIT = 50;

function PaletteBody({onClose}: {readonly onClose: () => void}): ReactElement {
  const {registry} = useShell();
  const ref = useRef<HTMLDivElement>(null);
  useShortcutScope('modal', ref);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rows = useMemo<CommandDef[]>(() => {
    const all = registry.all();
    if (query.trim() === '') {
      const recent = registry.recent().flatMap(id => {
        const c = registry.get(id);
        return c ? [c] : [];
      });
      const rest = all
        .filter(c => !recent.includes(c))
        .sort((a, b) => commandTitle(a.id).localeCompare(commandTitle(b.id)));
      return [...recent, ...rest].slice(0, PALETTE_LIMIT);
    }
    return fuzzyRank(query, all, commandTitle).slice(0, PALETTE_LIMIT);
  }, [registry, query]);

  const reasonOf = (c: CommandDef): string | null => {
    const key = c.disabledReason?.() ?? null;
    return key === null ? null : t(key as MessageKey);
  };

  const run = (c: CommandDef | undefined) => {
    if (c === undefined || reasonOf(c) !== null) return;
    onClose();
    void registry.run(c.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[active]);
    }
  };

  const listId = 'csg-palette-list';
  return (
    <div ref={ref} className="shell-palette">
      <input
        ref={input}
        className="shell-palette__input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={
          rows[active] ? `csg-cmd-${rows[active]?.id}` : undefined
        }
        aria-label={t('palette.title')}
        placeholder={t('palette.placeholder')}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        className="shell-palette__list"
        aria-label={t('palette.title')}
      >
        {rows.length === 0 ? (
          <li className="shell-palette__empty" role="presentation">
            {t('palette.empty')}
          </li>
        ) : null}
        {rows.map((c, i) => {
          const reason = reasonOf(c);
          const chord = chordFor(c.id);
          return (
            <li
              key={c.id}
              id={`csg-cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={reason !== null ? true : undefined}
              data-active={i === active}
              className="shell-palette__row"
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span className="shell-palette__title">{commandTitle(c.id)}</span>
              {reason === null ? null : (
                <span className="shell-palette__reason">
                  {t('palette.disabled', {reason})}
                </span>
              )}
              {chord === null ? null : (
                <kbd className="csg-mono shell-kbd">{chord}</kbd>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The command palette (REQ-UX-018, REQ-UX-019): fuzzy search, recent first, disabled with reason. */
export function CommandPalette(): ReactElement | null {
  const {overlays} = useShell();
  const open = useMiniStore(overlays, o => o.palette);
  const close = () => overlays.update({palette: false});
  // The Dialog reads this once on open; the input is mounted by then.
  const initialFocus = {
    get current(): HTMLElement | null {
      return document.querySelector<HTMLElement>('.shell-palette__input');
    },
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('palette.title')}
      width={560}
      initialFocus={initialFocus}
    >
      {open ? <PaletteBody onClose={close} /> : null}
    </Dialog>
  );
}
