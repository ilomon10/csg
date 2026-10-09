// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {focusRegion} from './focus-regions';

const el = (
  tag: string,
  attrs: Record<string, string>,
  ...kids: HTMLElement[]
): HTMLElement => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};

const build = () => {
  document.body.replaceChildren(
    el('header', {'data-region': 'Top bar'}, el('button', {id: 'top'})),
    el(
      'main',
      {'data-region': 'Content'},
      el('section', {'data-region': 'Preview'}, el('button', {id: 'prev'})),
      el('section', {'data-region': 'Customize'}, el('button', {id: 'cust'})),
    ),
  );
};

describe('focusRegion', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('AC-UX-013.1 / AC-UX-056.1: F6 from a nested region advances from the innermost region', () => {
    build();
    document.getElementById('prev')?.focus();
    focusRegion(document, 1);
    expect(document.activeElement?.getAttribute('data-region')).toBe(
      'Customize',
    );
    focusRegion(document, 1);
    expect(document.activeElement?.getAttribute('data-region')).toBe('Top bar');
  });

  it('AC-UX-013.1: Shift+F6 from a nested region goes back one region, wrapping', () => {
    build();
    document.getElementById('cust')?.focus();
    focusRegion(document, -1);
    expect(document.activeElement?.getAttribute('data-region')).toBe('Preview');
    focusRegion(document, -1);
    expect(document.activeElement?.getAttribute('data-region')).toBe('Content');
  });
});
