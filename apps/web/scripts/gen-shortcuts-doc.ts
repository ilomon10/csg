// Generates docs/guide/getting-started/keyboard-shortcuts.md (REQ-UX-021, D12).
// Usage: tsx apps/web/scripts/gen-shortcuts-doc.ts [--check]
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {renderShortcutsDoc, SHORTCUTS_DOC_PATH} from './shortcuts-doc';

const target = fileURLToPath(
  new URL(`../../../${SHORTCUTS_DOC_PATH}`, import.meta.url),
);
const next = renderShortcutsDoc();

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // A missing file is stale.
  }
  if (current !== next) {
    console.error(
      `${SHORTCUTS_DOC_PATH} is stale. Run \`pnpm docs:shortcuts\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${SHORTCUTS_DOC_PATH} is up to date.`);
} else {
  writeFileSync(target, next);
  console.log(`wrote ${SHORTCUTS_DOC_PATH}`);
}
