/**
 * Remark plugins for repo Markdown (spec 010). They run at build time inside
 * the Fumadocs MDX compiler, so the same `.md` file reads well on GitHub and on
 * the site.
 */
import {existsSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {routeForRepoPath} from './doc-routes';

/** Minimal mdast shape; avoids a direct dependency on @types/mdast. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  depth?: number;
  children?: MdNode[];
  name?: string;
  attributes?: Array<{type: 'mdxJsxAttribute'; name: string; value: string}>;
  data?: Record<string, unknown>;
}
interface MdFile {
  path?: string;
}

function walk(node: MdNode, fn: (node: MdNode) => void): void {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}

const ALERTS: Record<string, {type: string; title: string}> = {
  NOTE: {type: 'info', title: 'Note'},
  TIP: {type: 'success', title: 'Tip'},
  IMPORTANT: {type: 'idea', title: 'Important'},
  WARNING: {type: 'warning', title: 'Warning'},
  CAUTION: {type: 'error', title: 'Caution'},
};

/**
 * Turns GitHub alert blockquotes (`> [!NOTE]`) into Fumadocs `<Callout>`
 * elements (REQ-WEB-006, AC-WEB-006.2).
 */
export function remarkGithubAlerts() {
  return (tree: MdNode) => {
    walk(tree, node => {
      for (const child of node.children ?? []) {
        if (child.type !== 'blockquote') continue;
        const first = child.children?.[0];
        const text =
          first?.type === 'paragraph' ? first.children?.[0] : undefined;
        if (!first || text?.type !== 'text' || !text.value) continue;
        const match =
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/.exec(
            text.value,
          );
        const alert = match ? ALERTS[match[1] ?? ''] : undefined;
        if (!match || !alert) continue;
        text.value = text.value.slice(match[0].length);
        if (!text.value) first.children?.shift();
        if (first.children?.length === 0) child.children?.shift();
        child.type = 'mdxJsxFlowElement';
        child.name = 'Callout';
        child.attributes = [
          {type: 'mdxJsxAttribute', name: 'type', value: alert.type},
          {type: 'mdxJsxAttribute', name: 'title', value: alert.title},
        ];
      }
    });
  };
}

/**
 * Drops the leading `# H1`: the page title is rendered from front matter (or
 * from that H1 for ADRs, see source.config.ts), so it would show twice.
 */
export function remarkStripLeadingTitle() {
  return (tree: MdNode) => {
    const children = tree.children ?? [];
    const idx = children.findIndex(n => n.type !== 'yaml' && n.type !== 'html');
    const node = children[idx];
    if (node?.type === 'heading' && node.depth === 1) children.splice(idx, 1);
  };
}

/** Options for {@link remarkRepoLinks}. */
export interface RepoLinkOptions {
  /** Absolute path of the repository root. */
  repoRoot: string;
  /** e.g. https://github.com/owner/repo */
  repoUrl: string;
  branch: string;
}

function resolveTarget(abs: string): string {
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const index = join(abs, 'index.md');
    if (existsSync(index)) return index;
    const readme = join(abs, 'README.md');
    if (existsSync(readme)) return readme;
    return abs;
  }
  if (!existsSync(abs) && existsSync(`${abs}.md`)) return `${abs}.md`;
  return abs;
}

/**
 * Rewrites relative links: published `.md` files become site routes, other
 * repo files become GitHub blob URLs (REQ-WEB-009).
 */
export function remarkRepoLinks(options: RepoLinkOptions) {
  return (tree: MdNode, file: MdFile) => {
    if (!file.path) return;
    const fromDir = dirname(file.path);
    walk(tree, node => {
      if (node.type !== 'link' || !node.url) return;
      const url = node.url;
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return;
      const [pathPart = '', hash] = url.split('#', 2);
      const abs = resolveTarget(resolve(fromDir, decodeURIComponent(pathPart)));
      const repoPath = relative(options.repoRoot, abs).split(sep).join('/');
      if (repoPath.startsWith('..')) return;
      const route = routeForRepoPath(repoPath);
      const suffix = hash ? `#${hash}` : '';
      node.url = route
        ? `${route}${suffix}`
        : `${options.repoUrl}/blob/${options.branch}/${repoPath}${suffix}`;
    });
  };
}
