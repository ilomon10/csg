import {t} from '../../../shared/i18n';
import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {frameIndexAt} from '../../home-frames';
import {SPRITE_PX} from './lineup-model';
import type {FrameView} from './use-home-frames';

/** Object URL of a blob for the lifetime of the component (`blob:` is allowed by the CSP). */
export function useBlobUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (blob === undefined) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** A pixel-art silhouette shown while a character has no frames yet (REQ-UX-081). */
export function SkeletonFigure(): ReactElement {
  return (
    <svg
      className="home-skeleton"
      viewBox="0 0 16 16"
      width={SPRITE_PX}
      height={SPRITE_PX}
      shapeRendering="crispEdges"
      role="img"
      aria-label={t('home.sprite.loading')}
    >
      <rect x="6" y="2" width="4" height="4" />
      <rect x="5" y="6" width="6" height="5" />
      <rect x="3" y="6" width="2" height="4" />
      <rect x="11" y="6" width="2" height="4" />
      <rect x="5" y="11" width="2" height="4" />
      <rect x="9" y="11" width="2" height="4" />
    </svg>
  );
}

/**
 * A preset's shipped thumbnail while its frames render; the skeleton when there is none or it
 * fails to load (REQ-UX-081).
 */
export function PlaceholderFigure({
  url,
  className,
}: {
  readonly url: string | undefined;
  readonly className: string;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (url === undefined || failed) return <SkeletonFigure />;
  return (
    <img
      className={className}
      src={url}
      alt=""
      width={SPRITE_PX}
      height={SPRITE_PX}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** Props of {@link AnimatedSprite}. */
interface AnimatedSpriteProps {
  readonly frames: FrameView & {
    readonly strip: NonNullable<FrameView['strip']>;
  };
  readonly reducedMotion: boolean;
}

/**
 * Draws the idle strip of one lineup character on a 64 x 64 canvas, one frame at a time at the
 * clip's fps (REQ-UX-080). Under reduced motion it draws frame 0 once (REQ-UX-084). The loop
 * only redraws when the frame index changes and stops while the page is hidden.
 */
export function AnimatedSprite({
  frames,
  reducedMotion,
}: AnimatedSpriteProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const {strip, frameCount, fps} = frames;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    ctx.imageSmoothingEnabled = false;
    const source = strip as unknown as CanvasImageSource;
    let drawn = -1;
    const draw = (index: number): void => {
      if (index === drawn) return;
      drawn = index;
      ctx.clearRect(0, 0, SPRITE_PX, SPRITE_PX);
      ctx.drawImage(
        source,
        index * SPRITE_PX,
        0,
        SPRITE_PX,
        SPRITE_PX,
        0,
        0,
        SPRITE_PX,
        SPRITE_PX,
      );
    };
    draw(0);
    if (reducedMotion || frameCount <= 1) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number): void => {
      start ??= now;
      draw(frameIndexAt(frameCount, fps, now - start, false));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [strip, frameCount, fps, reducedMotion]);
  return (
    <canvas
      ref={canvas}
      className="home-sprite"
      width={SPRITE_PX}
      height={SPRITE_PX}
      data-animated={reducedMotion ? 'false' : 'true'}
    />
  );
}

/** A still image of a blob (an avatar), drawn pixelated. */
export function StillImage({
  blob,
  className,
}: {
  readonly blob: Blob | undefined;
  readonly className: string;
}): ReactElement | null {
  const url = useBlobUrl(blob);
  if (url === null) return null;
  return (
    <img
      className={className}
      src={url}
      alt=""
      width={SPRITE_PX}
      height={SPRITE_PX}
      draggable={false}
    />
  );
}

/**
 * The sprite of one lineup character: the animated idle strip when decoded, else the cached
 * avatar still, else a skeleton, so a position is never empty (REQ-UX-081).
 */
export function Sprite({
  frames,
  reducedMotion,
  thumbnailUrl,
}: {
  readonly frames: FrameView | undefined;
  readonly reducedMotion: boolean;
  /** Pre-built thumbnail of a preset, shown while there are no frames yet. */
  readonly thumbnailUrl?: string | undefined;
}): ReactElement {
  if (frames?.strip !== undefined && frames.strip !== null) {
    return (
      <AnimatedSprite
        frames={{...frames, strip: frames.strip}}
        reducedMotion={reducedMotion}
      />
    );
  }
  if (frames !== undefined) {
    return <StillImage blob={frames.avatarBlob} className="home-sprite" />;
  }
  return <PlaceholderFigure url={thumbnailUrl} className="home-sprite" />;
}
