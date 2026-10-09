import {describe, expect, it} from 'vitest';
import {parseJson} from './json';

describe('parseJson', () => {
  it('AC-GEN-011.1: rejects __proto__ nested three levels deep and does not pollute', () => {
    const result = parseJson('{"a":{"b":{"c":{"__proto__":{"polluted":1}}}}}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('a.b.c.__proto__');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain(
      'polluted',
    );
  });

  it('AC-GEN-011.1: rejects forbidden keys inside arrays', () => {
    expect(parseJson('{"list":[{"x":1},{"__proto__":{}}]}').ok).toBe(false);
  });

  it('AC-GEN-011.2: rejects constructor and prototype at the top level', () => {
    expect(parseJson('{"constructor":{"prototype":{}}}').ok).toBe(false);
    expect(parseJson('{"prototype":1}').ok).toBe(false);
  });

  it('AC-GEN-011.3: accepts __proto__ inside a string value', () => {
    const result = parseJson('{"note":"__proto__ constructor prototype"}');
    expect(result).toEqual({
      ok: true,
      value: {note: '__proto__ constructor prototype'},
    });
  });

  it('REQ-GEN-011: reports syntax errors as issues instead of throwing', () => {
    expect(parseJson('{nope').ok).toBe(false);
  });
});
