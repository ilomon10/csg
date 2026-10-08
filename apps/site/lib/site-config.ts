/** Build-time site configuration (spec 010 SiteEnv), inlined by next.config.mjs. */
export const siteConfig = {
  /** '' or '/<repo>' (no trailing slash). */
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  repoUrl:
    process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/ilomon10/csg',
  repoBranch: process.env.NEXT_PUBLIC_REPO_BRANCH ?? 'main',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  name: 'Character Sprite Generator',
} as const;

/** Prefixes a public asset path with the basePath (for non-Link URLs). */
export function asset(path: string): string {
  return `${siteConfig.basePath}${path}`;
}

/** URL of the editor (served beside the site at /app/, not by Next.js). */
export const editorUrl = `${siteConfig.basePath}/app/`;
