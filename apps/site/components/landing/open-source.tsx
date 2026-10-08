import {ArrowUpRight} from '@phosphor-icons/react/ssr';
import {readCredits} from '@/lib/credits';
import {siteConfig} from '@/lib/site-config';

const link =
  'inline-flex items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline';

/** Open source and asset credits, generated from ASSETS_LICENSE.md (REQ-WEB-029). */
export function OpenSource() {
  const credits = readCredits();
  const repo = siteConfig.repoUrl;
  const branch = siteConfig.repoBranch;
  return (
    <section
      aria-labelledby="oss-title"
      className="border-t-2 border-line bg-surface"
    >
      <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2
            id="oss-title"
            className="reveal text-balance font-pixel text-[32px] leading-[1.25] text-ink md:text-[40px]"
          >
            Open code, CC0 art
          </h2>
          <p className="reveal mt-4 max-w-[48ch] text-lg leading-relaxed text-ink-soft">
            The code is MIT licensed. The bundled 3D models come from CC0 packs,
            and every export ships a CREDITS.txt that names them.
          </p>
          <ul className="mt-6 flex flex-col gap-2 text-[15px]">
            <li>
              <a className={link} href={repo}>
                Source code on GitHub
                <ArrowUpRight aria-hidden size={16} weight="bold" />
              </a>
            </li>
            <li>
              <a className={link} href={`${repo}/blob/${branch}/LICENSE`}>
                MIT license
                <ArrowUpRight aria-hidden size={16} weight="bold" />
              </a>
            </li>
            <li>
              <a
                className={link}
                href={`${repo}/blob/${branch}/ASSETS_LICENSE.md`}
              >
                Full asset credits
                <ArrowUpRight aria-hidden size={16} weight="bold" />
              </a>
            </li>
          </ul>
        </div>
        <dl className="grid content-start gap-x-8 gap-y-6 sm:grid-cols-2">
          {credits.map(c => (
            <div key={c.name} className="reveal border-t-2 border-line pt-3">
              <dt className="font-semibold text-ink">{c.name}</dt>
              <dd className="mt-1 text-[15px] text-ink-soft">
                {c.author}, {c.license}
              </dd>
              <dd className="mt-1 text-[15px]">
                {c.source ? (
                  <a className={link} href={c.source}>
                    Source
                    <ArrowUpRight aria-hidden size={14} weight="bold" />
                  </a>
                ) : (
                  <span className="text-ink-soft">
                    Source link being confirmed
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
