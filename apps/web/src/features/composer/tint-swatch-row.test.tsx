// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {setTint} from '../../shared/document';
import {axeViolations} from '../../shared/ui/test-utils';
import {firstTintChannel} from './tint-channel';
import {channelSwatches, TintSwatchRow} from './tint-swatch-row';
import {loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(cleanup);

describe('TintSwatchRow', () => {
  it('AC-UX-062.1: a radiogroup "Color: <name>"; the arrow checks the next swatch, named from data, and sets the tint', async () => {
    const user = userEvent.setup();
    const hair = channelSwatches(catalog, 'hair');
    expect(hair.length).toBeGreaterThan(2);
    const {target} = projectFor(catalog);
    target.apply(setTint('hair', hair[0]?.hex ?? ''));
    render(
      <TintSwatchRow
        target={target}
        catalog={catalog}
        channel="hair"
        name="Simple parted"
      />,
    );
    const group = screen.getByRole('radiogroup', {
      name: 'Color: Simple parted',
    });
    expect(group).toBeTruthy();
    const first = screen.getByRole('radio', {name: hair[0]?.name ?? ''});
    expect(first.getAttribute('aria-checked')).toBe('true');
    first.focus();
    await user.keyboard('{ArrowRight}');
    const next = screen.getByRole('radio', {name: hair[1]?.name ?? ''});
    expect(next.getAttribute('aria-checked')).toBe('true');
    expect(target.getSpec().tints.hair).toBe(hair[1]?.hex);
    // Spoken names are words, not hex values.
    expect(hair[1]?.name).not.toMatch(/^#/);
  });

  it('AC-UX-062.2: a keyboard burst folds into one history entry', async () => {
    let now = 1000;
    const hair = channelSwatches(catalog, 'hair');
    const {store, target} = projectFor(catalog, {now: () => now});
    target.apply(setTint('hair', hair[0]?.hex ?? ''));
    now += 5000;
    const user = userEvent.setup({
      advanceTimers: () => {
        now += 100;
      },
    });
    render(
      <TintSwatchRow
        target={target}
        catalog={catalog}
        channel="hair"
        name="Hair"
      />,
    );
    screen.getByRole('radio', {name: hair[0]?.name ?? ''}).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(target.getSpec().tints.hair).toBe(hair[4]?.hex);
    store.undo();
    expect(target.getSpec().tints.hair).toBe(hair[0]?.hex);
  });

  it('AC-UX-055.2: a tint outside the set shows a checked "Custom color #123456"; Edit in Pro reports the channel', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    target.apply(setTint('hair', '#123456'));
    const before = target.getSpec();
    const fields: string[] = [];
    render(
      <TintSwatchRow
        target={target}
        catalog={catalog}
        channel="hair"
        name="Hair"
        onEditInPro={f => fields.push(f)}
      />,
    );
    const custom = screen.getByRole('radio', {name: 'Custom color #123456'});
    expect(custom.getAttribute('aria-checked')).toBe('true');
    // Displaying it never changes it (AC-UX-055.3).
    expect(target.getSpec()).toBe(before);
    await user.click(screen.getByRole('button', {name: 'Edit in Pro'}));
    expect(fields).toEqual(['tints.hair']);
  });

  it('AC-UX-062.1: the row follows the first tint channel of the selected part', () => {
    const hair = catalog.parts.find(p => p.slot === 'hair');
    expect(firstTintChannel(catalog, hair?.ref ?? '')).toBe('hair');
    expect(firstTintChannel(catalog, 'user:nothing')).toBeNull();
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(
      <TintSwatchRow
        target={projectFor(catalog).target}
        catalog={catalog}
        channel="skin"
        name="Skin"
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
