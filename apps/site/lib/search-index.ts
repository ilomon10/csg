import type {AdvancedIndex} from 'fumadocs-core/search/server';
import type {source} from '@/lib/source';

type Page = ReturnType<typeof source.getPages>[number];

/** Per-page cap on indexed body text, in characters (AC-WEB-012.2 budget). */
export const BODY_CHAR_BUDGET = 600;
/** Per-section cap so one long section cannot use the whole page budget. */
const SECTION_CHAR_BUDGET = 160;

/**
 * Index title, description, every heading, and a truncated slice of the body
 * (the lead of each section) instead of the full text. Keeps the exported
 * static index inside the 400 KB gzip budget.
 */
export async function buildSearchIndex(page: Page): Promise<AdvancedIndex> {
  const data = page.data as unknown as {
    title?: string;
    description?: string;
    structuredData?:
      | AdvancedIndex['structuredData']
      | (() => Promise<AdvancedIndex['structuredData']>);
    load?: () => Promise<{structuredData: AdvancedIndex['structuredData']}>;
  };
  const full =
    typeof data.structuredData === 'function'
      ? await data.structuredData()
      : (data.structuredData ?? (await data.load?.())?.structuredData);
  if (!full) throw new Error(`No structured data for ${page.url}`);

  let remaining = BODY_CHAR_BUDGET;
  const seenPerHeading = new Map<string | undefined, number>();
  const contents: AdvancedIndex['structuredData']['contents'] = [];
  for (const c of full.contents) {
    if (remaining <= 0) break;
    const used = seenPerHeading.get(c.heading) ?? 0;
    const room = Math.min(SECTION_CHAR_BUDGET - used, remaining);
    if (room <= 0) continue;
    const text = c.content.length > room ? c.content.slice(0, room) : c.content;
    seenPerHeading.set(c.heading, used + text.length);
    remaining -= text.length;
    contents.push({heading: c.heading, content: text});
  }

  return {
    id: page.url,
    url: page.url,
    title: data.title ?? page.url,
    description: data.description,
    structuredData: {headings: full.headings, contents},
  };
}
