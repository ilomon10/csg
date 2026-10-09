import {t, tOr} from '../../shared/i18n';
import type {ReactElement} from 'react';
import type {ClipRef} from '@csg/parts-schema';
import {useDocument} from '../../shared/document';
import type {DocumentStore} from '../../shared/document';
import type {ViewportStore} from '../../shared/viewport';
import {AnimationList} from './animation-list';
import {
  MAX_ANIMATIONS,
  addAnimation,
  clipDisplayName,
  excludedRefs,
  moveAnimation,
  patchAnimation,
  removeAnimation,
} from './animation-model';
import type {AnimationCatalog} from './animation-model';
import {ClipPicker} from './clip-picker';
import './animation.css';

/** Props of {@link AnimationPanel}. */
export interface AnimationPanelProps {
  readonly store: DocumentStore;
  readonly catalog: AnimationCatalog;
  /** Rig of the current body; clips on another rig are hidden by default (REQ-ANM-002). */
  readonly bodyRig?: string;
  /** Receives the chosen clip so the preview shows it at once (REQ-ANM-020). */
  readonly viewport?: Pick<ViewportStore, 'setPreviewClip'>;
}

const EMPTY: readonly never[] = [];

/**
 * The Pro Animation inspector tab (spec 004): a clip picker filtered by the style's excluded
 * clips, 1-32 selections in export order with per-clip settings, and non-blocking warnings for
 * selections the style would break (REQ-ANA-027). Every edit is one command on the store.
 */
export function AnimationPanel({
  store,
  catalog,
  bodyRig,
  viewport,
}: AnimationPanelProps): ReactElement {
  const selections = useDocument(store, s => s.doc?.render.animations ?? EMPTY);
  const style = useDocument(store, s => s.doc?.character.style ?? 'realistic');
  const excluded = excludedRefs(catalog, style);
  const styleName = tOr(
    `composer.style.${style}`,
    style.charAt(0).toUpperCase() + style.slice(1),
  );
  const warned = selections.filter(s => excluded.has(s.clipId));
  const preview = (ref: string) => viewport?.setPreviewClip(ref as ClipRef);

  return (
    <div className="csg-anim">
      <div className="csg-anim__head">
        <h3 className="csg-label">{t('animation.title')}</h3>
        <span className="csg-mono csg-anim-note">
          {t('animation.count', {count: selections.length})}
        </span>
      </div>
      {warned.length > 0 ? (
        <ul className="csg-anim-warn" role="status">
          {warned.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              {t('animation.warn', {
                clip: clipDisplayName(catalog, s.clipId),
                style: styleName,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {selections.length === 0 ? (
        <p className="csg-anim-note">{t('animation.empty')}</p>
      ) : (
        <AnimationList
          selections={selections}
          catalog={catalog}
          excluded={excluded}
          onPreview={preview}
          onMove={(index, delta) =>
            store.dispatch(
              moveAnimation(
                index,
                delta,
                selections[index]?.label ?? 'animation',
              ),
            )
          }
          onRemove={index =>
            store.dispatch(
              removeAnimation(index, selections[index]?.label ?? 'animation'),
            )
          }
          onPatch={(index, patch) =>
            store.dispatch(
              patchAnimation(
                index,
                patch,
                selections[index]?.label ?? 'animation',
              ),
            )
          }
        />
      )}
      <ClipPicker
        clips={catalog.clips}
        excluded={excluded}
        bodyRig={bodyRig}
        selectedCount={Math.min(selections.length, MAX_ANIMATIONS)}
        onAdd={clip => {
          store.dispatch(addAnimation(clip));
          preview(clip.ref);
        }}
      />
    </div>
  );
}
