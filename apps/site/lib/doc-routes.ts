/**
 * Maps repository Markdown files to site routes (spec 010, Information
 * architecture). Pure string logic so it can run in the MDX build
 * (source.config.ts), in the loader (lib/source.ts) and in build scripts.
 */

/** Repo-relative folders and files that are published as docs. */
export const GUIDE_DIR = 'docs/guide/';
export const CONTRIBUTING_DIR = 'docs/contributing/';
export const ARCHITECTURE_FILE = 'docs/architecture.md';
export const ADR_DIR = 'docs/adr/';
export const ADR_EXCLUDED = new Set(['docs/adr/template.md']);

function slugPath(rest: string): string {
  const noExt = rest.replace(/\.md$/, '');
  const trimmed = noExt === 'index' ? '' : noExt.replace(/\/index$/, '');
  return trimmed ? `${trimmed}/` : '';
}

/**
 * Returns the site route (with trailing slash, without basePath) for a
 * repo-relative `.md` path, or null when the file is not published.
 */
export function routeForRepoPath(repoPath: string): string | null {
  if (!repoPath.endsWith('.md')) return null;
  if (repoPath.startsWith(GUIDE_DIR)) {
    return `/docs/${slugPath(repoPath.slice(GUIDE_DIR.length))}`;
  }
  if (repoPath.startsWith(CONTRIBUTING_DIR)) {
    return `/docs/contribute/${slugPath(repoPath.slice(CONTRIBUTING_DIR.length))}`;
  }
  if (repoPath === ARCHITECTURE_FILE) return '/docs/contribute/architecture/';
  if (
    repoPath.startsWith(ADR_DIR) &&
    !repoPath.slice(ADR_DIR.length).includes('/')
  ) {
    if (ADR_EXCLUDED.has(repoPath)) return null;
    const name = repoPath.slice(ADR_DIR.length);
    if (name === 'README.md') return '/docs/contribute/adr/';
    return `/docs/contribute/adr/${slugPath(name)}`;
  }
  return null;
}

/**
 * Virtual path inside the loader for a file of the "contribute" collection,
 * whose files are relative to `docs/`. Returns null to drop the file.
 */
export function contributeVirtualPath(pathInDocs: string): string | null {
  if (pathInDocs.startsWith('contributing/')) {
    return `contribute/${pathInDocs.slice('contributing/'.length)}`;
  }
  if (pathInDocs === 'architecture.md') return 'contribute/architecture.md';
  if (pathInDocs.startsWith('adr/')) {
    if (pathInDocs === 'adr/template.md') return null;
    if (pathInDocs === 'adr/README.md') return 'contribute/adr/index.md';
    return `contribute/${pathInDocs}`;
  }
  return null;
}
