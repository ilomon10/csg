import type {ReactElement} from 'react';
import type {AnatomyParams} from '@csg/parts-schema';

/** Inline silhouette that follows a body shape's factors (no external image, REQ-UX-040). */
export function BodyShapeArt({
  factors,
}: {
  readonly factors: Partial<AnatomyParams>;
}): ReactElement {
  const f = (key: keyof AnatomyParams) => factors[key] ?? 1;
  const height = f('height');
  const torso = 12 * f('torsoWidth');
  const shoulders = 14 * f('shoulders');
  const limb = 3.2 * f('limbThickness');
  const legLen = 18 * f('legLength') * height;
  const headR = 5 * Math.min(1.3, f('head'));
  const bodyTop = 20;
  const bodyH = 18 * height;
  return (
    <svg
      viewBox="0 0 48 64"
      width="48"
      height="64"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <circle cx="24" cy={bodyTop - headR - 1} r={headR} />
        <rect x={24 - shoulders} y={bodyTop} width={shoulders * 2} height="4" />
        <rect x={24 - torso} y={bodyTop + 4} width={torso * 2} height={bodyH} />
        <rect
          x={24 - torso}
          y={bodyTop + 4 + bodyH}
          width={limb}
          height={legLen}
        />
        <rect
          x={24 + torso - limb}
          y={bodyTop + 4 + bodyH}
          width={limb}
          height={legLen}
        />
      </g>
    </svg>
  );
}
