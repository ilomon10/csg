'use client';
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {asset} from '@/lib/site-config';
import {useMotionPaused, useReducedMotion} from './motion-store';
import {useSpriteClock} from './sprite-clock';

/** Sheet geometry, in source pixels. */
export interface SheetInfo {
  src: string;
  width: number;
  height: number;
  cell: number;
}

/** Inline style that positions one cell of a sheet (see .sprite in global.css). */
export function sheetStyle(
  sheet: SheetInfo,
  row: number,
  col = 0,
): CSSProperties {
  return {
    '--cell': sheet.cell,
    '--sheet-w': sheet.width,
    '--sheet-h': sheet.height,
    '--row': row,
    '--col': col,
    backgroundImage: `url(${asset(sheet.src)})`,
  } as CSSProperties;
}

/** True while the element is near the viewport. */
export function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      {rootMargin: '200px'},
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, near] as const;
}

interface SpriteProps {
  sheet: SheetInfo;
  /** Row (animation clip or direction) of the sheet. */
  row?: number;
  /** Frames in the row; 1 renders a still. */
  frames?: number;
  fps?: number;
  /** Alt text: character and action (NFR-4). Empty when a parent labels it. */
  label: string;
  /** Integer scale classes, e.g. "[--k:2] md:[--k:3]". */
  scaleClass: string;
  className?: string;
  /** Static frame to show (and to use under reduced motion). */
  still?: number;
}

/** Animated (or still) cell of a pixel sprite sheet at an integer scale. */
export function Sprite({
  sheet,
  row = 0,
  frames = 1,
  fps = 8,
  label,
  scaleClass,
  className = '',
  still = 0,
}: SpriteProps) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const paused = useMotionPaused();
  const reduced = useReducedMotion();
  const frame = useRef(still);
  const running = frames > 1 && near && !paused && !reduced;
  useSpriteClock(fps, running, () => {
    frame.current = (frame.current + 1) % frames;
    ref.current?.style.setProperty('--col', String(frame.current));
  });
  useEffect(() => {
    if (reduced) ref.current?.style.setProperty('--col', String(still));
  }, [reduced, still, ref]);
  return (
    <div
      ref={ref}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={`sprite ${scaleClass} ${className}`}
      style={sheetStyle(sheet, row, still)}
    />
  );
}
