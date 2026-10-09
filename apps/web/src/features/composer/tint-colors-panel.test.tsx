// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {axeViolations, focused} from '../../shared/ui/test-utils';
import {TintColorsPanel} from './tint-colors-panel';
import {loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(cleanup);

const PICO8 = [
  '#000000',
  '#1d2b53',
  '#7e2553',
  '#008751',
  '#ab5236',
  '#5f574f',
  '#c2c3c7',
  '#fff1e8',
  '#ff004d',
  '#ffa300',
  '#ffec27',
  '#00e436',
  '#29adff',
  '#83769c',
  '#ff77a8',
  '#ffccaa',
];

describe('TintColorsPanel', () => {
  it('AC-CMP-016.1: an active palette shows its 16 colors and choosing one sets that exact hex', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    render(
      <TintColorsPanel target={target} catalog={catalog} palette={PICO8} />,
    );
    await user.click(screen.getByRole('button', {name: /^Primary/}));
    const row = screen.getByRole('radiogroup', {name: 'Palette colors'});
    expect(within(row).getAllByRole('radio')).toHaveLength(16);
    await user.click(within(row).getByRole('radio', {name: '#ff004d'}));
    expect(target.getSpec().tints.primary).toBe('#ff004d');
  });

  it('AC-CMP-016.2: a bad hex is rejected with a message and leaves the tint unchanged; #ABCDEF is stored lowercase', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    const before = target.getSpec().tints.hair;
    render(<TintColorsPanel target={target} catalog={catalog} />);
    await user.click(screen.getByRole('button', {name: /^Hair/}));
    const field = screen.getByRole('textbox', {name: 'Hex color'});
    await user.clear(field);
    await user.type(field, '#12G');
    expect(screen.getByRole('alert').textContent).toBe(
      'Use a 6-digit hex color like #a0c4ff',
    );
    expect(target.getSpec().tints.hair).toBe(before);
    await user.clear(field);
    await user.type(field, '123456');
    expect(target.getSpec().tints.hair).toBe(before);
    await user.clear(field);
    await user.type(field, '#ABCDEF');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(target.getSpec().tints.hair).toBe('#abcdef');
  });

  it('AC-CMP-016.3: Enter opens the picker, swatches are reachable by arrows and named with their hex, Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    render(<TintColorsPanel target={target} catalog={catalog} />);
    const trigger = screen.getByRole('button', {name: /^Skin/});
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const swatches = screen.getAllByRole('radio');
    expect(swatches.length).toBeGreaterThan(2);
    for (const s of swatches) {
      expect(s.getAttribute('aria-label')).toMatch(/#[0-9a-f]{6}$/);
    }
    swatches[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(swatches[1]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', {name: /color picker/})).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('AC-CMP-017.1: a slider drag is one undo step', () => {
    let now = 1000;
    const {store, target} = projectFor(catalog, {now: () => now});
    const before = target.getSpec().tints.hair;
    render(
      <TintColorsPanel
        target={target}
        catalog={catalog}
        onGestureStart={() => store.beginGesture('tint-drag')}
        onGestureEnd={() => store.endGesture()}
      />,
    );
    fireEvent.click(screen.getByRole('button', {name: /^Hair/}));
    const hue = screen.getByRole('slider', {name: 'Hue'});
    fireEvent.pointerDown(hue);
    for (const h of [10, 80, 150, 220, 300]) {
      now += 600;
      fireEvent.change(hue, {target: {value: String(h)}});
    }
    fireEvent.pointerUp(hue);
    expect(target.getSpec().tints.hair).not.toBe(before);
    expect(store.getState().historyLength).toBe(1);
    store.undo();
    expect(target.getSpec().tints.hair).toBe(before);
  });

  it('AC-UX-055.2: focusChannel moves focus to that channel control', () => {
    const {target} = projectFor(catalog);
    render(
      <TintColorsPanel target={target} catalog={catalog} focusChannel="hair" />,
    );
    expect(focused()).toBe(screen.getByRole('button', {name: /^Hair/}));
  });

  it('AC-UX-036.1: has no axe violations with a picker open', async () => {
    const user = userEvent.setup();
    const {container} = render(
      <TintColorsPanel target={projectFor(catalog).target} catalog={catalog} />,
    );
    await user.click(screen.getByRole('button', {name: /^Eyes/}));
    expect(await axeViolations(container)).toEqual([]);
  });
});
