// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  ANATOMY_PARAM_KEYS,
  createDefaultCharacterSpec,
} from '@csg/parts-schema';
import type {AnatomyPreset} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {createDraftTarget} from '../../shared/document';
import {axeViolations} from '../../shared/ui/test-utils';
import {AnatomyPanel} from './anatomy-panel';
import {BodyShapeCards} from './body-shape-cards';
import {ReadabilityHint} from './readability-hint';
import {loadTestCatalog, openProject} from './test-support';

afterEach(cleanup);

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});

const anatomyOf = (target: {getSpec(): {anatomy: object}}) =>
  target.getSpec().anatomy as Record<string, number>;
const presetSelect = () => screen.getByRole('combobox', {name: 'Preset'});
const selectedText = () =>
  (presetSelect() as HTMLSelectElement).selectedOptions[0]?.textContent;

describe('anatomy panel: presets', () => {
  it('AC-ANA-013.1: choosing chibi sets the nine values; one undo restores them', async () => {
    const {store, target} = openProject(catalog);
    const before = {...target.getSpec().anatomy};
    render(<AnatomyPanel target={target} catalog={catalog} gesture={store} />);
    await userEvent.selectOptions(presetSelect(), 'chibi');
    const chibi = catalog.anatomyPresets.get('chibi');
    expect(anatomyOf(target)).toEqual(chibi?.values);
    expect(store.getState().historyLength).toBe(1);
    act(() => {
      store.undo();
    });
    expect(target.getSpec().anatomy).toEqual(before);
  });

  it('AC-ANA-013.2: a preset added to the data appears in the menu without code', () => {
    const extra: AnatomyPreset = {
      format: 'sprite-anatomy-preset',
      version: 1,
      id: 'gangly',
      label: 'Gangly',
      values: {...createDefaultCharacterSpec().anatomy, legLength: 1.3},
    };
    const withExtra: Catalog = {
      ...catalog,
      anatomyPresets: new Map([...catalog.anatomyPresets, ['gangly', extra]]),
    };
    const {target} = openProject(withExtra);
    render(<AnatomyPanel target={target} catalog={withExtra} />);
    expect(
      within(presetSelect()).getByRole('option', {name: 'Gangly'}),
    ).toBeTruthy();
    expect(within(presetSelect()).getAllByRole('option').length).toBe(
      withExtra.anatomyPresets.size,
    );
  });

  it('AC-ANA-014.1: editing a value after chibi reads "Chibi (modified)"; Reset restores head 1.80', async () => {
    const {store, target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} gesture={store} />);
    await userEvent.selectOptions(presetSelect(), 'chibi');
    expect(selectedText()).toBe('Chibi');
    const head = screen.getByRole('spinbutton', {name: 'Head size value'});
    fireEvent.change(head, {target: {value: '1.6'}});
    fireEvent.blur(head);
    expect(target.getSpec().anatomy.head).toBe(1.6);
    expect(selectedText()).toBe('Chibi (modified)');
    await userEvent.click(screen.getByRole('button', {name: 'Reset'}));
    expect(target.getSpec().anatomy.head).toBe(1.8);
    expect(selectedText()).toBe('Chibi');
  });
});

