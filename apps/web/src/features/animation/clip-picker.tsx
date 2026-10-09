import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {useId, useState, type ReactElement} from 'react';
import {CLIP_CATEGORIES} from '@csg/parts-schema';
import {IconButton} from '../../shared/ui';
import {MAX_ANIMATIONS} from './animation-model';
import type {PanelClip} from './animation-model';

/** Props of {@link ClipPicker}. */
export interface ClipPickerProps {
  readonly clips: readonly PanelClip[];
  /** Clip refs hidden by the style (REQ-ANA-025). */
  readonly excluded: ReadonlySet<string>;
  /** The body's rig; clips on another rig are hidden unless "Show incompatible" is on. */
  readonly bodyRig?: string | undefined;
  /** How many animations are already selected. */
  readonly selectedCount: number;
  readonly onAdd: (clip: PanelClip) => void;
}

/**
 * Clip picker grouped by category with duration, search, and the incompatible-rig toggle
 * (REQ-ANM-001..003, REQ-ANA-025). Excluded clips never appear, in the list or in search.
 */
export function ClipPicker({
  clips,
  excluded,
  bodyRig,
  selectedCount,
  onAdd,
}: ClipPickerProps): ReactElement {
  const id = useId();
  const [query, setQuery] = useState('');
  const [showIncompatible, setShowIncompatible] = useState(false);
  const needle = query.trim().toLowerCase();
  const full = selectedCount >= MAX_ANIMATIONS;

  const candidates = clips.filter(clip => !excluded.has(clip.ref));
  const incompatible = (clip: PanelClip) =>
    bodyRig !== undefined && clip.rig !== bodyRig;
  const hasIncompatible = candidates.some(incompatible);
  const visible = candidates.filter(
    clip =>
      (showIncompatible || !incompatible(clip)) &&
      (needle === '' ||
        clip.name.toLowerCase().includes(needle) ||
        clip.id.includes(needle) ||
        clip.tags.some(tag => tag.toLowerCase().includes(needle))),
  );

  return (
    <div className="csg-anim-picker">
      <div className="csg-anim-picker__tools">
        <label className="csg-sr" htmlFor={`${id}-q`}>
          {t('animation.search')}
        </label>
        <input
          id={`${id}-q`}
          className="csg-anim-input"
          type="search"
          placeholder={t('animation.search')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {hasIncompatible ? (
          <label className="csg-anim-check">
            <input
              type="checkbox"
              checked={showIncompatible}
              onChange={e => setShowIncompatible(e.target.checked)}
            />
            {t('animation.showIncompatible')}
          </label>
        ) : null}
      </div>
      {full ? (
        <p id={`${id}-max`} className="csg-anim-note" role="status">
          {t('animation.max')}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="csg-anim-note">{t('animation.noClips')}</p>
      ) : null}
      {CLIP_CATEGORIES.map(category => {
        const group = visible.filter(clip => clip.category === category);
        if (group.length === 0) return null;
        const headingId = `${id}-${category}`;
        return (
          <section key={category} aria-labelledby={headingId}>
            <h4 id={headingId} className="csg-label csg-anim-heading">
              {t(`animation.category.${category}` as MessageKey)}
            </h4>
            <ul className="csg-anim-clips">
              {group.map(clip => {
                const blocked = incompatible(clip);
                return (
                  <li key={clip.ref} className="csg-anim-clip">
                    <span className="csg-anim-clip__name">{clip.name}</span>
                    {blocked ? (
                      <span className="csg-anim-clip__why">
                        {t('animation.incompatible')}
                      </span>
                    ) : null}
                    <span className="csg-mono csg-anim-clip__dur">
                      {t('animation.duration', {
                        seconds: clip.durationSec.toFixed(2),
                      })}
                    </span>
                    <IconButton
                      icon="plus"
                      label={t('animation.add', {name: clip.name})}
                      disabled={full || blocked}
                      aria-describedby={full ? `${id}-max` : undefined}
                      onClick={() => onAdd(clip)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
