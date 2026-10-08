import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {DocsArticle} from '@/components/docs-page';
import {pageMetadata} from '@/lib/seo';
import {source} from '@/lib/source';

interface Props {
  params: Promise<{slug?: string[]}>;
}

export default async function Page({params}: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return <DocsArticle page={page} />;
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return pageMetadata({
    route: page.url.endsWith('/') ? page.url : `${page.url}/`,
    title: page.data.title,
    description: page.data.description,
  });
}
