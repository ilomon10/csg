import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  DEFAULT_CHARACTER_DATA,
  createDefaultCharacterSpec,
  parseCharacterSpec,
} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {DEFAULT_SET} from './default-set.js';

const PACKS = resolve(__dirname, '../../../assets/packs');

interface Entry {
  id: string;
  bodies?: string[];
  slot?: string;
}

function readPack(packId: string, file: string, key: string): Entry[] {
  const json = JSON.parse(
    readFileSync(resolve(PACKS, packId, file), 'utf8'),
  ) as Record<string, Entry[]>;
  return json[key] ?? [];
}

describe('AC-AST-016.2 default set', () => {
  it('lists the default character parts and the idle and walk clips (REQ-CMP-036)', () => {
    const ids = DEFAULT_SET.map(r => r.id);
    expect(ids).toContain('superhero-m');
    expect(ids).toEqual(expect.arrayContaining(['idle', 'walk']));
    expect(DEFAULT_SET.filter(r => r.kind === 'part')).toHaveLength(7);
  });
});

describe('default character data (REQ-CMP-036)', () => {
  it('AC-CMP-036.3: the default spec parses and has the 6 part slots and 7 tints', () => {
    const spec = createDefaultCharacterSpec();
    expect(parseCharacterSpec(spec).ok).toBe(true);
    expect(Object.keys(spec.parts).sort()).toEqual(
      ['arms', 'eyebrows', 'feet', 'hair', 'legs', 'torso'].sort(),
    );
    expect(Object.keys(spec.tints)).toHaveLength(7);
    expect(DEFAULT_CHARACTER_DATA.clips).toEqual([
      'builtin:quaternius-ual/idle',
      'builtin:quaternius-ual/walk',
    ]);
  });

  it('AC-CMP-036.1: every ref resolves in the built packs and parts fit superhero-m', () => {
    const spec = createDefaultCharacterSpec();
    const bodyId = spec.body.ref.split('/')[1];
    for (const [slot, sel] of [
      ['body', spec.body] as const,
      ...Object.entries(spec.parts),
    ]) {
      const [packId = '', id = ''] = sel.ref
        .slice('builtin:'.length)
        .split('/');
      const part = readPack(packId, 'manifest.json', 'parts').find(
        p => p.id === id,
      );
      expect(part, sel.ref).toBeDefined();
      expect(part?.slot, sel.ref).toBe(slot);
      if (slot !== 'body') expect(part?.bodies, sel.ref).toContain(bodyId);
    }
    for (const ref of DEFAULT_CHARACTER_DATA.clips) {
      const [packId = '', id = ''] = ref.slice('builtin:'.length).split('/');
      const clip = readPack(packId, 'clips.json', 'clips').find(
        c => c.id === id,
      );
      expect(clip, ref).toBeDefined();
    }
  });
});
