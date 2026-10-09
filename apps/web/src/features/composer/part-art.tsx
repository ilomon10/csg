import {useState, type ReactElement} from 'react';
import {Icon, slotIconName} from '../../shared/ui';

/** Props of {@link PartArt}. */
export interface PartArtProps {
  readonly slot: string;
  /** Local thumbnail URL from the manifest; absent until thumbnails ship. */
  readonly thumbnailUrl?: string | undefined;
}

/**
 * Thumbnail of a part, or the slot placeholder icon when there is none or it fails to load, so
 * no broken-image icon ever shows (REQ-CMP-029, AC-CMP-029.1).
 */
export function PartArt({slot, thumbnailUrl}: PartArtProps): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  if (!thumbnailUrl || failed === thumbnailUrl)
    return (
      <Icon name={slotIconName(slot)} size={40} className="cmp-slot-icon" />
    );
  return (
    <img
      className="cmp-part-thumb"
      src={thumbnailUrl}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(thumbnailUrl)}
    />
  );
}
