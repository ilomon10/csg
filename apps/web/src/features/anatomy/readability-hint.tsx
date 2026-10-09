import {t} from '../../shared/i18n';
import type {ReactElement} from 'react';
import {Button} from '../../shared/ui';

/** Estimated projected sizes at the current camera, in output pixels (from the engine). */
export interface ReadabilityEstimate {
  readonly forearmPx: number;
  readonly shinPx: number;
  readonly headPx: number;
}

/** Props of {@link ReadabilityHint}. */
export interface ReadabilityHintProps {
  readonly resolutionPx: number;
  readonly estimate: ReadabilityEstimate | null;
  readonly onFocusLimbThickness: () => void;
}

/**
 * Pure rule of REQ-ANA-015: only at 64 px or smaller, a forearm or shin under 2 px or a head
 * under 6 px. Returns the message key or null.
 */
export function readabilityIssue(
  resolutionPx: number,
  estimate: ReadabilityEstimate | null,
): 'arms' | 'legs' | 'head' | null {
  if (!estimate || resolutionPx > 64) return null;
  if (estimate.forearmPx < 2) return 'arms';
  if (estimate.shinPx < 2) return 'legs';
  if (estimate.headPx < 6) return 'head';
  return null;
}

/** Non-blocking pixel-readability hint with a link to the Limb thickness slider (REQ-ANA-015). */
export function ReadabilityHint({
  resolutionPx,
  estimate,
  onFocusLimbThickness,
}: ReadabilityHintProps): ReactElement | null {
  const issue = readabilityIssue(resolutionPx, estimate);
  if (issue === null) return null;
  return (
    <div className="csg-anat-hint" role="note">
      <p>{t(`anatomy.hint.${issue}`, {px: resolutionPx})}</p>
      <Button small variant="ghost" onClick={onFocusLimbThickness}>
        {t('anatomy.hint.go')}
      </Button>
    </div>
  );
}
