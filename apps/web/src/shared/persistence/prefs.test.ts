import {describe, expect, it} from 'vitest';
import {PREFS_KEY, defaultPrefs, loadPrefs, savePrefs} from './prefs';
import {RECOVERY_KEY, readRecovery, writeRecovery} from './recovery';
import {parseTabMessage} from './tab-message';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: k => data.get(k) ?? null,
    key: i => [...data.keys()][i] ?? null,
    removeItem: k => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('prefs', () => {
  it('AC-UX-054.1: a fresh profile opens in Easy', () => {
    expect(loadPrefs(memoryStorage(), true).workspace).toBe('easy');
    expect(loadPrefs(null, true).workspace).toBe('easy');
  });

  it('AC-UX-054.2: a saved Pro choice survives a reload', () => {
    const storage = memoryStorage();
    savePrefs(storage, {...defaultPrefs(), workspace: 'pro'});
    expect(loadPrefs(storage, true).workspace).toBe('pro');
  });

  it('AC-UX-047.1: a corrupt value gives defaults and no throw', () => {
    for (const bad of ['{nope', '42', '[]', 'x'.repeat(70_000)]) {
      expect(loadPrefs(memoryStorage({[PREFS_KEY]: bad}), true)).toEqual(
        defaultPrefs(),
      );
    }
  });

  it('AC-UX-047.1: v1 migrates to v2 (Pro, body tab, home from the Welcome dismissal)', () => {
    const v1 = {
      format: 'sprite-ui-prefs',
      version: 1,
      theme: 'light',
      singleKeyShortcuts: false,
      dismissed: {welcome: true, tour: true},
    };
    const prefs = loadPrefs(
      memoryStorage({[PREFS_KEY]: JSON.stringify(v1)}),
      true,
    );
    expect(prefs).toMatchObject({
      version: 2,
      theme: 'light',
      singleKeyShortcuts: false,
      workspace: 'pro',
      easyTab: 'body',
      showHomeOnStartup: false,
      dismissed: {tour: true},
    });
    expect(prefs.dismissed).not.toHaveProperty('welcome');
  });

  it('AC-GEN-013.4: a wrong-typed field falls back alone', () => {
    const stored = {...defaultPrefs(), theme: 42, reduceMotion: true};
    const prefs = loadPrefs(
      memoryStorage({[PREFS_KEY]: JSON.stringify(stored)}),
      true,
    );
    expect(prefs.theme).toBe('dark');
    expect(prefs.reduceMotion).toBe(true);
  });

  it('AC-GEN-011.1: a preference blob with a __proto__ key is rejected', () => {
    const text =
      '{"format":"sprite-ui-prefs","version":2,"theme":"light","remaps":{"a":{"__proto__":{"x":1}}}}';
    expect(loadPrefs(memoryStorage({[PREFS_KEY]: text}), true)).toEqual(
      defaultPrefs(),
    );
  });

  it('AC-GEN-011.3: __proto__ inside a string value is accepted', () => {
    const text = JSON.stringify({
      ...defaultPrefs(),
      remaps: {cmd: ['__proto__']},
    });
    expect(loadPrefs(memoryStorage({[PREFS_KEY]: text}), true).remaps).toEqual({
      cmd: ['__proto__'],
    });
  });
});

describe('recovery markers', () => {
  it('AC-UX-045.4: a restore-in-progress marker round-trips and clears', () => {
    const storage = memoryStorage();
    writeRecovery(storage, {
      format: 'sprite-recovery',
      version: 1,
      restoreInProgress: {projectId: 'p1'},
    });
    expect(readRecovery(storage).restoreInProgress?.projectId).toBe('p1');
    writeRecovery(storage, {format: 'sprite-recovery', version: 1});
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('AC-GEN-013.1: tampered markers read as empty', () => {
    const storage = memoryStorage({
      [RECOVERY_KEY]: '{"format":"sprite-recovery","version":1,"x":1}',
    });
    expect(readRecovery(storage)).toEqual({
      format: 'sprite-recovery',
      version: 1,
    });
  });
});

describe('tab messages', () => {
  it('AC-GEN-013.3: rejects oversized, cyclic and DAG structured clones before parsing', () => {
    const warn = () => {};
    const tooMany = {
      type: 'changed',
      projectIds: Array.from({length: 65}, () => 'p'),
    };
    expect(parseTabMessage(tooMany, warn)).toBeNull();
    const cycle: Record<string, unknown> = {type: 'changed', projectIds: []};
    cycle['self'] = cycle;
    expect(parseTabMessage(cycle, warn)).toBeNull();
    let dag: unknown = {};
    for (let i = 0; i < 24; i++) dag = {a: dag, b: dag};
    expect(
      parseTabMessage({type: 'changed', projectIds: [], dag}, warn),
    ).toBeNull();
  });

  it('AC-UX-029.2: wrong types, unknown types and a 5 MB string are ignored with a warning', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(
      parseTabMessage({type: 'takeover', projectId: 42, tabId: 't'}, warn),
    ).toBeNull();
    expect(
      parseTabMessage({type: 'nope', projectId: 'p', tabId: 't'}, warn),
    ).toBeNull();
    expect(parseTabMessage('x'.repeat(5_000_000), warn)).toBeNull();
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('projectId');
    expect(
      parseTabMessage({type: 'claim', projectId: 'p1', tabId: 't1'}, warn),
    ).toEqual({
      type: 'claim',
      projectId: 'p1',
      tabId: 't1',
    });
  });

  it('AC-GEN-013.3: unknown fields are ignored', () => {
    expect(
      parseTabMessage(
        {type: 'claim', projectId: 'p', tabId: 't', extra: 1},
        () => {},
      ),
    ).toBeNull();
  });
});
