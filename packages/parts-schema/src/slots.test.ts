import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {BODY_REGIONS, SOCKET_IDS, TINT_SLOTS} from './body';
import {V1_SLOT_IDS, loadSlotRegistry} from './slots';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const v1 = JSON.parse(
  readFileSync(new URL('../data/slots.json', import.meta.url), 'utf8'),
);

describe('slot registry', () => {
  it('AC-CMP-001.1: the v1 data file parses and lists the 15 slots in order', () => {
    const result = loadSlotRegistry(v1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slots.map(s => s.id)).toEqual([...V1_SLOT_IDS]);
      expect(result.value.slots).toHaveLength(15);
    }
  });

  it('AC-CMP-001.2: a duplicate slot id fails naming the id', () => {
    const dup = clone(v1);
    dup.slots[2].id = 'hair';
    const result = loadSlotRegistry(dup);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map(i => i.message).join()).toContain('"hair"');
  });

  it('AC-CMP-001.2: an id outside [a-z0-9-]{1,32} fails naming the id', () => {
    const bad = clone(v1);
    bad.slots[1].id = 'Hair_Style';
    const result = loadSlotRegistry(bad);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map(i => i.message).join()).toContain('Hair_Style');
  });

  it('AC-CMP-001.3: a 16th data-only slot is valid', () => {
    const more = clone(v1);
    more.slots.push({
      id: 'wings',
      label: 'slot.wings',
      order: 15,
      kinds: ['skinned'],
      required: false,
      defaultSocket: 'spine_03',
      randomize: {emptyChance: 0.9},
    });
    expect(loadSlotRegistry(more).ok).toBe(true);
  });

  it('REQ-CMP-002: only body may be required and body never randomizes empty', () => {
    const bad = clone(v1);
    bad.slots[1].required = true;
    expect(loadSlotRegistry(bad).ok).toBe(false);
    const body = v1.slots[0];
    expect(body.required).toBe(true);
    expect(body.randomize.emptyChance).toBe(0);
  });

  it('REQ-CMP-001: static prop slots carry their default sockets', () => {
    const byId = new Map(v1.slots.map((s: {id: string}) => [s.id, s]));
    expect(
      (byId.get('prop-main-hand') as {defaultSocket: string}).defaultSocket,
    ).toBe('hand_r');
    expect(
      (byId.get('prop-off-hand') as {defaultSocket: string}).defaultSocket,
    ).toBe('hand_l');
  });

  it('REQ-ANA-009: body constants have the pinned order', () => {
    expect(BODY_REGIONS).toHaveLength(11);
    expect(BODY_REGIONS[0]).toBe('head');
    expect(TINT_SLOTS).toHaveLength(7);
    expect([...SOCKET_IDS]).toEqual([
      'hand_r',
      'hand_l',
      'head',
      'spine_03',
      'pelvis',
    ]);
  });
});

describe('SLOT_REGISTRY', () => {
  it('REQ-CMP-001: the bundled registry is parsed and lists the 15 v1 slots in order', async () => {
    const {SLOT_REGISTRY, V1_SLOT_IDS} = await import('./slots');
    expect(SLOT_REGISTRY.slots.map(slot => slot.id)).toEqual([...V1_SLOT_IDS]);
  });
});
