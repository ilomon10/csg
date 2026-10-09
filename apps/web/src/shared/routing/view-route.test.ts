import {describe, expect, it} from 'vitest';
import {formatViewRoute, parseViewRoute} from './view-route';

describe('view route', () => {
  it('AC-UX-069.2: parses the known fragments', () => {
    expect(parseViewRoute('#home')).toEqual({view: 'home'});
    expect(parseViewRoute('#new')).toEqual({view: 'wizard'});
    expect(parseViewRoute('#p=abc_DEF-1')).toEqual({
      view: 'project',
      projectId: 'abc_DEF-1',
    });
    expect(parseViewRoute('#c=eJxLy')).toEqual({
      view: 'share',
      payload: 'eJxLy',
    });
    expect(parseViewRoute('')).toEqual({view: 'startup'});
    expect(parseViewRoute('#')).toEqual({view: 'startup'});
  });

  it('AC-UX-069.2: hand-edited fragments go home without throwing', () => {
    for (const hash of [
      '#p=<script>',
      `#p=${'a'.repeat(65)}`,
      '#p=',
      '#zzz',
      '#c=',
      '#new?x=1',
      '#p=a/b',
    ]) {
      expect(parseViewRoute(hash)).toEqual({view: 'home'});
    }
  });

  it('AC-UX-069.2: formats round-trip', () => {
    for (const route of [
      {view: 'home'},
      {view: 'wizard'},
      {view: 'project', projectId: 'x1'},
    ] as const) {
      expect(parseViewRoute(formatViewRoute(route))).toEqual(route);
    }
    expect(formatViewRoute({view: 'project', projectId: '<bad>'})).toBe(
      '#home',
    );
  });
});
