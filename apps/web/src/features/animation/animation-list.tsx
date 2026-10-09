import {t} from '../../shared/i18n';
import {useState, type KeyboardEvent, type ReactElement} from 'react';
import type {AnimationSelection} from '@csg/parts-schema';
import {Icon, IconButton} from '../../shared/ui';
import {clipDisplayName} from './animation-model';
import type {AnimationCatalog, PanelClip} from './animation-model';
import {ClipSettings} from './clip-settings';

/** Props of {@link AnimationList}. */
export interface AnimationListProps {
  readonly selections: readonly AnimationSelection[];
  readonly catalog: AnimationCatalog;
  /** Clip refs the current style excludes: those entries carry a warning (REQ-ANA-027). */
  readonly excluded: ReadonlySet<string>;
  readonly onMove: (index: number, delta: -1 | 1) => void;
  readonly onRemove: (index: number) => void;
  readonly onPatch: (
    index: number,
    patch: {
      [K in keyof AnimationSelection]?: AnimationSelection[K] | undefined;
    },
  ) => void;
  /** Called when an entry is chosen, to show its clip in the preview. */
  readonly onPreview?: (clipRef: string) => void;
}

/**
 * The selected animations in export order (REQ-ANM-004): reorder with Alt+Up/Down or the move
 * buttons, remove, and expand one entry for its settings.
 */
export function AnimationList({
  selections,
  catalog,
  excluded,
  onMove,
  onRemove,
  onPatch,
  onPreview,
}: AnimationListProps): ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const clipOf = (ref: string): PanelClip | null =>
    catalog.clips.find(c => c.ref === ref) ?? null;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!event.altKey) return;
    const delta =
      event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(index, delta);
    const to = index + delta;
    if (open === index) setOpen(to);
    // Keep focus on the moved entry's button after the list re-renders.
    const list = event.currentTarget.closest('ol');
    queueMicrotask(() => {
      list
        ?.querySelectorAll<HTMLButtonElement>('.csg-anim-sel__name')
        [to]?.focus();
    });
  };

  return (
    <ol className="csg-anim-sel" aria-label={t('animation.selected')}>
      {selections.map((selection, index) => {
        const clip = clipOf(selection.clipId);
        const name = clipDisplayName(catalog, selection.clipId);
        const warn = excluded.has(selection.clipId);
        const expanded = open === index;
        return (
          <li key={index} className="csg-anim-sel__item">
            <div className="csg-anim-sel__row">
              <button
                type="button"
                className="csg-anim-sel__name"
                aria-expanded={expanded}
                aria-label={t('animation.settings', {name})}
                onKeyDown={e => onKey(e, index)}
                onClick={() => {
                  setOpen(expanded ? null : index);
                  onPreview?.(selection.clipId);
                }}
              >
                {warn ? <Icon name="warning" /> : null}
                <span>{selection.label}</span>
                <span className="csg-mono csg-anim-sel__meta">
                  {selection.frameCount} f · {selection.fps} fps
                </span>
              </button>
              {clip === null ? (
                <span className="csg-anim-clip__why">
                  {t('animation.notFound')}
                </span>
              ) : null}
              <IconButton
                icon="chevron-left"
                label={t('animation.moveUp', {name})}
                disabled={index === 0}
                className="csg-anim-rot-up"
                onClick={() => onMove(index, -1)}
              />
              <IconButton
                icon="chevron-right"
                label={t('animation.moveDown', {name})}
                disabled={index === selections.length - 1}
                className="csg-anim-rot-down"
                onClick={() => onMove(index, 1)}
              />
              <IconButton
                icon="trash"
                label={t('animation.remove', {name})}
                onClick={() => {
                  if (open === index) setOpen(null);
                  onRemove(index);
                }}
              />
            </div>
            {expanded ? (
              <ClipSettings
                selection={selection}
                clip={clip}
                otherLabels={
                  new Set(
                    selections.filter((_, i) => i !== index).map(s => s.label),
                  )
                }
                onPatch={patch => onPatch(index, patch)}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
