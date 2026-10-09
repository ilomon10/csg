// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {axeViolations, focused} from '../../shared/ui/test-utils';
import {matchesQuery, PartLibrary} from './part-library';
import {draftFor, loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(cleanup);

const options = () => screen.queryAllByRole('option');

describe('PartLibrary', () => {
  it('AC-CMP-009.1: incompatible parts are hidden until "Show incompatible"; then disabled with a reason', async () => {
    const user = userEvent.setup();
    render(<PartLibrary target={draftFor(catalog)} catalog={catalog} />);
    expect(screen.queryByRole('option', {name: /^Buns/})).toBeNull();
    await user.click(screen.getByRole('checkbox', {name: 'Show incompatible'}));
    const buns = screen.getByRole('option', {name: /^Buns/});
    expect(buns.getAttribute('aria-disabled')).toBe('true');
    // WCAG 2.5.3: the visible reason is part of the name, and also the description.
    expect(buns.getAttribute('aria-label')).toContain('Fits');
    expect(
      screen.getByRole('option', {
        name: /^Buns/,
        description: 'Fits Superhero (female) bodies only',
      }),
    ).toBeTruthy();
    const calls = draftFor(catalog);
    cleanup();
    render(<PartLibrary target={calls} catalog={catalog} />);
    await user.click(screen.getByRole('checkbox', {name: 'Show incompatible'}));
    await user.click(screen.getByRole('option', {name: /^Buns/}));
    expect(calls.getSpec().parts['hair']?.ref).not.toContain('buns');
  });

  it('AC-CMP-029.1: a thumbnail that fails to load falls back to the slot icon', () => {
    const withThumbs: Catalog = {
      ...catalog,
      parts: catalog.parts.map(p => ({...p, thumbnailUrl: '/missing.png'})),
    };
    const {container} = render(
      <PartLibrary target={draftFor(withThumbs)} catalog={withThumbs} />,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0);
    imgs.forEach(img => fireEvent.error(img));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(
      container.querySelectorAll('svg.cmp-slot-icon').length,
    ).toBeGreaterThan(0);
  });

  it('AC-CMP-029.2: a tile is named with its part, slot and equipped state', () => {
    render(<PartLibrary target={draftFor(catalog)} catalog={catalog} />);
    expect(
      screen.getByRole('option', {name: 'Simple parted Equipped, Hair'}),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', {name: 'Buzzed, Hair, not equipped'}),
    ).toBeTruthy();
  });

  it('AC-CMP-030.1: search filters by name and tags, case-insensitively', async () => {
    const user = userEvent.setup();
    render(<PartLibrary target={draftFor(catalog)} catalog={catalog} />);
    await user.type(
      screen.getByRole('searchbox', {name: 'Search parts'}),
      'BUZZ',
    );
    const names = options().map(o => o.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(n => /buzz/i.test(n ?? ''))).toBe(true);
    const part = catalog.parts.find(p => p.tags.length > 0);
    expect(matchesQuery(part!, part!.tags[0]!.toUpperCase())).toBe(true);
  });

  it('AC-CMP-030.2: no match shows a message and Clear search restores the list', async () => {
    const user = userEvent.setup();
    render(<PartLibrary target={draftFor(catalog)} catalog={catalog} />);
    await user.type(screen.getByRole('searchbox'), 'zzzz-nothing');
    expect(screen.getByText('No parts match')).toBeTruthy();
    expect(options()).toHaveLength(0);
    await user.click(screen.getByRole('button', {name: 'Clear search'}));
    expect(options().length).toBeGreaterThan(0);
  });

  it('AC-CMP-032.1: arrows move in the grid, Enter equips and focus stays on the tile', async () => {
    const user = userEvent.setup();
    const {store, target} = projectFor(catalog);
    render(
      <PartLibrary
        target={target}
        catalog={catalog}
        slot="hair"
        onSlotChange={() => {}}
        columns={4}
      />,
    );
    screen.getByRole('option', {name: /^Simple parted/}).focus();
    await user.keyboard('{ArrowLeft}{Enter}');
    const tile = focused() as HTMLElement;
    expect(tile.getAttribute('aria-label')).toMatch(/^Buzzed/);
    expect(target.getSpec().parts['hair']?.ref).toBe(
      'builtin:quaternius-ubc/hair-buzzed',
    );
    expect(document.activeElement).toBe(tile);
    expect(store.getState().historyLength).toBe(1);
  });

  it('AC-CMP-032.1: Delete clears the slot of the focused part', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog);
    render(<PartLibrary target={target} catalog={catalog} />);
    screen.getByRole('option', {name: /^Simple parted/}).focus();
    await user.keyboard('{Delete}');
    expect(target.getSpec().parts['hair']).toBeUndefined();
  });

  it('AC-CMP-002.1: the body slot cannot be cleared (Delete on the equipped body keeps it)', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog);
    const body = target.getSpec().body.ref;
    render(<PartLibrary target={target} catalog={catalog} />);
    const tiles = options().filter(o =>
      /Body/.test(o.getAttribute('aria-label') ?? ''),
    );
    expect(tiles.length).toBeGreaterThan(0);
    tiles[0]?.focus();
    await user.keyboard('{Delete}');
    expect(target.getSpec().body.ref).toBe(body);
  });

  it('AC-CMP-032.1: the slot filter limits the grid to one slot and marks the chip pressed', async () => {
    const user = userEvent.setup();
    render(<PartLibrary target={draftFor(catalog)} catalog={catalog} />);
    const chip = screen.getByRole('button', {name: 'Headwear'});
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(
      options().every(o => /Headwear/.test(o.getAttribute('aria-label') ?? '')),
    ).toBe(true);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(
      <PartLibrary target={draftFor(catalog)} catalog={catalog} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
