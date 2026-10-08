import {ArrowRight} from '@phosphor-icons/react/ssr';
import {asset} from '@/lib/site-config';

const STEPS = [
  {
    title: 'Pick parts',
    body: 'Bodies, outfits, hair and props snap onto one shared skeleton.',
    img: '/sprites/how/parts.png',
    alt: 'Smooth 3D render of the adventurer with its parts pulled apart: head, hair, scarf, torso, arms, legs and boots.',
    pixel: false,
  },
  {
    title: 'Shape the anatomy',
    body: 'Sliders for head size, limb length and build, from chibi to tall.',
    img: '/sprites/how/anatomy.png',
    alt: 'Three 3D renders of the same character with chibi, standard and tall proportions.',
    pixel: false,
  },
  {
    title: 'Run the pixel pass',
    body: 'Toon bands, outlines and palette snapping at the real target size.',
    img: '/sprites/how/shader.png',
    alt: 'The adventurer split down the middle: smooth 3D on the left, the 64 pixel sprite on the right.',
    pixel: true,
  },
  {
    title: 'Export the sheet',
    body: 'Every direction and frame in one PNG, shown here at actual size.',
    img: '/sprites/features/export-32.png',
    alt: 'A 32 pixel sprite sheet: four directions, six walk frames each, at actual size.',
    pixel: true,
    w: 192,
    h: 128,
  },
] as const;

/** "How it works": the pipeline in four named steps (REQ-WEB-025). */
export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-title"
      className="border-y-2 border-line bg-surface"
    >
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6 md:py-24">
        <h2
          id="how-title"
          className="reveal text-balance font-pixel text-[32px] leading-[1.25] text-ink md:text-[40px]"
        >
          How a sprite gets made
        </h2>
        <p className="reveal mt-4 max-w-[60ch] text-lg leading-relaxed text-ink-soft">
          The editor runs the whole pipeline locally, from 3D parts to a sheet
          your engine can load.
        </p>
        <ol className="-mx-4 mt-12 flex scroll-px-4 snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-start lg:overflow-visible lg:px-0 lg:pb-0">
          {STEPS.map((step, i) => (
            <li key={step.title} className="contents">
              <figure className="reveal flex w-[272px] flex-none snap-start flex-col gap-4 lg:w-auto">
                <div className="grid aspect-square w-full place-items-center border-2 border-line bg-fd-background">
                  <img
                    src={asset(step.img)}
                    alt={step.alt}
                    width={'w' in step ? step.w : 256}
                    height={'h' in step ? step.h : 256}
                    loading="lazy"
                    decoding="async"
                    className={
                      step.pixel ? 'pixelated' : 'h-auto w-full max-w-[256px]'
                    }
                  />
                </div>
                <figcaption>
                  <h3 className="text-lg font-semibold text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
                    {step.body}
                  </p>
                </figcaption>
              </figure>
              {i < STEPS.length - 1 ? (
                <ArrowRight
                  aria-hidden
                  size={24}
                  weight="bold"
                  className="mt-[calc(50%-12px)] hidden self-start text-accent lg:block"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
