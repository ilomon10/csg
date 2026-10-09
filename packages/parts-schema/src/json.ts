import type {SchemaIssue, SchemaResult} from './primitives';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Most nodes {@link findForbiddenKey} visits before it gives up (untrusted structured clones). */
export const MAX_JSON_NODES = 200_000;
/** Deepest nesting {@link findForbiddenKey} accepts. */
export const MAX_JSON_DEPTH = 64;

/**
 * Finds the first object key named `__proto__`, `constructor` or `prototype` at any depth
 * (REQ-GEN-011). Only keys count; string values are never inspected. Iterative, so deep
 * nesting cannot overflow the stack.
 *
 * Also guards structured-clone data (REQ-GEN-013): valid documents are trees, so an object
 * reached twice (a cycle or a DAG), nesting deeper than {@link MAX_JSON_DEPTH} or more than
 * {@link MAX_JSON_NODES} nodes is rejected with the pseudo path `<shared-reference>`,
 * `<too-deep>` or `<too-large>`.
 *
 * @returns the dotted path of the offending key (or a pseudo path), or `null` when clean.
 */
export function findForbiddenKey(value: unknown): string | null {
  const stack: Array<{node: unknown; path: string; depth: number}> = [
    {node: value, path: '', depth: 0},
  ];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (
      item === undefined ||
      typeof item.node !== 'object' ||
      item.node === null
    )
      continue;
    if (seen.has(item.node)) return '<shared-reference>';
    seen.add(item.node);
    if (++visited > MAX_JSON_NODES) return '<too-large>';
    if (item.depth > MAX_JSON_DEPTH) return '<too-deep>';
    const join = (key: string) =>
      item.path === '' ? key : `${item.path}.${key}`;
    if (Array.isArray(item.node)) {
      item.node.forEach((child, index) =>
        stack.push({
          node: child,
          path: join(String(index)),
          depth: item.depth + 1,
        }),
      );
      continue;
    }
    for (const key of Object.keys(item.node)) {
      if (FORBIDDEN_KEYS.has(key)) return join(key);
      stack.push({
        node: (item.node as Record<string, unknown>)[key],
        path: join(key),
        depth: item.depth + 1,
      });
    }
  }
  return null;
}

/**
 * Parses JSON text and rejects the whole input when any object key is `__proto__`,
 * `constructor` or `prototype` at any depth (REQ-GEN-011), before any schema validation.
 * Never throws: syntax errors and forbidden keys come back as issues.
 */
export function parseJson(text: string): SchemaResult<unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    return {
      ok: false,
      issues: [{path: '', message: `invalid JSON: ${message}`}],
    };
  }
  const forbidden = findForbiddenKey(value);
  if (forbidden !== null) {
    const issue: SchemaIssue = {
      path: forbidden,
      message: forbidden.startsWith('<')
        ? `invalid structure ${forbidden}`
        : `forbidden key "${forbidden.split('.').pop()}"`,
    };
    return {ok: false, issues: [issue]};
  }
  return {ok: true, value};
}
