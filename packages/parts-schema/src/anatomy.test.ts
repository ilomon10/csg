import {describe, expect, it} from 'vitest';
import {
  ANATOMY_PARAM_SPECS,
  anatomyParamsSchema,
  defaultAnatomy,
  quantizeAnatomy,
} from './anatomy';
import {ANATOMY_PARAM_KEYS} from './body';

describe('anatomy params', () => {
  it('AC-ANA-001.1: head = 2.01 fails naming the field and its range', () => {
    const result = anatomyParamsSchema.safeParse({
      ...defaultAnatomy(),
      head: 2.01,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['head']);
      expect(result.error.issues[0]?.message).toContain('0.8');
      expect(result.error.issues[0]?.message).toContain('2');
    }
  });

  it('AC-ANA-001.1: legLength = 0.69 fails naming the field and its range', () => {
    const result = anatomyParamsSchema.safeParse({
      ...defaultAnatomy(),
      legLength: 0.69,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['legLength']);
      expect(result.error.issues[0]?.message).toContain('0.7');
    }
  });

  it('AC-ANA-001.1: the range ends are accepted', () => {
    for (const key of ANATOMY_PARAM_KEYS) {
      const {min, max} = ANATOMY_PARAM_SPECS[key];
      for (const value of [min, max]) {
        expect(
          anatomyParamsSchema.safeParse({...defaultAnatomy(), [key]: value})
            .success,
        ).toBe(true);
      }
    }
  });

  it('AC-ANA-001.2: a slider value of 1.234 is stored as 1.23', () => {
    const result = anatomyParamsSchema.parse({
      ...defaultAnatomy(),
      armLength: 1.234,
    });
    expect(result.armLength).toBe(1.23);
    expect(quantizeAnatomy(1.005)).toBe(1);
  });

  it('AC-ANA-001.3: defaults are 1.00 for every key', () => {
    const anatomy = defaultAnatomy();
    expect(Object.keys(anatomy)).toEqual([...ANATOMY_PARAM_KEYS]);
    expect(Object.values(anatomy).every(v => v === 1)).toBe(true);
    expect(anatomyParamsSchema.parse(anatomy)).toEqual(anatomy);
  });

  it('REQ-ANA-001: a missing key fails and non-finite values fail', () => {
    const {feet: _omit, ...rest} = defaultAnatomy();
    expect(anatomyParamsSchema.safeParse(rest).success).toBe(false);
    expect(
      anatomyParamsSchema.safeParse({...defaultAnatomy(), head: Infinity})
        .success,
    ).toBe(false);
  });
});
