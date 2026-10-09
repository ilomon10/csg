import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import type {PartEntry, PartManifest} from '@csg/parts-schema';
import {checkPresetReferences} from './presets.js';
import type {PackPresets} from './presets.js';
import type {CheckIssue} from './types.js';
import {fitsBody} from '../build/sole.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parts(): Map<string, PartEntry> {
  const map = new Map<string, PartEntry>();
  for (const pack of ['quaternius-ubc', 'quaternius-outfits']) {
    const m = JSON.parse(
      readFileSync(join(REPO, 'assets/packs', pack, 'manifest.json'), 'utf8'),
    ) as PartManifest;
    for (const p of m.parts) map.set(`builtin:${pack}/${p.id}`, p);
  }
  return map;
}

const tints = Object.fromEntries(
  ['skin', 'hair', 'eyes', 'primary', 'secondary', 'metal', 'leather'].map(
    k => [k, '#ffffff'],
  ),
);
const anatomy = Object.fromEntries(
  [
    'height',
    'head',
    'torsoWidth',
    'shoulders',
    'armLength',
    'legLength',
    'hands',
    'feet',
    'limbThickness',
  ].map(k => [k, 1]),
);

function pack(character: Record<string, unknown>): PackPresets[] {
  return [
    {
      packId: 'quaternius-ubc',
      parts: [],
      files: [
        {
          kind: 'style',
          path: 'presets/styles/realistic.json',
          json: {style: 'realistic'},
        },
        {
          kind: 'character',
          path: 'presets/characters/t.json',
          json: {
            format: 'sprite-character-preset',
            version: 1,
            id: 't',
            name: 'T',
            character: {
              format: 'sprite-character',
              version: 2,
              name: 'T',
              seed: 1,
              style: 'realistic',
              species: 'human',
              morphs: {},
              anatomy,
              tints,
              ...character,
            },
          },
        },
      ],
    },
  ];
}

const run = (character: Record<string, unknown>): string[] => {
  const issues: CheckIssue[] = [];
  checkPresetReferences(pack(character), parts(), i => issues.push(i));
  return issues.map(i => `${i.code} ${i.message}`);
};

describe('preset references (REQ-UX-103)', () => {
  it('AC-UX-103.1: a valid male ranger resolves', () => {
    expect(
      run({
        body: {ref: 'builtin:quaternius-ubc/superhero-m'},
        parts: {torso: {ref: 'builtin:quaternius-outfits/male-ranger-torso'}},
      }),
    ).toEqual([]);
  });

  it('AC-AST-038.1 / AC-UX-103.1: a female outfit on the male body, an unknown ref and a user ref fail', () => {
    const out = run({
      body: {ref: 'builtin:quaternius-ubc/superhero-m'},
      parts: {
        torso: {ref: 'builtin:quaternius-outfits/female-ranger-torso'},
        legs: {ref: 'builtin:quaternius-outfits/nope'},
        feet: {ref: 'user:abc#boots'},
      },
    });
    expect(out.filter(l => l.startsWith('AST_PRESET_REF'))).toHaveLength(3);
    expect(out.join('\n')).toContain('does not fit body');
  });

  it('AC-CMP-036.1: every part of the default character is registered and fits its body', () => {
    const file = JSON.parse(
      readFileSync(
        join(REPO, 'packages/parts-schema/data/default-character.json'),
        'utf8',
      ),
    ) as {
      character: {body: {ref: string}; parts: Record<string, {ref: string}>};
    };
    const all = parts();
    const body = all.get(file.character.body.ref)!;
    for (const [slot, sel] of Object.entries(file.character.parts)) {
      const part = all.get(sel.ref);
      expect(part?.slot, slot).toBe(slot);
      expect(fitsBody(part!, body), slot).toBe(true);
    }
  });
});
