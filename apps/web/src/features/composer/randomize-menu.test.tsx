// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {axeViolations} from '../../shared/ui/test-utils';
import {RandomizeMenu} from './randomize-menu';
import {loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(cleanup);

describe('RandomizeMenu', () => {
  it('AC-CMP-018.1: Everything is deterministic for a seed and is one undo step', async () => {
    const user = userEvent.setup();
    const a = projectFor(catalog);
    const b = projectFor(catalog);
    const before = a.target.getSpec();
    render(<RandomizeMenu target={a.target} seed={() => 12345} />);
    await user.click(screen.getByRole('button', {name: 'Randomize'}));
    await user.click(screen.getByRole('menuitem', {name: 'Everything'}));
    cleanup();
    render(<RandomizeMenu target={b.target} seed={() => 12345} />);
    await user.click(screen.getByRole('button', {name: 'Randomize'}));
    await user.click(screen.getByRole('menuitem', {name: 'Everything'}));
    expect(a.target.getSpec()).toEqual(b.target.getSpec());
    expect(a.target.getSpec().seed).toBe(12345);
    expect(a.store.getState().historyLength).toBe(1);
    a.store.undo();
    expect(a.target.getSpec()).toEqual(before);
  });

  it('AC-CMP-046.1: style and species stay locked by default', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    render(<RandomizeMenu target={target} seed={() => 777} />);
    await user.click(screen.getByRole('button', {name: 'Randomize'}));
    await user.click(screen.getByRole('menuitem', {name: 'Everything'}));
    expect(target.getSpec().style).toBe('realistic');
    expect(target.getSpec().species).toBe('human');
  });

  it('AC-UX-065.1: "This tab" appears with a category and leaves other slots alone', async () => {
    const user = userEvent.setup();
    const {target} = projectFor(catalog);
    const before = target.getSpec();
    render(<RandomizeMenu target={target} category="hair" seed={() => 99} />);
    await user.click(screen.getByRole('button', {name: 'Randomize'}));
    await user.click(screen.getByRole('menuitem', {name: 'This tab'}));
    const after = target.getSpec();
    expect(after.parts['torso']).toEqual(before.parts['torso']);
    expect(after.body).toEqual(before.body);
    expect(after.anatomy).toEqual(before.anatomy);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(
      <RandomizeMenu target={projectFor(catalog).target} category="hair" />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
