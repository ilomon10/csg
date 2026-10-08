import {describe, expect, it} from 'vitest';
import {
  assetRefSchema,
  clipRefSchema,
  hexColorSchema,
  rigIdSchema,
  semverSchema,
  sha256Schema,
  slotIdSchema,
  transformOffsetSchema,
} from './primitives';

describe('primitives', () => {
  it('AC-CMP-016.2: hex colors normalize to lowercase and reject garbage', () => {
    expect(hexColorSchema.parse('#A0C4FF')).toBe('#a0c4ff');
    expect(hexColorSchema.safeParse('blue').success).toBe(false);
    expect(hexColorSchema.safeParse('#fff').success).toBe(false);
  });

  it('REQ-CMP-001: slot and rig ids follow their patterns', () => {
    expect(slotIdSchema.safeParse('prop-main-hand').success).toBe(true);
    expect(slotIdSchema.safeParse('Bad_Id').success).toBe(false);
    expect(slotIdSchema.safeParse('a'.repeat(33)).success).toBe(false);
    expect(rigIdSchema.safeParse('quaternius-ue5-65').success).toBe(true);
    expect(rigIdSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('REQ-CMP-025: AssetRef and ClipRef accept builtin and user forms only', () => {
    expect(
      assetRefSchema.safeParse('builtin:quaternius-ubc/superhero-m').success,
    ).toBe(true);
    expect(assetRefSchema.safeParse('user:0b9f-41').success).toBe(true);
    expect(assetRefSchema.safeParse('builtin:quaternius-ubc').success).toBe(
      false,
    );
    expect(assetRefSchema.safeParse('https://evil/x').success).toBe(false);
    expect(clipRefSchema.safeParse('builtin:quaternius-ual/idle').success).toBe(
      true,
    );
    expect(clipRefSchema.safeParse('user:abc#Run_1').success).toBe(true);
    expect(clipRefSchema.safeParse('user:abc').success).toBe(false);
  });

  it('REQ-AST-013: sha256 is lowercase hex and semver-ish strings parse', () => {
    expect(sha256Schema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(sha256Schema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(semverSchema.safeParse('1.2.3-rc.1+b5').success).toBe(true);
    expect(semverSchema.safeParse('1.2').success).toBe(false);
  });

  it('REQ-CMP-018: transform offsets need three finite components each', () => {
    const ok = {position: [0, 0, 0], rotationDeg: [0, 90, 0], scale: [1, 1, 1]};
    expect(transformOffsetSchema.safeParse(ok).success).toBe(true);
    expect(
      transformOffsetSchema.safeParse({...ok, scale: [1, 1]}).success,
    ).toBe(false);
    expect(
      transformOffsetSchema.safeParse({...ok, position: [0, Infinity, 0]})
        .success,
    ).toBe(false);
  });
});
