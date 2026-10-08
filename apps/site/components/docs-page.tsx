import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from 'fumadocs-ui/layouts/docs/page';
import {getMDXComponents} from '@/mdx-components';
import type {source} from '@/lib/source';
import {siteConfig} from '@/lib/site-config';

type DocPage = NonNullable<ReturnType<typeof source.getPage>>;

/** Repo-relative source path of a docs page, for "Edit on GitHub" (REQ-WEB-013). */
export function repoPathOf(page: DocPage): string {
  const full = page.absolutePath ?? '';
  const idx = full.lastIndexOf('/docs/');
  return idx >= 0 ? full.slice(idx + 1) : full;
}

/** Renders one Markdown page from docs/ with the shared docs chrome. */
export function DocsArticle({page}: {page: DocPage}) {
  const MDX = page.data.body;
  const editUrl = `${siteConfig.repoUrl}/edit/${siteConfig.repoBranch}/${repoPathOf(page)}`;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <EditOnGitHub href={editUrl} />
    </DocsPage>
  );
}
