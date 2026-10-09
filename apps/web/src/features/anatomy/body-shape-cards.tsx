import {t, tOr} from '../../shared/i18n';
import {useState} from 'react';
import type {ReactElement, ReactNode} from 'react';
import {applyBodyShape} from '../../shared/document';
import type {CharacterTarget} from '../../shared/document';
import {Button, OptionCardGroup} from '../../shared/ui';
import type {OptionCard} from '../../shared/ui';
import {matchingBodyShape, orderedBodyShapes} from './anatomy-model';
import type {AnatomyCatalog} from './anatomy-model';
import {BodyShapeArt} from './body-shape-art';
import {useCharacterSpec} from './use-character-spec';

/** Props of {@link BodyShapeCards}. */
export interface BodyShapeCardsProps {
  readonly target: CharacterTarget;
  readonly catalog: AnatomyCatalog;
  /** Accessible group name; defaults to "Body shape". */
  readonly label?: string;
  /**
   * Shown with the "Custom" card when the values match no shape (REQ-UX-055); switches to Pro
   * and focuses the anatomy preset selector.
   */
  readonly onEditInPro?: () => void;
  /** Replaces the default silhouette, for example with a rendered still (wizard step 3). */
  readonly renderArt?: (shapeId: string) => ReactNode;
}

/**
 * The 64 x 64 rendered still of a shape for a style, shown pixelated. A missing thumbnail (a
 * style without one) falls back to the inline silhouette.
 */
function ShapeThumbnail({
  src,
  fallback,
}: {
  readonly src: string;
  readonly fallback: ReactNode;
}): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  return (
    <img
      className="csg-anat-shape-thumb"
      src={src}
      alt=""
      width={64}
      height={64}
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
}

/**
 * One card per body-shape preset in menu order, applied relative to the current style's base
 * anatomy as one undoable command (REQ-ANA-022, REQ-ANA-023, REQ-UX-063, REQ-UX-093). It is
 * bound to a {@link CharacterTarget}, so the Easy Shape group and wizard step 3 reuse it. It
 * has no slider or number field.
 */
export function BodyShapeCards({
  target,
  catalog,
  label,
  onEditInPro,
  renderArt,
}: BodyShapeCardsProps): ReactElement {
  const spec = useCharacterSpec(target);
  const shapes = orderedBodyShapes(catalog);
  const matched = matchingBodyShape(spec.anatomy, spec.style, catalog);
  const custom = matched === null;
  const options: OptionCard[] = shapes.map(shape => ({
    id: shape.id,
    label: tOr(shape.label, shape.id),
    art: renderArt ? (
      renderArt(shape.id)
    ) : shape.thumbnailBase ? (
      <ShapeThumbnail
        src={`${shape.thumbnailBase}/${spec.style}/${shape.id}.webp`}
        fallback={<BodyShapeArt factors={shape.factors} />}
      />
    ) : (
      <BodyShapeArt factors={shape.factors} />
    ),
  }));
  if (custom) {
    options.push({
      id: 'custom',
      label: t('anatomy.shape.custom'),
      description: t('anatomy.shape.customSub'),
    });
  }
  return (
    <div className="csg-anat-shapes" data-focus-key="anatomy.shape">
      <OptionCardGroup
        label={label ?? t('anatomy.shape.title')}
        options={options}
        value={custom ? 'custom' : matched}
        onChange={id => {
          if (id !== 'custom') target.apply(applyBodyShape(id));
        }}
      />
      {custom && onEditInPro ? (
        <Button small variant="ghost" onClick={onEditInPro}>
          {t('anatomy.shape.editInPro')}
        </Button>
      ) : null}
    </div>
  );
}
