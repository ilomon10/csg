// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {axeViolations, focused} from '../../shared/ui/test-utils';
import {isPairAvailable} from './style-gating';
import {SpeciesPicker, StylePicker} from './style-species-pickers';
import {
  draftFor,
  extraStyleOverrides,
  loadTestCatalog,
  projectFor,
} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
afterEach(cleanup);

const radios = () => screen.getAllByRole('radio');

describe('StylePicker and SpeciesPicker', () => {
  it('AC-CMP-045.1: styles in order with Realistic and Chibi enabled; species Human enabled, the rest Coming soon', () => {
    const target = draftFor(catalog);
    render(
      <>
        <StylePicker target={target} catalog={catalog} />
        <SpeciesPicker target={target} catalog={catalog} />
      </>,
    );
    const style = screen.getByRole('radiogroup', {name: 'Style'});
    const items = Array.from(style.querySelectorAll('[role=radio]'));
    expect(
      items.map(i => i.querySelector('.csg-tile__label')?.textContent),
    ).toEqual(['Realistic', 'Chibi', 'Stickman', 'Voxel']);
    expect(items.map(i => i.getAttribute('aria-disabled'))).toEqual([
      null,
      null,
      'true',
      'true',
    ]);
    expect(items[2]?.textContent).toContain('Coming soon');
    const species = Array.from(
      screen
        .getByRole('radiogroup', {name: 'Species'})
        .querySelectorAll('[role=radio]'),
    );
    expect(species.map(i => i.getAttribute('aria-disabled'))).toEqual([
      null,
      'true',
      'true',
    ]);
    expect(radios()).toHaveLength(7);
  });

  it('AC-CMP-045.2: arrowing onto Stickman focuses it with its description; Enter and Space change nothing', async () => {
    const user = userEvent.setup();
    const {store, target} = projectFor(catalog);
    const before = target.getSpec();
    render(<StylePicker target={target} catalog={catalog} />);
    screen.getByRole('radio', {name: /^Chibi/}).focus();
    await user.keyboard('{ArrowRight}');
    const stickman = screen.getByRole('radio', {name: /^Stickman/});
    expect(focused()).toBe(stickman);
    const description = document.getElementById(
      stickman.getAttribute('aria-describedby') ?? '',
    );
    expect(description?.textContent).toBe(
      'Coming soon. Available in a later update.',
    );
    await user.keyboard('{Enter} ');
    expect(target.getSpec()).toBe(before);
    expect(store.getState().historyLength).toBe(0);
  });

  it('AC-UX-092.1: Tab leaves the group normally', async () => {
    const user = userEvent.setup();
    const target = draftFor(catalog);
    render(
      <>
        <StylePicker target={target} catalog={catalog} />
        <button type="button">after</button>
      </>,
    );
    screen.getByRole('radio', {name: /^Chibi/}).focus();
    await user.keyboard('{ArrowRight}{Tab}');
    expect(focused()).toBe(screen.getByRole('button', {name: 'after'}));
  });

  it('AC-CMP-045.3: a supported pair plus a loaded style file enables Stickman (AC-UX-092.2)', async () => {
    const extended = await loadTestCatalog(
      await extraStyleOverrides('stickman'),
      [
        ['realistic', 'human'],
        ['chibi', 'human'],
        ['stickman', 'human'],
      ],
    );
    const target = draftFor(extended);
    const user = userEvent.setup();
    render(<StylePicker target={target} catalog={extended} />);
    const stickman = screen.getByRole('radio', {name: /^Stickman/});
    expect(stickman.getAttribute('aria-disabled')).toBeNull();
    await user.click(stickman);
    expect(target.getSpec().style).toBe('stickman');
  });

  it('AC-CMP-045.4: Stickman stays disabled with only one of the two conditions (AC-UX-092.3)', async () => {
    const supportedOnly = await loadTestCatalog({}, [
      ['realistic', 'human'],
      ['chibi', 'human'],
      ['stickman', 'human'],
    ]);
    expect(isPairAvailable(supportedOnly, 'stickman', 'human')).toBe(false);
    const fileOnly = await loadTestCatalog(
      await extraStyleOverrides('stickman'),
    );
    expect(isPairAvailable(fileOnly, 'stickman', 'human')).toBe(false);
    render(<StylePicker target={draftFor(fileOnly)} catalog={fileOnly} />);
    const stickman = screen.getByRole('radio', {name: /^Stickman/});
    expect(stickman.getAttribute('aria-disabled')).toBe('true');
    expect(stickman.textContent).toContain('Coming soon');
  });

  it('AC-CMP-042.1: choosing Chibi sets the style through one command', async () => {
    const user = userEvent.setup();
    const {store, target} = projectFor(catalog);
    render(<StylePicker target={target} catalog={catalog} />);
    await user.click(screen.getByRole('radio', {name: /^Chibi/}));
    expect(target.getSpec().style).toBe('chibi');
    expect(store.getState().historyLength).toBe(1);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const target = draftFor(catalog);
    const {container} = render(
      <>
        <StylePicker target={target} catalog={catalog} />
        <SpeciesPicker target={target} catalog={catalog} />
      </>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
