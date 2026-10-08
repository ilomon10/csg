import {
  ArrowRight,
  GitBranch,
  GithubLogo,
  Plant,
} from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import {siteConfig} from '@/lib/site-config';

const row =
  'group flex items-center gap-4 border-t-2 border-ink/15 py-4 text-lg font-semibold text-ink dark:border-line';

/** Community call to action (REQ-WEB-031). */
export function ContributeCta() {
  const issues = `${siteConfig.repoUrl}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`;
  return (
    <section
      aria-labelledby="contribute-title"
      className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6 md:py-24"
    >
      <div className="reveal grid gap-10 border-2 border-ink bg-accent-soft p-6 md:p-10 lg:grid-cols-2 dark:border-line">
        <div>
          <h2
            id="contribute-title"
            className="font-pixel text-[32px] leading-[1.25] text-ink md:text-[40px]"
          >
            Build it with us
          </h2>
          <p className="mt-4 max-w-[46ch] text-lg leading-relaxed text-ink-soft">
            Specs come first and the docs live next to the code, so a first pull
            request can be small.
          </p>
        </div>
        <ul className="self-end">
          <li>
            <Link href="/docs/contribute/" className={row}>
              <GitBranch aria-hidden size={24} className="text-accent" />
              Contributor guide
              <ArrowRight
                aria-hidden
                size={20}
                weight="bold"
                className="ml-auto transition-transform group-hover:translate-x-1"
              />
            </Link>
          </li>
          <li>
            <a href={issues} className={row}>
              <Plant aria-hidden size={24} className="text-accent" />
              Good first issues
              <ArrowRight
                aria-hidden
                size={20}
                weight="bold"
                className="ml-auto transition-transform group-hover:translate-x-1"
              />
            </a>
          </li>
          <li>
            <a href={siteConfig.repoUrl} className={`${row} border-b-2`}>
              <GithubLogo aria-hidden size={24} className="text-accent" />
              Repository
              <ArrowRight
                aria-hidden
                size={20}
                weight="bold"
                className="ml-auto transition-transform group-hover:translate-x-1"
              />
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
