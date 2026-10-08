import {GithubLogo} from '@phosphor-icons/react/ssr';
import type {BaseLayoutProps} from 'fumadocs-ui/layouts/shared';
import {siteConfig} from './site-config';

/** Navigation shared by the landing page and the docs. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-semibold tracking-tight">
          Character Sprite Generator
        </span>
      ),
      url: '/',
    },
    // A labelled icon link instead of `githubUrl`, whose built-in icon has no
    // accessible name.
    links: [
      {
        type: 'icon',
        label: 'GitHub repository',
        text: 'GitHub',
        url: siteConfig.repoUrl,
        external: true,
        icon: <GithubLogo aria-hidden="true" weight="regular" />,
      },
    ],
  };
}

/** Landing navigation: the docs layout shows the same two areas as tabs. */
export function homeOptions(): BaseLayoutProps {
  return {
    ...baseOptions(),
    links: [
      ...(baseOptions().links ?? []),
      {text: 'Guide', url: '/docs/', active: 'nested-url'},
      {text: 'Contribute', url: '/docs/contribute/', active: 'nested-url'},
    ],
  };
}
