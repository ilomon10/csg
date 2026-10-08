import type {CSSProperties} from 'react';
import {LINEUP_NAMES, SHEETS} from '@/lib/sheets';
import {Sprite} from './sprite';

/**
 * Six characters built from the same skeleton walk across a strip. This is
 * the page's single marquee; it stops with the pause control and under
 * reduced motion (REQ-WEB-021, 022).
 */
export function Parade() {
  return (
    <section
      aria-labelledby="parade-title"
      className="overflow-hidden py-16 md:py-24"
    >
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <h2
          id="parade-title"
          className="reveal text-balance font-pixel text-[32px] leading-[1.25] text-ink md:text-[40px]"
        >
          One skeleton, a whole cast
        </h2>
        <p className="reveal mt-4 max-w-[56ch] text-lg leading-relaxed text-ink-soft">
          Outfits, hair, hats and palettes are data. Swap them and every clip,
          direction and export keeps working.
        </p>
      </div>
      <div
        className="pixel-floor relative mt-10 h-[136px] border-y-2 border-line"
        role="img"
        aria-label={`Six characters walking right: ${LINEUP_NAMES.join(', ')}`}
      >
        <div className="absolute inset-x-0 bottom-1 flex justify-around motion-safe:block">
          {LINEUP_NAMES.map((name, row) => (
            <div
              key={name}
              className="parade-walker motion-safe:absolute motion-safe:bottom-0 motion-safe:left-0"
              style={
                {'--dur': '30s', '--delay': `${-row * 5}s`} as CSSProperties
              }
            >
              <Sprite
                sheet={SHEETS.parade}
                row={row}
                frames={6}
                fps={10}
                still={1}
                label=""
                scaleClass="[--k:2]"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
