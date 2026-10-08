import type {Metadata} from 'next';
import {siteConfig} from '@/lib/site-config';

/** Description used by the landing page and as the default card text. */
export const SITE_DESCRIPTION =
  'Compose a character from 3D parts and export pixel-art sprite sheets in 8 directions. Free, open source, runs in your browser.';

/** Static OG image path (relative to the site root), see scripts/generate-og.mjs. */
export function ogImagePath(route: string): string {
  const slug = route.replace(/^\/docs\//, '').replace(/\/$/, '');
  return route === '/' ? 'og/default.png' : `og/docs/${slug || 'index'}.png`;
}

interface PageSeo {
  /** Route with leading and trailing slash, without basePath. */
  route: string;
  title?: string;
  description?: string;
}

/** Canonical URL, Open Graph and Twitter tags for one page (REQ-WEB-038). */
export function pageMetadata({route, title, description}: PageSeo): Metadata {
  const base = `${siteConfig.siteUrl.replace(/\/+$/, '')}${siteConfig.basePath}`;
  const url = `${base}${route}`;
  const image = {
    url: `${base}/${ogImagePath(route)}`,
    width: 1200,
    height: 630,
    alt: title ?? siteConfig.name,
  };
  const fullTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name;
  const text = description ?? SITE_DESCRIPTION;
  return {
    ...(title ? {title} : {}),
    description: text,
    alternates: {canonical: url},
    openGraph: {
      type: 'website',
      siteName: siteConfig.name,
      title: fullTitle,
      description: text,
      url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: text,
      images: [image.url],
    },
  };
}
