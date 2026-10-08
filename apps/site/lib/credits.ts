import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** One bundled asset pack, read from ASSETS_LICENSE.md (REQ-WEB-029). */
export interface CreditEntry {
  name: string;
  author: string;
  license: string;
  /** Source URL, or null while the file still marks it as unconfirmed. */
  source: string | null;
}

const LICENSE_FILE = join(process.cwd(), '..', '..', 'ASSETS_LICENSE.md');

function field(block: string, name: string): string {
  return new RegExp(`^- ${name}:\\s*(.+)$`, 'm').exec(block)?.[1]?.trim() ?? '';
}

/**
 * Parses the "Bundled 3D packs" section at build time, so adding a pack to
 * ASSETS_LICENSE.md adds it to the landing page with no site code change.
 */
export function readCredits(): CreditEntry[] {
  const text = readFileSync(LICENSE_FILE, 'utf8');
  const section =
    /^## Bundled 3D packs[^\n]*\n([\s\S]*?)(?=^## )/m.exec(text)?.[1] ?? '';
  return section
    .split(/^### /m)
    .slice(1)
    .map(block => {
      const name = block.split('\n', 1)[0]?.trim() ?? '';
      const src = /https?:\/\/\S+/.exec(field(block, 'Source'))?.[0] ?? null;
      return {
        name,
        author: field(block, 'Author'),
        license: field(block, 'License'),
        source: src?.replace(/[)\].,]+$/, '') ?? null,
      };
    })
    .filter(c => c.name);
}
