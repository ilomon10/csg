// PreToolUse hook (Edit|MultiEdit|Write under specs/): block edits that delete an existing REQ-/AC- ID.
// IDs are never removed or renumbered; deprecate with ~~strikethrough~~ instead (ADR-0006).
// Reads the hook JSON on stdin. Exit 2 + stderr message blocks; any internal error fails open.
import {existsSync, readFileSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const ID_RE = /\b(?:REQ-[A-Z]{2,4}-\d{3}|AC-[A-Z]{2,4}-\d{3}\.\d+)\b/g;

/** @param {string} text */
export const idsOf = text => new Set(text.match(ID_RE) ?? []);

/**
 * IDs present in `before` but absent from `after` (struck-through IDs still count as present).
 * @param {string} before
 * @param {string} after
 */
export function removedIds(before, after) {
  const kept = idsOf(after);
  return [...idsOf(before)].filter(id => !kept.has(id));
}

/**
 * @param {{tool_name?: string, tool_input?: Record<string, unknown>, cwd?: string}} input
 * @returns {string[]} removed IDs, empty when the edit is fine or not applicable
 */
export function check(input) {
  const ti = input.tool_input ?? {};
  const file = typeof ti.file_path === 'string' ? ti.file_path : '';
  if (!file) return [];
  const root = input.cwd ?? process.cwd();
  const rel = relative(root, resolve(root, file)).split('\\').join('/');
  if (!rel.startsWith('specs/') || rel === 'specs/traceability.md') return [];
  const abs = resolve(root, file);
  if (!existsSync(abs)) return [];
  const before = readFileSync(abs, 'utf8');
  /** @param {string} text @param {Record<string, unknown>} e */
  const applyEdit = (text, e) =>
    e.replace_all
      ? text.split(String(e.old_string)).join(String(e.new_string))
      : text.replace(String(e.old_string), () => String(e.new_string));
  let after;
  if (typeof ti.content === 'string') {
    after = ti.content;
  } else if (Array.isArray(ti.edits)) {
    // MultiEdit: edits apply sequentially, each to the result of the previous one.
    after = before;
    for (const e of ti.edits) {
      if (
        e &&
        typeof e.old_string === 'string' &&
        typeof e.new_string === 'string'
      ) {
        after = applyEdit(after, e);
      }
    }
  } else if (
    typeof ti.old_string === 'string' &&
    typeof ti.new_string === 'string'
  ) {
    after = applyEdit(before, ti);
  } else {
    return [];
  }
  return removedIds(before, after);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const removed = check(JSON.parse(raw));
  if (removed.length > 0) {
    console.error(
      `Blocked: this edit removes existing spec ID(s): ${removed.join(', ')}. ` +
        'IDs are never deleted or renumbered. Deprecate instead, e.g. ' +
        '~~REQ-XXX-001~~ (deprecated YYYY-MM-DD: reason, replaced by REQ-XXX-002).',
    );
    process.exit(2);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => process.exit(0)); // fail open
}
