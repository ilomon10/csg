// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {Announcer, resetAnnouncer} from '../../shared/ui';
import {axeViolations, focused} from '../../shared/ui/test-utils';
import {SlotTileGroups} from './slot-tile-groups';
import {draftFor, loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
});

const HAIR = 'builtin:quaternius-ubc/hair-buzzed';

describe('SlotTileGroups', () => {
  it('AC-UX-061.1: one group per slot with a heading; arrows move focus without selecting; one tab stop', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog);
    render(
      <SlotTileGroups
        target={target}
        catalog={catalog}
        slots={['hair', 'headwear']}
        columns={2}
      />,
    );
    const hair = screen.getByRole('listbox', {name: 'Hair'});
    expect(screen.getByRole('heading', {name: 'Hair'})).toBeTruthy();
    expect(screen.getByRole('listbox', {name: 'Headwear'})).toBeTruthy();
    const tiles = within(hair).getAllByRole('option');
    // None first (optional slot), then compatible parts only.
    expect(tiles[0]?.textContent).toContain('None');
    expect(within(hair).queryByRole('option', {name: 'Buns'})).toBeNull();
    const before = target.getSpec();
    tiles[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe(tiles[2]);
    expect(tiles.filter(t => t.tabIndex === 0)).toEqual([tiles[2]]);
    expect(target.getSpec()).toBe(before);
  });

  it('AC-UX-061.2: Space equips as one history entry, sets aria-selected and announces', async () => {
    const user = userEvent.setup();
    const {store, target} = projectFor(catalog);
    render(
      <>
        <Announcer />
        <SlotTileGroups target={target} catalog={catalog} slots={['hair']} />
      </>,
    );
    const buzzed = screen.getByRole('option', {name: 'Buzzed'});
    buzzed.focus();
    await user.keyboard(' ');
    expect(target.getSpec().parts['hair']?.ref).toBe(HAIR);
    expect(buzzed.getAttribute('aria-selected')).toBe('true');
    expect(store.getState().historyLength).toBe(1);
    expect(screen.getByRole('status').textContent).toContain(
      'Selected: Buzzed',
    );
    store.undo();
    expect(target.getSpec().parts['hair']?.ref).not.toBe(HAIR);
  });

  it('AC-UX-061.1: None clears an optional slot; a required slot has no None tile', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog);
    render(
      <SlotTileGroups
        target={target}
        catalog={catalog}
        slots={['hair', 'body']}
      />,
    );
    expect(
      within(screen.getByRole('listbox', {name: 'Body'})).queryByRole(
        'option',
        {
          name: 'None',
        },
      ),
    ).toBeNull();
    await user.click(screen.getByRole('option', {name: 'None'}));
    expect(target.getSpec().parts['hair']).toBeUndefined();
  });

  it('AC-UX-067.1: a tile whose asset is still loading is aria-busy', () => {
    const target = draftFor(catalog);
    render(
      <SlotTileGroups
        target={target}
        catalog={catalog}
        slots={['hair']}
        busyRefs={new Set([HAIR])}
      />,
    );
    expect(
      screen.getByRole('option', {name: 'Buzzed'}).getAttribute('aria-busy'),
    ).toBe('true');
    expect(
      screen
        .getByRole('option', {name: 'Simple parted'})
        .getAttribute('aria-busy'),
    ).toBeNull();
  });

  it('AC-UX-055.1: a part that is not among the tiles shows a selected Custom tile with Edit in Pro, and nothing changes', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog, {
      parts: {hair: {ref: 'user:wig-1' as never}},
    });
    const calls: string[] = [];
    const before = target.getSpec();
    render(
      <SlotTileGroups
        target={target}
        catalog={catalog}
        slots={['hair']}
        onEditInPro={field => calls.push(field)}
      />,
    );
    const custom = screen.getByRole('option', {name: 'Custom'});
    expect(custom.getAttribute('aria-selected')).toBe('true');
    await user.click(custom);
    expect(target.getSpec()).toBe(before);
    await user.click(screen.getByRole('button', {name: 'Edit in Pro'}));
    expect(calls).toEqual(['parts.hair']);
  });

  it('AC-UX-094.1: bound to a draft target the roles and names equal the project-bound ones', () => {
    const draft = render(
      <SlotTileGroups
        target={draftFor(catalog)}
        catalog={catalog}
        slots={['hair']}
      />,
    );
    const names = (c: HTMLElement) =>
      within(c)
        .getAllByRole('option')
        .map(o => `${o.getAttribute('role')}:${o.textContent}`);
    const a = names(draft.container);
    cleanup();
    const project = render(
      <SlotTileGroups
        target={projectFor(catalog).target}
        catalog={catalog}
        slots={['hair']}
      />,
    );
    expect(names(project.container)).toEqual(a);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(
      <SlotTileGroups
        target={draftFor(catalog)}
        catalog={catalog}
        slots={['hair', 'torso']}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
