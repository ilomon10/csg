import axe from 'axe-core';

/**
 * Runs axe-core (WCAG A/AA tags) on `container` in jsdom and returns violation summaries.
 * `color-contrast` is skipped: jsdom has no layout or computed theme colors, and token
 * contrast is covered by `tokens.test.ts` (AC-UX-035.1).
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
    rules: {'color-contrast': {enabled: false}, region: {enabled: false}},
  });
  return result.violations.map(
    v =>
      `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).join(', ')})`,
  );
}

/** The focused element, for `expect(focused()).toBe(el)` (no jest-dom matchers in this repo). */
export function focused(): Element | null {
  return document.activeElement;
}
