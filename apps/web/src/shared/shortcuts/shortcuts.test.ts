// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {formatChord, isSingleKey, matchEvent, parseChord} from './chords';
import {createCommandRegistry} from './command-registry';
import {checkRegistry} from './conflicts';
import {createShortcutDispatcher} from './dispatcher';
import {fuzzyRank} from './fuzzy';
import {DEFAULT_SHORTCUTS} from './registry';
import type {CommandDef, ShortcutDef, ShortcutScope} from './types';

function setup(
  commands: string[],
  scopes: ShortcutScope[],
  extra: {
    shortcuts?: readonly ShortcutDef[];
    singleKey?: boolean;
    platform?: 'mac' | 'other';
  } = {},
) {
  const registry = createCommandRegistry();
  const ran: string[] = [];
  registry.register(
    commands.map(id => ({
      id,
      titleKey: id,
      category: 'app' as const,
      run: () => {
        ran.push(id);
      },
    })),
  );
  const dispatcher = createShortcutDispatcher({
    registry,
    shortcuts: extra.shortcuts ?? DEFAULT_SHORTCUTS,
    activeScopes: () => scopes,
    singleKeyEnabled: () => extra.singleKey ?? true,
    platform: extra.platform ?? 'other',
    when: () => true,
  });
  dispatcher.attach(window);
  return {ran, registry};
}