describe('anatomy panel: sliders', () => {
  it('AC-ANA-017.1: Page Up twice raises head by 0.20 and one undo restores it', async () => {
    const {store, target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} gesture={store} />);
    const slider = screen.getByRole('slider', {name: 'Head size'});
    slider.focus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    expect(target.getSpec().anatomy.head).toBe(1.2);
    expect(store.getState().historyLength).toBe(1);
    act(() => {
      store.undo();
    });
    expect(target.getSpec().anatomy.head).toBe(1);
  });

  it('AC-ANA-017.1: arrow keys step 0.01 without float drift', async () => {
    const {target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} />);
    const slider = screen.getByRole('slider', {name: 'Torso width'});
    slider.focus();
    for (let i = 0; i < 3; i += 1) await userEvent.keyboard('{ArrowRight}');
    expect(target.getSpec().anatomy.torsoWidth).toBe(1.03);
  });

  it('AC-ANA-017.2: typing 3 clamps to 2.00 and announces "Maximum 2.00"', () => {
    const {target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} />);
    const head = screen.getByRole('spinbutton', {name: 'Head size value'});
    fireEvent.change(head, {target: {value: '3'}});
    fireEvent.blur(head);
    expect(target.getSpec().anatomy.head).toBe(2);
    expect((head as HTMLInputElement).value).toBe('2.00');
    expect(screen.getByText('Maximum 2.00').getAttribute('role')).toBe(
      'status',
    );
  });

  it('AC-ANA-017.1: a pointer drag is one undo step; per-slider reset restores the preset value', () => {
    const {store, target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} gesture={store} />);
    const slider = screen.getByRole('slider', {name: 'Height'});
    fireEvent.pointerDown(slider);
    for (const v of ['1.05', '1.1', '1.15', '1.2']) {
      fireEvent.change(slider, {target: {value: v}});
    }
    fireEvent.pointerUp(window);
    expect(target.getSpec().anatomy.height).toBe(1.2);
    expect(store.getState().historyLength).toBe(1);
    act(() => {
      store.undo();
    });
    expect(target.getSpec().anatomy.height).toBe(1);
    fireEvent.change(slider, {target: {value: '1.1'}});
    fireEvent.click(screen.getByRole('button', {name: 'Reset Height'}));
    expect(target.getSpec().anatomy.height).toBe(1);
  });

  it('AC-ANA-017.1: every parameter has a slider, a number field and a labelled reset', () => {
    const {target} = openProject(catalog);
    render(<AnatomyPanel target={target} catalog={catalog} />);
    expect(screen.getAllByRole('slider')).toHaveLength(
      ANATOMY_PARAM_KEYS.length,
    );
    expect(screen.getAllByRole('spinbutton')).toHaveLength(
      ANATOMY_PARAM_KEYS.length,
    );
  });

  it('AC-UX-102.1: the panel has no axe violations', async () => {
    const {target} = openProject(catalog);
    const {container} = render(
      <AnatomyPanel
        target={target}
        catalog={catalog}
        readability={{
          resolutionPx: 32,
          estimate: {forearmPx: 1.2, shinPx: 3, headPx: 8},
        }}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('body-shape cards', () => {
  const names = ['Average', 'Slim', 'Athletic', 'Stocky', 'Tall', 'Petite'];

  it('AC-UX-063.2: six cards in order, no chibi or heroic card; stocky applies the factors and one undo restores', async () => {
    const {store, target} = openProject(catalog);
    const before = {...target.getSpec().anatomy};
    render(<BodyShapeCards target={target} catalog={catalog} />);
    const radios = screen.getAllByRole('radio');
    expect(
      radios.map(r => within(r).getByText(/^[A-Z][a-z]+$/).textContent),
    ).toEqual(names);
    expect(
      screen.getByRole('radio', {name: /Average/}).getAttribute('aria-checked'),
    ).toBe('true');
    await userEvent.click(screen.getByRole('radio', {name: /Stocky/}));
    const stocky = catalog.bodyShapes.find(s => s.id === 'stocky');
    expect(target.getSpec().anatomy).toEqual({...before, ...stocky?.factors});
    expect(
      screen.getByRole('radio', {name: /Stocky/}).getAttribute('aria-checked'),
    ).toBe('true');
    expect(store.getState().historyLength).toBe(1);
    act(() => {
      store.undo();
    });
    expect(target.getSpec().anatomy).toEqual(before);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('AC-UX-063.2: on style chibi, stocky gives torsoWidth 1.32 and legLength 0.70', async () => {
    const chibi = catalog.anatomyPresets.get('chibi');
    const {target} = openProject(catalog, {
      style: 'chibi',
      anatomy: {...chibi?.values} as never,
    });
    render(<BodyShapeCards target={target} catalog={catalog} />);
    await userEvent.click(screen.getByRole('radio', {name: /Stocky/}));
    expect(target.getSpec().anatomy.torsoWidth).toBe(1.32);
    expect(target.getSpec().anatomy.legLength).toBe(0.7);
    expect(target.getSpec().anatomy.head).toBe(1.8);
  });

  it('AC-UX-093.1: on a draft target, athletic sets the athletic row and petite on chibi gives height 0.80', async () => {
    const draft = createDraftTarget(
      createDefaultCharacterSpec(),
      () => catalog,
    );
    const {unmount} = render(
      <BodyShapeCards target={draft} catalog={catalog} />,
    );
    await userEvent.click(screen.getByRole('radio', {name: /Athletic/}));
    const athletic = catalog.bodyShapes.find(s => s.id === 'athletic');
    expect(draft.getSpec().anatomy).toEqual({
      ...createDefaultCharacterSpec().anatomy,
      ...athletic?.factors,
    });
    unmount();
    const chibi = catalog.anatomyPresets.get('chibi');
    const draft2 = createDraftTarget(
      {
        ...createDefaultCharacterSpec(),
        style: 'chibi',
        anatomy: {...chibi?.values} as never,
      },
      () => catalog,
    );
    render(<BodyShapeCards target={draft2} catalog={catalog} />);
    await userEvent.click(screen.getByRole('radio', {name: /Petite/}));
    expect(draft2.getSpec().anatomy.height).toBe(0.8);
  });

  it('AC-UX-055.1: head 1.2 shows a selected Custom card with Edit in Pro and the document is untouched', async () => {
    const base = createDefaultCharacterSpec().anatomy;
    const {store, target} = openProject(catalog, {
      anatomy: {...base, head: 1.2},
    });
    const onEditInPro = vi.fn();
    const {container} = render(
      <>
        <BodyShapeCards
          target={target}
          catalog={catalog}
          onEditInPro={onEditInPro}
        />
        <AnatomyPanel target={target} catalog={catalog} gesture={store} />
      </>,
    );
    const custom = screen.getAllByRole('radio', {name: /Custom/})[0];
    expect(custom?.getAttribute('aria-checked')).toBe('true');
    expect(selectedText()).toMatch(/\(modified\)$/);
    await userEvent.click(screen.getByRole('button', {name: 'Edit in Pro'}));
    expect(onEditInPro).toHaveBeenCalledOnce();
    expect(target.getSpec().anatomy.head).toBe(1.2);
    expect(store.getState().historyLength).toBe(0);
    expect(
      container.querySelector('[data-focus-key="anatomy.preset"]'),
    ).not.toBeNull();
  });
});

describe('readability hint', () => {
  it('AC-ANA-015.1: a thin forearm at 32 px shows the hint; chibi-like sizes show none', async () => {
    const focus = vi.fn();
    const {rerender, container} = render(
      <ReadabilityHint
        resolutionPx={32}
        estimate={{forearmPx: 1.2, shinPx: 3, headPx: 8}}
        onFocusLimbThickness={focus}
      />,
    );
    expect(
      screen.getByText(
        'Arms are thinner than 2 px at 32 px. Try Limb thickness or the Chibi preset.',
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', {name: 'Go to Limb thickness'}),
    );
    expect(focus).toHaveBeenCalled();
    rerender(
      <ReadabilityHint
        resolutionPx={32}
        estimate={{forearmPx: 2.5, shinPx: 3, headPx: 8}}
        onFocusLimbThickness={focus}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
