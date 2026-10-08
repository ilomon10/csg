import {contribute, guide} from 'collections/server';
import {loader} from 'fumadocs-core/source';
import type {VirtualFile} from 'fumadocs-core/source';
import {contributeVirtualPath} from './doc-routes';

// One loader, two sidebar tabs (spec 010 IA): Guide (docs/guide) and
// Contribute (docs/contributing + docs/architecture.md + docs/adr). Paths are
// virtual; the Markdown files themselves are never copied.

const guideSource = guide.toFumadocsSource({baseDir: 'guide'});
const contributeSource = contribute.toFumadocsSource();

type AnyFile = VirtualFile<{pageData: never; metaData: never}>;

function guideFiles(): AnyFile[] {
  return guideSource.files.map(file => {
    if (file.type !== 'page') return file as AnyFile;
    // Guide pages live at /docs/<slug>, without the virtual "guide" folder.
    const rest = file.path.replace(/^guide\//, '').replace(/\.md$/, '');
    const slugs = rest.split('/').filter(s => s !== 'index' && s !== '');
    return {...file, slugs} as AnyFile;
  });
}

function contributeFiles(): AnyFile[] {
  const out: AnyFile[] = [];
  for (const file of contributeSource.files) {
    const path = contributeVirtualPath(file.path);
    if (!path) continue;
    if (file.type === 'meta' && path === 'contribute/meta.json') {
      const pages = [...(file.data.pages ?? []), 'architecture', 'adr'];
      out.push({
        ...file,
        path,
        data: {...file.data, root: true, pages},
      } as AnyFile);
      continue;
    }
    out.push({...file, path} as AnyFile);
  }
  // Navigation-only meta for the ADR folder (ordered by file name = number).
  out.push({
    type: 'meta',
    path: 'contribute/adr/meta.json',
    data: {title: 'Decision records', pages: ['index', '...']},
  } as AnyFile);
  out.push({
    type: 'meta',
    path: 'meta.json',
    data: {pages: ['guide', 'contribute']},
  } as AnyFile);
  return out;
}

export const source = loader({
  baseUrl: '/docs',
  source: {
    files: [...guideFiles(), ...contributeFiles()],
  } as unknown as ReturnType<typeof guide.toFumadocsSource>,
});
