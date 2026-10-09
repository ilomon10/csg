import type {SchemaIssue, SchemaResult} from './primitives';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Finds the first object key named `__proto__`, `constructor` or `prototype` at any depth
 * (REQ-GEN-011). Only keys count; string values are never inspected. Iterative, so deep
 * nesting cannot overflow the stack.
 *
 * @returns the dotted path of the offending key, or `null` when the value is clean.
 */
export function findForbiddenKey(value: unknown): string | null {
  const stack: Array<{node: unknown; path: string}> = [{node: value, path: ''}];
  while (stack.length > 0) {
    const item = stack.pop();
    if (
      item === undefined ||
      typeof item.node !== 'object' ||
      item.node === null
    )
      continue;
    const join = (key: string) =>
      item.path === '' ? key : `${item.path}.${key}`;
    if (Array.isArray(item.node)) {
      item.node.forEach((child, index) =>
        stack.push({node: child, path: join(String(index))}),
      );
      continue;
    }
    for (const key of Object.keys(item.node)) {
      if (FORBIDDEN_KEYS.has(key)) return join(key);
      stack.push({
        node: (item.node as Record<string, unknown>)[key],
        path: join(key),
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
      message: `forbidden key "${forbidden.split('.').pop()}"`,
    };
    return {ok: false, issues: [issue]};
  }
  return {ok: true, value};
}
