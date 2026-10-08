import {
  ArrowRight,
  FileText,
  FileCode,
  FileImage,
} from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import type {ReactNode} from 'react';
import features from '@/content/features.json';
import {LINEUP_NAMES, SHEETS} from '@/lib/sheets';
import {asset} from '@/lib/site-config';
import {Sprite} from './sprite';

type FeatureId =
  'parts' | 'anatomy' | 'cameras' | 'shader-graph' | 'custom-models' | 'export';
interface Feature {
  id: FeatureId;
  status: 'available' | 'planned';
  docs: string;
  image: string;
  title: string;
  body: string;
}

const LOOK_LABELS = [
  'Toon and outline',
  'No outline',
  'Bayer dither',
  'Four tones',
];
const ANATOMY = ['chibi', 'standard', 'tall'];

function Visual({id}: {id: FeatureId}): ReactNode {
  switch (id) {
    case 'parts':
      return (
        <div className="pixel-floor flex flex-wrap items-end justify-center border-2 border-line px-2 py-4">
          {LINEUP_NAMES.map((name, row) => (
            <Sprite
              key={name}
              sheet={SHEETS.lineup}
              row={row}
              frames={6}
              still={1}
              label={`The ${name}, walking`}
              scaleClass="[--k:2] -mx-5 md:-mx-3"
            />
          ))}
        </div>
      );
    case 'anatomy':
      return (
        <div className="flex items-end justify-center border-2 border-line bg-fd-background py-4">
          {ANATOMY.map((name, row) => (
            <Sprite
              key={name}
              sheet={SHEETS.anatomy}
              row={row}
              frames={6}
              still={1}
              label={`${name} proportions, walking`}
              scaleClass="[--k:2] -mx-5"
            />
          ))}
        </div>
      );
    case 'cameras':
      return (
        <div className="grid grid-cols-2 gap-3">
          {['Side view', 'Top-down 3/4'].map((label, row) => (
            <figure
              key={label}
              className="flex flex-col items-center gap-2 border-2 border-line bg-accent-soft pb-3 pt-2"
            >
              <Sprite
                sheet={SHEETS.cameras}
                row={row}
                frames={6}
                still={1}
                label={`Adventurer walking, ${label.toLowerCase()} camera`}
                scaleClass="[--k:2] sm:[--k:3]"
              />
              <figcaption className="text-sm font-medium text-ink">
                {label}
              </figcaption>
            </figure>
          ))}
        </div>
      );
    case 'shader-graph':
      return (
        <ul className="grid grid-cols-2 gap-2">
          {LOOK_LABELS.map((label, i) => (
            <li
              key={label}
              className="flex flex-col items-center gap-1 border-2 border-line bg-surface-sunk pb-2"
            >
              <Sprite
                sheet={SHEETS.looks}
                still={i}
                label={`Adventurer rendered with ${label.toLowerCase()}`}
                scaleClass="[--k:2]"
              />
              <span className="text-xs font-medium text-ink-soft">{label}</span>
            </li>
          ))}
        </ul>
      );
    case 'custom-models':
      return (
        <div className="pixel-floor flex justify-center border-2 border-line py-2">
          <Sprite
            sheet={SHEETS.robot}
            frames={6}
            still={1}
            label="A boxy robot model walking with the built-in animation"
            scaleClass="[--k:3]"
          />
        </div>
      );
    case 'export':
      return (
        <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
          <div className="pixel-floor grid place-items-center border-2 border-line p-3">
            <img
              src={asset(SHEETS.export32.src)}
              alt="Exported 32 pixel sprite sheet: four directions by six frames"
              width={384}
              height={256}
              loading="lazy"
              className="pixelated h-[128px] w-[192px] max-w-none sm:h-[256px] sm:w-[384px]"
            />
          </div>
          <ul className="flex flex-col gap-3 font-mono text-sm text-ink">
            <li className="flex items-center gap-2">
              <FileImage size={20} aria-hidden className="text-accent" />
              adventurer.png
            </li>
            <li className="flex items-center gap-2">
              <FileCode size={20} aria-hidden className="text-accent" />
              adventurer.json
            </li>
            <li className="flex items-center gap-2">
              <FileText size={20} aria-hidden className="text-accent" />
              CREDITS.txt
            </li>
          </ul>
        </div>
      );
  }
}

const SPANS: Record<FeatureId, string> = {
  parts: 'lg:col-span-4',
  anatomy: 'lg:col-span-2',
  'shader-graph': 'lg:col-span-2',
  cameras: 'lg:col-span-4',
  export: 'lg:col-span-4',
  'custom-models': 'lg:col-span-2',
};
const ORDER: FeatureId[] = [
  'parts',
  'anatomy',
  'shader-graph',
  'cameras',
  'export',
  'custom-models',
];

/** Six feature highlights in a bento grid, honest about status (REQ-WEB-026). */
export function Features() {
  const byId = new Map((features as Feature[]).map(f => [f.id, f]));
  return (
    <section
      aria-labelledby="features-title"
      className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6 md:py-24"
    >
      <h2
        id="features-title"
        className="reveal text-balance font-pixel text-[32px] leading-[1.25] text-ink md:text-[40px]"
      >
        What you will be able to do
      </h2>
      <p className="reveal mt-4 max-w-[60ch] text-lg leading-relaxed text-ink-soft">
        The editor is in active development. Everything below is planned for the
        first release and documented in the guide today.
      </p>
      <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-6">
        {ORDER.map(id => {
          const f = byId.get(id);
          if (!f) return null;
          return (
            <article
              key={id}
              className={`reveal flex flex-col gap-5 border-2 border-line bg-surface p-5 md:p-6 ${SPANS[id]}`}
            >
              <Visual id={id} />
              <div className="mt-auto flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-semibold text-ink">{f.title}</h3>
                  {f.status === 'planned' ? (
                    <span className="border border-ink-soft px-1.5 py-0.5 font-mono text-xs uppercase text-ink-soft">
                      Planned
                    </span>
                  ) : null}
                </div>
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  {f.body}
                </p>
                <Link
                  href={f.docs}
                  className="group mt-1 inline-flex w-fit items-center gap-1.5 text-[15px] font-semibold text-accent underline-offset-4 hover:underline"
                >
                  Guide page
                  <span className="sr-only">: {f.title}</span>
                  <ArrowRight
                    aria-hidden
                    size={16}
                    weight="bold"
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
