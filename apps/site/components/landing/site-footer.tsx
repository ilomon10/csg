import {ThemeSwitch} from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import Link from 'next/link';
import {editorUrl, siteConfig} from '@/lib/site-config';

const a = 'text-[15px] text-ink-soft hover:text-ink';

/** Footer with site links, project links and a theme toggle (REQ-WEB-032). */
export function SiteFooter() {
  const repo = siteConfig.repoUrl;
  const branch = siteConfig.repoBranch;
  return (
    <footer className="border-t-2 border-line">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-4 py-12 md:grid-cols-[1.5fr_1fr_1fr_auto] md:px-6">
        <p className="font-pixel text-[24px] leading-[1.25] text-ink">CSG</p>
        <nav aria-label="Site">
          <ul className="flex flex-col gap-2">
            <li>
              <Link className={a} href="/docs/">
                Docs
              </Link>
            </li>
            <li>
              <a className={a} href={editorUrl}>
                Editor
              </a>
            </li>
            <li>
              <Link className={a} href="/docs/contribute/">
                Contribute
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Project">
          <ul className="flex flex-col gap-2">
            <li>
              <a className={a} href={repo}>
                GitHub
              </a>
            </li>
            <li>
              <a className={a} href={`${repo}/blob/${branch}/LICENSE`}>
                License
              </a>
            </li>
            <li>
              <a
                className={a}
                href={`${repo}/blob/${branch}/ASSETS_LICENSE.md`}
              >
                Asset credits
              </a>
            </li>
          </ul>
        </nav>
        <div className="flex items-start">
          <ThemeSwitch />
        </div>
      </div>
    </footer>
  );
}
