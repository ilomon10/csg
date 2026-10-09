import {t} from '../../../shared/i18n';
import {useRef} from 'react';
import type {CSSProperties, ReactElement} from 'react';
import {
  lineupScale,
  neighbourScale,
  rowOffset,
  slotWidth,
  spriteOpacity,
  visibleRange,
} from './lineup-model';
import type {HomeItem} from './lineup-model';
import {Sprite} from './sprite';
import {useElementSize} from './use-element-size';
import type {FrameSource} from './use-home-frames';

/** Props of {@link HomeLineup}. */
export interface HomeLineupProps {
  readonly items: readonly HomeItem[];
  readonly selectedIndex: number;
  readonly frames: FrameSource | null;
  readonly reducedMotion: boolean;
  /** Bumped by the screen whenever the frame source changed, so slots re-read it. */
  readonly framesVersion: number;
  readonly onSelect: (id: string) => void;
}

type SlotStyle = CSSProperties & Record<'--s' | '--o', string | number>;

/**
 * The lobby lineup (REQ-UX-073, REQ-UX-074): one row of characters standing on a stage. The
 * selected one is centered, drawn at the largest integer scale and spotlit; the others are
 * one step smaller and fade toward the edges. The row slides as one rigid strip with an
 * ease-out transition of the `--dur` token (0 under reduced motion). The lineup is
 * `aria-hidden`: the avatar strip is its accessible equivalent.
 */
export function HomeLineup({
  items,
  selectedIndex,
  frames,
  reducedMotion,
  framesVersion,
  onSelect,
}: HomeLineupProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null);
  const {width, height} = useElementSize(stage);
  const scale = lineupScale(height);
  const slot = slotWidth(scale);
  const [from, to] = visibleRange(width, slot, selectedIndex, items.length);
  const visible = items.slice(from, to + 1);
  return (
    <div
      ref={stage}
      className="home-stage"
      aria-hidden="true"
      data-testid="home-lineup"
      data-scale={scale}
      data-version={framesVersion}
    >
      <div className="home-floor" />
      <div className="home-spot" />
      <div className="home-pool" />
      <div
        className="home-row"
        data-testid="home-row"
        style={{
          transform: `translateX(${rowOffset(width, slot, selectedIndex)}px)`,
        }}
      >
        {visible.map((item, k) => {
          const index = from + k;
          const distance = index - selectedIndex;
          const selected = distance === 0;
          const s = selected ? scale : neighbourScale(scale);
          const style: SlotStyle = {
            left: index * slot,
            width: slot,
            '--s': s,
            '--o': spriteOpacity(distance),
          };
          return (
            <div
              key={item.id}
              className="home-slot"
              data-selected={selected}
              data-id={item.id}
              data-index={index}
              style={style}
              onClick={() => onSelect(item.id)}
            >
              <div className="home-tag">
                {item.name}
                <small>
                  {t(
                    item.kind === 'saved'
                      ? 'home.tag.saved'
                      : 'home.tag.preset',
                  )}
                </small>
              </div>
              <div className="home-shadow" />
              <div className="home-fig">
                <Sprite
                  frames={frames?.view(item.id)}
                  reducedMotion={reducedMotion}
                  thumbnailUrl={item.thumbnailUrl}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
