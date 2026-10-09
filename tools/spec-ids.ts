/** Pure logic for spec ID validation and traceability (no I/O, unit-tested). */

/** Matches a requirement ID such as `REQ-PIX-003`. */
export const REQ_RE = /REQ-([A-Z]{2,4})-(\d{3})(?!\d)/g;
/** Matches an acceptance-criterion ID such as `AC-PIX-003.2`. */
export const AC_RE = /AC-([A-Z]{2,4})-(\d{3})\.(\d+)/g;
/** Anything that looks like an ID but may be malformed. */
const LOOSE_ID_RE =
  /\b(REQ|AC)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\.[A-Za-z0-9]+)?/g;
const STRICT_REQ = /^REQ-[A-Z]{2,4}-\d{3}$/;
const STRICT_AC = /^AC-[A-Z]{2,4}-\d{3}\.\d+$/;

/** One spec file's raw content. */
export interface SpecFile {
  readonly name: string;
  readonly content: string;
}

/** Result of validating a set of spec files. */
export interface SpecCheckResult {
  readonly errors: string[];
  /** REQ id to the file that defines it. */
  readonly reqs: Map<string, string>;
  /** AC id to the file that defines it. */
  readonly acs: Map<string, string>;
  /** AC ids whose definition is marked `~~deprecated~~`; they need no test. */
  readonly deprecatedAcs?: ReadonlySet<string>;
}

/**
 * Parses the area-prefix registry table in the overview spec.
 *
 * @param overview Content of `specs/000-overview.md`.
 * @returns The set of registered prefixes.
 */