const press = (
  init: KeyboardEventInit,
  target: EventTarget = document.body,
) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('registry data', () => {
  it('AC-UX-011.2: the default registry has no conflicts and no reserved chord', () => {
    expect(checkRegistry(DEFAULT_SHORTCUTS)).toEqual([]);
  });

  it('AC-UX-011.2: contains the table rows (spot check of ids and scopes)', () => {
    const has = (id: string, scope: string, key: string) =>
      DEFAULT_SHORTCUTS.some(
        d => d.commandId === id && d.scope === scope && d.keys.includes(key),
      );
    expect(has('app.redo', 'global', 'Mod+Shift+Z')).toBe(true);
    expect(has('app.redo', 'global', 'Mod+Y')).toBe(true);
    expect(has('project.new', 'global', 'Mod+Alt+N')).toBe(true);
    expect(has('graph.search', 'graph', 'Shift+A')).toBe(true);
    expect(has('graph.hideUnused', 'graph', 'Alt+Shift+H')).toBe(true);
    expect(has('fit.scale', 'prop-fitting', 'R')).toBe(true);
    expect(has('composer.randomize', 'library', 'R')).toBe(true);
    expect(has('app.help', 'global', 'F1')).toBe(true);
  });

  it('AC-UX-013.1: a chord bound twice in one scope fails naming both commands', () => {
    const issues = checkRegistry([
      {commandId: 'graph.a', keys: ['F'], scope: 'graph'},
      {commandId: 'graph.b', keys: ['F'], scope: 'graph'},
    ]);
    expect(issues[0]?.kind).toBe('duplicate');
    expect(issues[0]?.message).toContain('graph.a');
    expect(issues[0]?.message).toContain('graph.b');
  });

  it('AC-UX-013.2: global plus region needs shadows', () => {
    const base: ShortcutDef = {
      commandId: 'dock.toggle',
      keys: ['Mod+J'],
      scope: 'global',
    };
    expect(
      checkRegistry([
        base,
        {commandId: 'graph.frameBox', keys: ['Mod+J'], scope: 'graph'},
      ]).map(i => i.kind),
    ).toEqual(['unshadowed-global']);
    expect(
      checkRegistry([
        base,
        {
          commandId: 'graph.frameBox',
          keys: ['Mod+J'],
          scope: 'graph',
          shadows: 'dock.toggle',
        },
      ]),
    ).toEqual([]);
  });

  it('AC-UX-015.1: Mod+= fails as reserved browser zoom; other reserved chords too', () => {
    const issues = checkRegistry([
      {commandId: 'x', keys: ['Mod+='], scope: 'global'},
    ]);
    expect(issues[0]?.message).toContain('Reserved chord: browser zoom');
    for (const key of [
      'Mod+W',
      'Mod+Shift+T',
      'Mod+1',
      'F5',
      'Mod+P',
      'Alt+ArrowLeft',
      'Mod+0',
    ]) {
      expect(
        checkRegistry([{commandId: 'x', keys: [key], scope: 'global'}])[0]
          ?.kind,
      ).toBe('reserved');
    }
  });

  it('AC-UX-020.1: every entry appears once per scope with parseable chords', () => {
    const seen = new Set<string>();
    for (const def of DEFAULT_SHORTCUTS) {
      const id = `${def.scope}|${def.commandId}|${def.when ?? ''}|${def.keys.join(',')}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      def.keys.forEach(key => parseChord(key));
    }
  });
});

describe('chords', () => {
  it('AC-UX-018.1: formats per platform and matches Cmd on mac', () => {
    const chord = parseChord('Mod+Shift+Z');
    expect(formatChord(chord, 'mac')).toBe('⇧⌘Z');
    expect(formatChord(chord, 'other')).toBe('Ctrl+Shift+Z');
    const event = {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: true,
    };
    expect(matchEvent(event, chord, 'mac')).toBe(true);
    expect(matchEvent(event, chord, 'other')).toBe(false);
  });

  it('AC-UX-018.2: ? matches on the produced character regardless of shift or layout', () => {
    const chord = parseChord('?');
    const azerty = {
      key: '?',
      code: 'Comma',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    };
    const us = {...azerty, code: 'Slash'};
    expect(matchEvent(azerty, chord, 'other')).toBe(true);
    expect(matchEvent(us, chord, 'other')).toBe(true);
  });

  it('AC-UX-018.1: Alt chords match on code (macOS Option changes key)', () => {
    const chord = parseChord('Mod+Alt+P');
    const event = {
      key: 'π',
      code: 'KeyP',
      ctrlKey: false,
      metaKey: true,
      altKey: true,
      shiftKey: false,
    };
    expect(matchEvent(event, chord, 'mac')).toBe(true);
    const digit = {
      key: '¡',
      code: 'Digit1',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: true,
    };
    expect(matchEvent(digit, parseChord('Alt+Shift+1'), 'other')).toBe(true);
  });

  it('AC-UX-018.1: Space matches on code', () => {
    const e = {
      key: ' ',
      code: 'Space',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchEvent(e, parseChord('Space'), 'other')).toBe(true);
  });
});

describe('dispatcher', () => {
  it('AC-UX-012.1: Space in graph does not toggle playback; in timeline it does', async () => {
    let t = 0;
    const registry = createCommandRegistry();
    const ran: string[] = [];
    registry.register(
      ['graph.search', 'animation.togglePlay'].map(id => ({
        id,
        titleKey: id,
        category: 'app' as const,
        run: () => void ran.push(id),
      })),
    );
    let scopes: ShortcutScope[] = ['graph'];
    const d = createShortcutDispatcher({
      registry,
      shortcuts: DEFAULT_SHORTCUTS,
      activeScopes: () => scopes,
      singleKeyEnabled: () => true,
      platform: 'other',
      when: () => true,
      now: () => t,
    });
    const off = d.attach(window);
    press({key: ' ', code: 'Space'});
    t = 50;
    window.dispatchEvent(new KeyboardEvent('keyup', {key: ' ', code: 'Space'}));
    await flush();
    expect(ran).toEqual(['graph.search']);
    scopes = ['timeline'];
    press({key: ' ', code: 'Space'});
    await flush();
    expect(ran).toEqual(['graph.search', 'animation.togglePlay']);
    off();
  });

  it('AC-UX-012.1: a held Space (pan) is not a tap', async () => {
    let t = 0;
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.register([
      {id: 'graph.search', titleKey: 'x', category: 'graph', run},
    ]);
    const d = createShortcutDispatcher({
      registry,
      shortcuts: DEFAULT_SHORTCUTS,
      activeScopes: () => ['graph'],
      singleKeyEnabled: () => true,
      platform: 'other',
      now: () => t,
    });
    d.attach(window);
    press({key: ' ', code: 'Space'});
    t = 400;
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}));
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('AC-UX-012.1: a Space tap on a focused button is left to the button click', async () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.register([
      {id: 'graph.search', titleKey: 'x', category: 'graph', run},
    ]);
    const d = createShortcutDispatcher({
      registry,
      shortcuts: DEFAULT_SHORTCUTS,
      activeScopes: () => ['graph'],
      singleKeyEnabled: () => true,
      platform: 'other',
      now: () => 0,
    });
    d.attach(window);
    const button = document.createElement('button');
    document.body.append(button);
    const ev = press({key: ' ', code: 'Space'}, button);
    button.dispatchEvent(
      new KeyboardEvent('keyup', {code: 'Space', bubbles: true}),
    );
    await flush();
    expect(ev.defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    button.remove();
  });

  it('AC-UX-012.2: prop-fitting scope wins over the region binding for R', async () => {
    const {ran} = setup(
      ['composer.randomize', 'fit.scale'],
      ['viewport', 'prop-fitting'],
    );
    press({key: 'r', code: 'KeyR'});
    await flush();
    expect(ran).toEqual(['fit.scale']);
  });

  it('AC-UX-014.1: typing in a field fires no single-key binding and Ctrl+Z is left to the field', async () => {
    const {ran} = setup(
      ['graph.mute', 'composer.randomize', 'app.undo', 'project.save'],
      ['viewport', 'graph'],
    );
    const input = document.createElement('input');
    document.body.append(input);
    for (const key of ['m', 'r'])
      press({key, code: `Key${key.toUpperCase()}`}, input);
    const undo = press({key: 'z', code: 'KeyZ', ctrlKey: true}, input);
    const save = press({key: 's', code: 'KeyS', ctrlKey: true}, input);
    await flush();
    expect(ran).toEqual(['project.save']);
    expect(undo.defaultPrevented).toBe(false);
    expect(save.defaultPrevented).toBe(true);
    input.remove();
  });

  it('AC-UX-016.1: M with only global scope active does nothing', async () => {
    const {ran} = setup(['graph.mute'], []);
    press({key: 'm', code: 'KeyM'});
    await flush();
    expect(ran).toEqual([]);
  });

  it('AC-UX-016.2: with single-key shortcuts off F does nothing and Ctrl+Z still works', async () => {
    const {ran} = setup(['viewport.frame', 'app.undo'], ['viewport'], {
      singleKey: false,
    });
    press({key: 'f', code: 'KeyF'});
    press({key: 'z', code: 'KeyZ', ctrlKey: true});
    await flush();
    expect(ran).toEqual(['app.undo']);
  });

  it('AC-UX-014.1: IME composition is ignored', async () => {
    const {ran} = setup(['app.undo'], []);
    press({key: 'z', code: 'KeyZ', ctrlKey: true, isComposing: true});
    await flush();
    expect(ran).toEqual([]);
  });

  it('AC-UX-018.1: Cmd+Shift+Z runs redo on mac', async () => {
    const {ran} = setup(['app.redo'], [], {platform: 'mac'});
    press({key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true});
    await flush();
    expect(ran).toEqual(['app.redo']);
  });

  it('AC-UX-012.1: an unbound key is left to the browser', () => {
    setup(['app.undo'], []);
    expect(press({key: 'q', code: 'KeyQ'}).defaultPrevented).toBe(false);
  });
});

describe('fuzzy search', () => {
  it('AC-UX-019.1: "rand" ranks Randomize first among 1000 commands within 50 ms', () => {
    const commands: CommandDef[] = Array.from({length: 1000}, (_, i) => ({
      id: `cmd.${i}`,
      titleKey: `cmd.${i}`,
      category: 'app' as const,
      run: () => undefined,
    }));
    commands.push({
      id: 'composer.randomize',
      titleKey: 'x',
      category: 'composer',
      run: () => undefined,
    });
    const titles = (id: string) =>
      id === 'composer.randomize' ? 'Randomize' : `Command number ${id}`;
    const start = performance.now();
    const ranked = fuzzyRank('rand', commands, titles);
    expect(performance.now() - start).toBeLessThan(50);
    expect(ranked[0]?.id).toBe('composer.randomize');
  });

  it('AC-UX-019.2: a disabled command is not run; recent keeps the last five', async () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.register([
      {
        id: 'export.open',
        titleKey: 'x',
        category: 'export',
        run,
        disabledReason: () => 'ux.export.disabled',
      },
    ]);
    await registry.run('export.open');
    expect(run).not.toHaveBeenCalled();
    registry.register(
      Array.from({length: 7}, (_, i) => ({
        id: `c${i}`,
        titleKey: 'x',
        category: 'app' as const,
        run: () => undefined,
      })),
    );
    for (let i = 0; i < 7; i += 1) await registry.run(`c${i}`);
    expect(registry.recent()).toEqual(['c6', 'c5', 'c4', 'c3', 'c2']);
  });
});

describe('single-key classification', () => {
  it('AC-UX-016.3: Shift+printable chords are single-key; chords with Ctrl/Alt/Cmd are not', () => {
    for (const c of [
      'A',
      'Shift+A',
      'Shift+D',
      'Shift+H',
      'Shift+S',
      '?',
      'Space',
    ]) {
      expect(isSingleKey(parseChord(c))).toBe(true);
    }
    for (const c of [
      'Mod+D',
      'Alt+Shift+H',
      'Ctrl+Z',
      'Delete',
      'Home',
      'Escape',
      'ArrowLeft',
      'F1',
    ]) {
      expect(isSingleKey(parseChord(c))).toBe(false);
    }
  });
});
