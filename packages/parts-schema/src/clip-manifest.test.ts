import {describe, expect, it} from 'vitest';
import {parseClipManifest} from './clip-manifest';

const license = {
  license: 'CC0-1.0',
  author: 'Quaternius',
  sourceUrl: 'https://quaternius.com',
  commercialUse: 'yes',
  attributionRequired: false,
};

function clip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'walk',
    name: 'Walk',
    category: 'locomotion',
    file: 'clips/walk.glb',
    sourceName: 'Walk_Loop',
    rig: 'test-rig',
    durationSec: 1.2,
    loop: true,
    defaultFrameCount: 8,
    hasRootMotion: false,
    tags: [],
    sha256: 'b'.repeat(64),
    skeletonGroup: 'ual',
    ...overrides,
  };
}

function manifest(clips: unknown[]) {
  return {
    format: 'sprite-clips-manifest',
    version: 1,
    packId: 'test-ual',
    name: 'Test clips',
    license,
    clips,
  };
}

function failure(json: unknown) {
  const result = parseClipManifest(json);
  if (result.ok) throw new Error('expected failure');
  return result.issues;
}

describe('clip manifest', () => {
  it('REQ-ANM-001: a valid manifest parses', () => {
    expect(parseClipManifest(manifest([clip()])).ok).toBe(true);
  });

  it('AC-ANM-001.2: durationSec <= 0 fails naming the clip id', () => {
    for (const durationSec of [0, -1]) {
      const issues = failure(manifest([clip({durationSec})]));
      expect(issues[0]?.entryId).toBe('walk');
      expect(issues[0]?.field).toBe('durationSec');
      expect(issues[0]?.message).toContain('walk');
    }
  });

  it('AC-ANM-001.2: a duplicate id fails naming the clip id', () => {
    const issues = failure(manifest([clip(), clip({name: 'Walk 2'})]));
    expect(issues.some(i => i.entryId === 'walk' && i.field === 'id')).toBe(
      true,
    );
  });

  it('AC-ANM-021.1: a clip entry without sha256 is rejected naming the clip and field', () => {
    const {sha256: _omit, ...rest} = clip();
    const issues = failure(manifest([rest]));
    expect(issues[0]).toMatchObject({entryId: 'walk', field: 'sha256'});
  });

  it('REQ-AST-026: a clip entry without skeletonGroup is rejected naming the clip and field', () => {
    const {skeletonGroup: _omit, ...rest} = clip();
    const issues = failure(manifest([rest]));
    expect(issues[0]).toMatchObject({entryId: 'walk', field: 'skeletonGroup'});
  });

  it('REQ-ANM-001: defaultFrameCount outside 1..64 and a bad category fail', () => {
    expect(
      parseClipManifest(manifest([clip({defaultFrameCount: 65})])).ok,
    ).toBe(false);
    expect(parseClipManifest(manifest([clip({category: 'dance'})])).ok).toBe(
      false,
    );
  });

  it('REQ-ANM-001: inPlaceVariant must name another clip in the manifest', () => {
    expect(
      parseClipManifest(manifest([clip({inPlaceVariant: 'walk'})])).ok,
    ).toBe(false);
    expect(
      parseClipManifest(manifest([clip({inPlaceVariant: 'walk-ip'})])).ok,
    ).toBe(false);
    expect(
      parseClipManifest(
        manifest([clip({inPlaceVariant: 'walk-ip'}), clip({id: 'walk-ip'})]),
      ).ok,
    ).toBe(true);
  });

  it('REQ-GEN-008: a pack-level problem names the pack id', () => {
    const issues = failure({...manifest([clip()]), license: undefined});
    expect(issues[0]?.entryId).toBe('test-ual');
  });
});
