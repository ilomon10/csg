'use client';
import {useEffect, useRef} from 'react';

// A single requestAnimationFrame loop drives every sprite on the page. Each
// subscriber gets whole frame ticks at its own fps and updates CSS variables
// on its element, so React never re-renders per frame.

type Tick = () => void;
interface Entry {
  fps: number;
  acc: number;
  tick: Tick;
}
const entries = new Set<Entry>();
let raf = 0;
let last = 0;

function loop(now: number): void {
  const dt = last ? Math.min(now - last, 250) : 0;
  last = now;
  for (const e of entries) {
    e.acc += dt;
    const step = 1000 / e.fps;
    while (e.acc >= step) {
      e.acc -= step;
      e.tick();
    }
  }
  raf = entries.size ? requestAnimationFrame(loop) : 0;
}

function add(entry: Entry): () => void {
  entries.add(entry);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    entries.delete(entry);
    if (!entries.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/**
 * Calls `tick` `fps` times per second while `running` is true.
 * The latest `tick` is always used without re-subscribing.
 */
export function useSpriteClock(
  fps: number,
  running: boolean,
  tick: Tick,
): void {
  const ref = useRef(tick);
  useEffect(() => {
    ref.current = tick;
  });
  useEffect(() => {
    if (!running) return;
    return add({fps, acc: 0, tick: () => ref.current()});
  }, [fps, running]);
}