export function parseRegistry(overview: string): Set<string> {
  const prefixes = new Set<string>();
  const start = overview.search(/^#+\s*Area-prefix registry/im);
  if (start < 0) return prefixes;
  const rest = overview.slice(start).split('\n').slice(1);
  for (const line of rest) {
    if (/^#+\s/.test(line)) break;
    const m = /^\|\s*([A-Z]{2,4})\s*\|/.exec(line);
    if (m?.[1]) prefixes.add(m[1]);
  }
  return prefixes;
}

/** Removes struck-through (deprecated) text: `~~REQ-X-001~~`. */
function stripDeprecated(text: string): string {
  return text.replace(/~~[^~]*~~/g, '');
}

/** True for lines that define (not merely reference) an ID: bold ID at line start. */
function definitionMatch(
  line: string,
): {kind: 'REQ' | 'AC'; id: string} | null {
  const m =
    /^\s*(?:[-*]\s+)?\*\*(REQ|AC)-([A-Za-z0-9.-]+?)(?:\s[^*]*)?\*\*/.exec(line);
  if (!m?.[1] || !m[2]) return null;
  return {kind: m[1] as 'REQ' | 'AC', id: `${m[1]}-${m[2]}`};
}

/**
 * Validates spec files: ID format, registered prefixes, unique REQs, every REQ has at least one
 * AC, every AC belongs to an existing REQ. Definitions are lines starting with a bold ID
 * (`**REQ-XXX-001 [P1]**`, `- **AC-XXX-001.1**`). `_template.md` must not be passed in.
 *
 * @param files Spec files excluding the template.
 * @param registry Registered area prefixes.
 * @returns Collected errors and the definitions found.
 */
export function checkSpecs(
  files: readonly SpecFile[],
  registry: ReadonlySet<string>,
): SpecCheckResult {
  const errors: string[] = [];
  const reqs = new Map<string, string>();
  const acs = new Map<string, string>();
  const deprecatedAcs = new Set<string>();

  for (const file of files) {
    const lines = file.content.split('\n');
    let inFence = false;
    lines.forEach((rawLine, i) => {
      if (/^\s*```/.test(rawLine)) inFence = !inFence;
      if (inFence) return;
      const where = `${file.name}:${i + 1}`;
      const line = stripDeprecated(rawLine);
      for (const m of line.matchAll(LOOSE_ID_RE)) {
        const id = m[0];
        if (!(id.startsWith('REQ-') ? STRICT_REQ : STRICT_AC).test(id)) {
          // Allow prose like "AC-XXX-NNN" placeholders and ranges only when not a definition.
          if (definitionMatch(line)?.id === id) {
            errors.push(`${where}: malformed ID "${id}"`);
          }
        }
      }
      const def = definitionMatch(line);
      if (!def) return;
      const prefix = /^(?:REQ|AC)-([A-Z]{2,4})-/.exec(def.id)?.[1];
      const valid = (def.kind === 'REQ' ? STRICT_REQ : STRICT_AC).test(def.id);
      if (!valid) return; // already reported above
      if (prefix && !registry.has(prefix)) {
        errors.push(
          `${where}: prefix "${prefix}" of ${def.id} is not in the registry`,
        );
      }
      if (def.kind === 'REQ') {
        const first = reqs.get(def.id);
        if (first) {
          errors.push(
            `${where}: duplicate ${def.id} (first defined in ${first})`,
          );
        } else {
          reqs.set(def.id, where);
        }
      } else if (acs.has(def.id)) {
        errors.push(
          `${where}: duplicate ${def.id} (first defined in ${acs.get(def.id)})`,
        );
      } else {
        acs.set(def.id, where);
        if (
          /^\s*(?:[-*]\s+)?\*\*AC-[^*]+\*\*\s*~~deprecated~~/i.test(rawLine)
        ) {
          deprecatedAcs.add(def.id);
        }
      }
    });
  }

  const reqsWithAc = new Set<string>();
  for (const [ac, where] of acs) {
    const req = ac.replace(/^AC-/, 'REQ-').replace(/\.\d+$/, '');
    if (!reqs.has(req)) {
      errors.push(`${where}: ${ac} belongs to ${req}, which is not defined`);
    } else {
      reqsWithAc.add(req);
    }
  }
  for (const [req, where] of reqs) {
    if (!reqsWithAc.has(req))
      errors.push(`${where}: ${req} has no acceptance criteria`);
  }
  return {errors, reqs, acs, deprecatedAcs};
}

/** One matrix row: a requirement, its ACs and the test files citing each AC. */
export interface TraceRow {
  readonly req: string;
  readonly acs: ReadonlyArray<{
    id: string;
    tests: string[];
    deprecated?: boolean;
  }>;
}

/**
 * Builds the REQ to AC to test-file matrix.
 *
 * @param spec Result of {@link checkSpecs}.
 * @param tests Test files with content.
 * @returns Matrix rows sorted by requirement id.
 */
export function buildTrace(
  spec: SpecCheckResult,
  tests: readonly SpecFile[],
): TraceRow[] {
  const citations = new Map<string, Set<string>>();
  for (const t of tests) {
    for (const m of t.content.matchAll(AC_RE)) {
      const id = m[0];
      const set = citations.get(id) ?? new Set<string>();
      set.add(t.name);
      citations.set(id, set);
    }
  }
  const rows = new Map<
    string,
    {id: string; tests: string[]; deprecated?: boolean}[]
  >();
  for (const req of [...spec.reqs.keys()].sort()) rows.set(req, []);
  for (const ac of [...spec.acs.keys()].sort()) {
    const req = ac.replace(/^AC-/, 'REQ-').replace(/\.\d+$/, '');
    rows.get(req)?.push({
      id: ac,
      tests: [...(citations.get(ac) ?? [])].sort(),
      ...(spec.deprecatedAcs?.has(ac) ? {deprecated: true} : {}),
    });
  }
  return [...rows].map(([req, acs]) => ({req, acs}));
}

/**
 * Renders the matrix and coverage summary as Markdown.
 *
 * @param rows Output of {@link buildTrace}.
 * @returns Markdown for `specs/traceability.md`.
 */
export function renderTrace(rows: readonly TraceRow[]): string {
  const all = rows.flatMap(r => r.acs).filter(a => !a.deprecated);
  const deprecated = rows.flatMap(r => r.acs).length - all.length;
  const covered = all.filter(a => a.tests.length > 0).length;
  const pct = all.length ? ((covered / all.length) * 100).toFixed(1) : '0.0';
  const out = [
    '# Traceability matrix',
    '',
    '> Generated by `pnpm spec:trace`. Do not edit by hand.',
    '',
    '## Coverage summary',
    '',
    `- Requirements: ${rows.length}`,
    `- Acceptance criteria: ${all.length}`,
    `- ACs with at least one test: ${covered} (${pct}%)`,
    `- ACs without tests: ${all.length - covered}`,
    `- Deprecated ACs (not counted): ${deprecated}`,
    '',
    '## Matrix',
    '',
    '| REQ | AC | Tests |',
    '|-----|----|-------|',
  ];
  for (const r of rows) {
    for (const a of r.acs) {
      const tests = a.tests.length
        ? a.tests.map(t => `\`${t}\``).join(', ')
        : a.deprecated
          ? 'deprecated'
          : '**none**';
      out.push(`| ${r.req} | ${a.id} | ${tests} |`);
    }
  }
  return out.join('\n') + '\n';
}

/**
 * Collects every defined REQ/AC ID, counting struck-through (deprecated) definitions as present.
 * Used by the immutability check: an ID may be deprecated but never disappear.
 *
 * @param files Spec files excluding the template.
 * @returns Map of ID to the first `file:line` that defines it.
 */
export function collectDefinedIds(
  files: readonly SpecFile[],
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const file of files) {
    let inFence = false;
    file.content.split('\n').forEach((raw, i) => {
      if (/^\s*```/.test(raw)) inFence = !inFence;
      if (inFence) return;
      const m =
        /^\s*(?:[-*]\s+)?(?:~~)?(?:\*\*)?(?:~~)?((?:REQ-[A-Z]{2,4}-\d{3})|(?:AC-[A-Z]{2,4}-\d{3}\.\d+))(?!\d)/.exec(
          raw,
        );
      if (m?.[1] && !ids.has(m[1])) ids.set(m[1], `${file.name}:${i + 1}`);
    });
  }
  return ids;
}

/**
 * IDs defined at the base but absent now (a struck-through definition still counts as present).
 *
 * @param base IDs at the base ref.
 * @param current IDs in the working tree.
 * @returns Sorted removed IDs with where they were defined at base.
 */
export function removedIds(
  base: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): Array<{id: string; was: string}> {
  return [...base]
    .filter(([id]) => !current.has(id))
    .map(([id, was]) => ({id, was}))
    .sort((a, b) => a.id.localeCompare(b.id));
}
