import {resolve} from 'node:path';
import {defineConfig, defineDocs} from 'fumadocs-mdx/config';
import {z} from 'zod';
import {
  remarkGithubAlerts,
  remarkRepoLinks,
  remarkStripLeadingTitle,
} from './lib/remark-docs';

// ADR-0007 / spec 010: the site only renders Markdown that lives in the repo.
// "guide" reads docs/guide directly. "contribute" reads docs/ but only the
// contributor files (docs/contributing, docs/architecture.md, docs/adr/*.md
// without template.md); lib/source.ts remaps them under /docs/contribute/.

// This file is bundled into .source/, so resolve from the package directory.
const repoRoot = resolve(process.cwd(), '../..');

/** Strict front matter for guide and contributing pages (REQ-WEB-007). */
const strictFrontmatter = z.object({
  title: z.string().min(1).max(70),
  description: z.string().min(50).max(160),
  icon: z.string().optional(),
});

function firstH1(source: string): string | undefined {
  return /^#\s+(.+)$/m.exec(source)?.[1]?.trim();
}

function firstParagraph(source: string): string | undefined {
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|[-*+] |\d+\. |>|\||```|<!--)/.test(text)) continue;
    const plain = text
      .replace(/\s+/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_]/g, '');
    return plain.length > 160 ? `${plain.slice(0, 157).trimEnd()}...` : plain;
  }
  return undefined;
}

export const guide = defineDocs({
  dir: '../../docs/guide',
  docs: {schema: strictFrontmatter},
});

export const contribute = defineDocs({
  dir: '../../docs',
  docs: {
    files: [
      'contributing/**/*.md',
      'architecture.md',
      'adr/*.md',
      '!adr/template.md',
    ],
    schema: ({path, source}) =>
      path.startsWith('contributing/')
        ? strictFrontmatter
        : z
            .object({
              title: z.string().optional(),
              description: z.string().optional(),
            })
            .transform(fm => ({
              title: fm.title ?? firstH1(source) ?? path,
              description: fm.description ?? firstParagraph(source) ?? '',
            })),
  },
  meta: {files: ['contributing/**/meta.json']},
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: v => [
      remarkStripLeadingTitle,
      remarkGithubAlerts,
      [
        remarkRepoLinks,
        {
          repoRoot,
          repoUrl: process.env.REPO_URL ?? 'https://github.com/ilomon10/csg',
          branch: process.env.REPO_BRANCH ?? 'main',
        },
      ],
      ...v,
    ],
  },
});
