// PostToolUse hook (Edit|Write): run prettier on the edited ts/tsx/js/json/md file.
// Only formats files inside the project dir, never fixtures or source asset packs.
// Reads the hook JSON on stdin. Never blocks: all failures are swallowed.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {relative, resolve, isAbsolute} from 'node:path';

const EXT_RE = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/;

/** Paths that are generated or third-party content and must not be reformatted. */
const SKIP_RE = /(?:^|\/)(?:test\/fixtures|assets-src)\//;

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || !EXT_RE.test(file)) return;
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const abs = resolve(root, file);
  const rel = relative(root, abs).split('\\').join('/');
  if (rel.startsWith('..') || isAbsolute(rel)) return;
  if (SKIP_RE.test(rel)) return;
  if (!existsSync(abs)) return;
  execFileSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--log-level', 'silent', abs],
    {
      cwd: root,
      stdio: 'ignore',
      timeout: 20000,
    },
  );
}

main().catch(() => {});
