import {createFromSource} from 'fumadocs-core/search/server';
import {buildSearchIndex} from '@/lib/search-index';
import {source} from '@/lib/source';

// Static search index exported at build time (REQ-WEB-012).
export const revalidate = false;
export const {staticGET: GET} = createFromSource(source, {
  language: 'english',
  buildIndex: buildSearchIndex,
});
