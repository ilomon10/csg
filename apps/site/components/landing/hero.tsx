import Link from 'next/link';
import {preload} from 'react-dom';
import {asset, editorUrl} from '@/lib/site-config';
import {HeroStage} from './hero-stage';

const isPlaceholderBuild = process.env.NEXT_PUBLIC_SITE_ENV !== 'production';

/** Hero: headline, subtext, two CTAs and the turnaround (REQ-WEB-019). */
export function Hero() {
  // The turnaround sheet is the LCP element and is a CSS background, so the
  // browser would only find it after styles apply. Preload it explicitly.
  preload(asset('/sprites/hero/adventurer-walk-8dir.png'), {
    as: 'image',
    fetchPriority: 'high',
  });
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto grid w-full max-w-[1200px] items-center gap-8 px-4 pb-16 pt-8 md:px-6 md:pt-14 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:pb-24 lg:pt-20"
    >
      <div className="flex flex-col items-start gap-6">
        <h1
          id="hero-title"
          className="font-pixel text-balance text-[32px] leading-[1.25] text-ink sm:text-[48px] lg:text-[64px]"
        >
          3D in. Pixels out.
        </h1>
        <p className="max-w-[44ch] text-lg leading-relaxed text-ink-soft md:text-xl">
          Build a character from 3D parts, then export pixel-art sprite sheets
          in 8 directions. Free, open source, in your browser.
        </p>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <a
            href={editorUrl}
            className="press pixel-shadow inline-flex h-12 items-center whitespace-nowrap border-2 border-ink bg-accent px-6 text-base font-semibold text-accent-ink dark:border-accent"
          >
            Open the editor
          </a>
          <Link
            href="/docs/"
            className="press inline-flex h-12 items-center whitespace-nowrap border-2 border-line bg-surface px-6 text-base font-semibold text-ink hover:border-ink"
          >
            Read the docs
          </Link>
        </div>
      </div>
      <div className="flex justify-center lg:justify-end">
        <HeroStage placeholder={isPlaceholderBuild} />
      </div>
    </section>
  );
}
