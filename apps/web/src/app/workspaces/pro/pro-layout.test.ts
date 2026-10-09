import {describe, expect, it} from 'vitest';
import {clampLayout, dockMax, layoutMode} from './pro-layout';

describe('pro layout', () => {
  it('AC-UX-006.1: modes follow the width breakpoints', () => {
    expect(layoutMode(1440)).toBe('full');
    expect(layoutMode(1280)).toBe('full');
    expect(layoutMode(1100)).toBe('compact');
    expect(layoutMode(834)).toBe('tablet');
    expect(layoutMode(767)).toBe('view-only');
  });

  it('AC-UX-002.1: sizes clamp into the limits and the dock is at most 60 % of the window', () => {
    const base = {
      libraryPx: 100,
      inspectorPx: 900,
      dockPx: 700,
      collapsed: {library: false, inspector: false, dock: false},
    };
    const out = clampLayout(base, 900, 852);
    expect(out.libraryPx).toBe(200);
    expect(out.inspectorPx).toBe(560);
    expect(out.dockPx).toBe(dockMax(900, 852));
    expect(dockMax(900, 852)).toBeLessThanOrEqual(540);
  });

  it('AC-UX-005.1: the viewport keeps 240 px when the area is short', () => {
    expect(dockMax(900, 400)).toBe(120);
  });
});
