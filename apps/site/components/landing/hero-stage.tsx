'use client';
import {
  ArrowClockwise,
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Pause,
  Play,
} from '@phosphor-icons/react/ssr';
import type {Icon} from '@phosphor-icons/react';
import {useRef, useState} from 'react';
import type {KeyboardEvent} from 'react';
import {
  setMotionPaused,
  useMotionPaused,
  useReducedMotion,
} from './motion-store';
import {sheetStyle, type SheetInfo} from './sprite';
import {useSpriteClock} from './sprite-clock';

const HERO: SheetInfo = {
  src: '/sprites/hero/adventurer-walk-8dir.png',
  width: 384,
  height: 512,
  cell: 64,
};
const FRAMES = 6;
const CYCLES_PER_DIRECTION = 2;

/** Sheet row order (REQ-WEB-020). */
const DIRS = [
  {id: 'S', name: 'south', icon: ArrowDown, area: '3 / 2'},
  {id: 'SW', name: 'south-west', icon: ArrowDownLeft, area: '3 / 1'},
  {id: 'W', name: 'west', icon: ArrowLeft, area: '2 / 1'},
  {id: 'NW', name: 'north-west', icon: ArrowUpLeft, area: '1 / 1'},
  {id: 'N', name: 'north', icon: ArrowUp, area: '1 / 2'},
  {id: 'NE', name: 'north-east', icon: ArrowUpRight, area: '1 / 3'},
  {id: 'E', name: 'east', icon: ArrowRight, area: '2 / 3'},
  {id: 'SE', name: 'south-east', icon: ArrowDownRight, area: '3 / 3'},
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  icon: Icon;
  area: string;
}>;

const iconButton =
  'grid size-10 place-items-center border-2 border-line bg-fd-background text-ink transition-colors hover:border-accent hover:text-accent aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink';

/**
 * Hero sprite: an 8-direction walk turnaround with direction buttons, arrow
 * keys and a pause control (REQ-WEB-019d, 020, 021, 022).
 */
export function HeroStage({placeholder}: {placeholder: boolean}) {
  const [dir, setDir] = useState(0);
  const [auto, setAuto] = useState(true);
  const paused = useMotionPaused();
  const reduced = useReducedMotion();
  const spriteRef = useRef<HTMLDivElement>(null);
  const tick = useRef(0);

  useSpriteClock(8, !paused && !reduced, () => {
    tick.current += 1;
    spriteRef.current?.style.setProperty(
      '--col',
      String(tick.current % FRAMES),
    );
    if (auto && tick.current % (FRAMES * CYCLES_PER_DIRECTION) === 0) {
      setDir(d => (d + 1) % DIRS.length);
    }
  });

  const face = (next: number) => {
    setAuto(false);
    setDir((next + DIRS.length) % DIRS.length);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') face(dir + 1);
    else if (e.key === 'ArrowLeft') face(dir - 1);
    else return;
    e.preventDefault();
  };
  const current = DIRS[dir] ?? DIRS[0];

  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="turnaround-live pixel-floor pixel-shadow border-2 border-line p-3">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: 'auto 1fr auto',
            gridTemplateRows: 'auto 1fr auto',
          }}
        >
          {DIRS.map((d, i) => {
            const Glyph = d.icon;
            return (
              <button
                key={d.id}
                type="button"
                className={`${iconButton} self-center justify-self-center`}
                style={{gridArea: d.area}}
                aria-pressed={i === dir}
                aria-label={`Face ${d.name}`}
                title={`Face ${d.name}`}
                onClick={() => face(i)}
              >
                <Glyph size={18} weight="bold" aria-hidden />
              </button>
            );
          })}
          <div
            ref={spriteRef}
            tabIndex={0}
            role="img"
            aria-label={`Pixel-art adventurer walking, facing ${current.name}. Use the left and right arrow keys to turn.`}
            onKeyDown={onKey}
            className="sprite [--k:3] sm:[--k:4] lg:[--k:5]"
            style={{...sheetStyle(HERO, dir, 0), gridArea: '2 / 2'}}
          />
        </div>
      </div>
      <div
        className="turnaround-static pixel-floor pixel-shadow grid-cols-4 gap-1 border-2 border-line p-3"
        role="img"
        aria-label="Pixel-art adventurer shown in all eight directions"
      >
        {DIRS.map((d, i) => (
          <div
            key={d.id}
            className="sprite [--k:1] sm:[--k:2]"
            style={sheetStyle(HERO, i, 0)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={iconButton}
          onClick={() => setMotionPaused(!paused)}
          aria-label={paused ? 'Play animation' : 'Pause animation'}
          title={paused ? 'Play animation' : 'Pause animation'}
        >
          {paused ? (
            <Play size={18} weight="fill" aria-hidden />
          ) : (
            <Pause size={18} weight="fill" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={`${iconButton} disabled:opacity-40`}
          onClick={() => setAuto(true)}
          disabled={auto}
          aria-label="Resume turnaround"
          title="Resume turnaround"
        >
          <ArrowClockwise size={18} weight="bold" aria-hidden />
        </button>
        {placeholder ? (
          <figcaption className="ml-2 max-w-[26ch] text-xs leading-snug text-ink-soft">
            Placeholder art. Real exports replace it before release.
          </figcaption>
        ) : null}
      </div>
    </figure>
  );
}
