import {announce} from '../../shared/ui';

/** Attribute that marks a landmark region for F6 cycling (REQ-UX-013). Its value is the region name. */
export const REGION_ATTR = 'data-region';

const visible = (el: HTMLElement): boolean =>
  !el.hidden && el.closest('[inert],[hidden]') === null;

/**
 * Moves focus to the next or previous `[data-region]` in document order, counting from the innermost region that holds focus, wrapping around
 * (F6 / Shift+F6). Regions that are not natively focusable get `tabindex="-1"`.
 */
export function focusRegion(doc: Document, delta: 1 | -1): boolean {
  const regions = Array.from(
    doc.querySelectorAll<HTMLElement>(`[${REGION_ATTR}]`),
  ).filter(visible);
  if (regions.length === 0) return false;
  const active = doc.activeElement;
  // Regions nest (`<main data-region>` holds the panels): document order lists a container
  // before its descendants, so the LAST region containing focus is the innermost one.
  const current = regions.findLastIndex(
    r => active !== null && r.contains(active),
  );
  const next =
    current < 0
      ? delta === 1
        ? 0
        : regions.length - 1
      : (current + delta + regions.length) % regions.length;
  const target = regions[next];
  if (target === undefined) return false;
  if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus();
  announce(target.getAttribute(REGION_ATTR) ?? '');
  return true;
}
