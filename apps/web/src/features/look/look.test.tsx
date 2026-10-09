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
import {defaultRenderSettings} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {axeViolations} from '../../shared/ui/test-utils';
import {LookPanel} from './look-panel';
import {ProRenderTab} from './pro-render-tab';
import {resolveRenderPatch} from './render-model';
import {measureStructural, STRUCTURAL_BUDGET_MS} from './structural-timing';
import type {StructuralSample, StructuralTiming} from './structural-timing';
import {loadTestCatalog, openProject} from './test-support';

afterEach(cleanup);

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});

const picker = () => screen.getByRole('combobox', {name: 'Look preset'});
const renderOf = (store: ReturnType<typeof openProject>) =>
  store.getState().doc!.render;

describe('look panel', () => {
  it('AC-EDT-034.1: shows the preset picker and at most 10 labelled controls, no node canvas', async () => {
    const store = openProject();
    const {container} = render(<LookPanel store={store} catalog={catalog} />);
    expect(picker()).toBeTruthy();
    const group = screen.getByRole('group', {name: 'Look controls'});
    const controls = [
      ...within(group).queryAllByRole('combobox'),
      ...within(group).queryAllByRole('switch'),
      ...within(group).queryAllByRole('slider'),
    ];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.length).toBeLessThanOrEqual(10);
    for (const control of controls) {
      expect(control.id).not.toBe('');
      expect(
        container.querySelector(`label[for="${control.id}"]`),
      ).toBeTruthy();
    }
    expect(container.querySelector('.react-flow, canvas')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('AC-EDT-044.1: picking GameBoy 4-color applies its palette, dither and outline as one undo step', async () => {
    const store = openProject();
    render(<LookPanel store={store} catalog={catalog} />);
    // The default project already is Classic 16-bit, so nothing is customized: no confirm step.
    expect((picker() as HTMLSelectElement).value).toBe('classic-16bit');
    await userEvent.selectOptions(picker(), 'gameboy-4');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const r = renderOf(store);
    expect(r.palette.id).toBe('custom');
    expect(r.palette.colors).toEqual([
      '#081820',
      '#346856',
      '#88c070',
      '#e0f8d0',
    ]);
    expect(r.palette.dither.mode).toBe('bayer4');
    expect(r.toon.rim.enabled).toBe(false);
    expect(store.getState().historyLength).toBe(1);
    act(() => {
      store.undo();
    });
    expect(renderOf(store).palette.id).toBe('none');
  });

  it('AC-EDT-045.1: applying a preset over customized values asks first, names what is replaced, and is one undo', async () => {
    const store = openProject();
    render(<LookPanel store={store} catalog={catalog} />);
    await userEvent.selectOptions(picker(), 'gameboy-4');
    await userEvent.selectOptions(
      screen.getByRole('combobox', {name: 'Dither'}),
      'bayer8',
    );
    expect(
      (picker() as HTMLSelectElement).selectedOptions[0]?.textContent,
    ).toBe('GameBoy 4-color (modified)');
    const before = renderOf(store);
    await userEvent.selectOptions(picker(), 'nes-like');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('NES-like');
    expect(dialog.textContent).toMatch(/Toon shading/);
    expect(dialog.textContent).toMatch(/Palette and dither/);
    // Keeping the look changes nothing.
    await userEvent.click(
      within(dialog).getByRole('button', {name: 'Keep my look'}),
    );
    expect(renderOf(store)).toBe(before);
    await userEvent.selectOptions(picker(), 'nes-like');
    await userEvent.click(screen.getByRole('button', {name: 'Replace'}));
    expect(renderOf(store).palette.id).toBe('custom');
    expect(renderOf(store).toon.bands).toBe(2);
    act(() => {
      store.undo();
    });
    expect(renderOf(store)).toEqual(before);
  });

  it('AC-EDT-045.1: Reset look restores the preset after confirmation', async () => {
    const store = openProject();
    render(<LookPanel store={store} catalog={catalog} />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', {name: 'Shading bands'}),
      '4',
    );
    await userEvent.click(screen.getByRole('button', {name: 'Reset look'}));
    await userEvent.click(screen.getByRole('button', {name: 'Replace'}));
    expect(renderOf(store).toon.bands).toBe(3);
  });

  it('AC-EDT-034.1: each control has its own reset to the active preset value', async () => {
    const store = openProject();
    render(<LookPanel store={store} catalog={catalog} />);
    const reset = screen.getByRole('button', {name: 'Reset Shading bands'});
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(
      screen.getByRole('combobox', {name: 'Shading bands'}),
      '2',
    );
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(reset);
    expect(renderOf(store).toon.bands).toBe(3);
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    // A slider resets too.
    fireEvent.change(screen.getByRole('slider', {name: 'Ambient light'}), {
      target: {value: '0.5'},
    });
    expect(renderOf(store).lighting.ambient).toBe(0.5);
    await userEvent.click(
      screen.getByRole('button', {name: 'Reset Ambient light'}),
    );
    expect(renderOf(store).lighting.ambient).toBe(
      defaultRenderSettings().lighting.ambient,
    );
  });

  it('AC-EDT-034.1: a read-only project disables every control', () => {
    const store = openProject();
    store.setReadOnly(true);
    render(<LookPanel store={store} catalog={catalog} />);
    expect(picker().matches(':disabled')).toBe(true);
  });
});

describe('pro render tab', () => {
  it('AC-PIX-037.1: an invalid resolution is not applied and shows its path code', async () => {
    const store = openProject();
    const before = renderOf(store);
    const {container} = render(<ProRenderTab store={store} />);
    const width = screen.getByLabelText('Resolution: Width');
    await userEvent.clear(width);
    await userEvent.type(width, '20{Enter}');
    expect(renderOf(store)).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain(
      'PIX_INVALID_RESOLUTION',
    );
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
    // A valid value clears the error and applies.
    await userEvent.clear(width);
    await userEvent.type(width, '48{Enter}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(renderOf(store).resolution.width).toBe(48);
  });

  it('AC-PIX-037.1: the validator lists an invalid resolution and an invalid palette together', () => {
    const edit = resolveRenderPatch(defaultRenderSettings(), {
      resolution: {width: 20},
      palette: {id: 'custom', colors: ['#12345g']},
    });
    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.issues.map(i => [i.path, i.code])).toEqual(
      expect.arrayContaining([
        ['resolution.width', 'PIX_INVALID_RESOLUTION'],
        ['palette.colors.0', 'PIX_PALETTE_PARSE'],
      ]),
    );
  });

  it('AC-PIX-037.3: a custom palette with a bad color shows PIX_PALETTE_PARSE and changes nothing', async () => {
    const store = openProject();
    const before = renderOf(store);
    render(<ProRenderTab store={store} />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', {name: 'Palette'}),
      'custom',
    );
    const colors = screen.getByLabelText('Custom colors');
    await userEvent.type(colors, '#12345g{Enter}');
    expect(screen.getByRole('alert').textContent).toContain(
      'PIX_PALETTE_PARSE',
    );
    expect(renderOf(store)).toBe(before);
    await userEvent.clear(colors);
    await userEvent.type(colors, '#112233 #445566{Enter}');
    expect(renderOf(store).palette).toMatchObject({
      id: 'custom',
      colors: ['#112233', '#445566'],
    });
  });

  it('AC-EDT-034.1: camera, directions, dither, outline and toon dispatch single undoable render commands', async () => {
    const store = openProject();
    render(<ProRenderTab store={store} />);
    const pick = (name: string, value: string) =>
      userEvent.selectOptions(screen.getByRole('combobox', {name}), value);
    await pick('Camera', 'isometric');
    await pick('Directions', '4');
    await pick('Dither', 'bayer8');
    await pick('Toon bands', '2');
    await pick('Outline width', '2');
    await userEvent.click(screen.getByRole('switch', {name: 'Outline'}));
    const r = renderOf(store);
    expect(r.camera.preset).toBe('isometric');
    expect(r.directions).toBe(4);
    expect(r.palette.dither.mode).toBe('bayer8');
    expect(r.toon.bands).toBe(2);
    expect(r.outline.outer).toEqual({enabled: false, widthPx: 2});
    expect(store.getState().historyLength).toBe(6);
    // Isometric default pivot follows the cell height: round(64 * 5 / 32) = 10.
    expect(r.camera.pivotRowPx).toBe(10);
  });
});

describe('structural change timing', () => {
  const clock = (ticks: number[]) => {
    const samples: StructuralSample[] = [];
    const timing: StructuralTiming = {
      now: () => ticks.shift() ?? 0,
      whenShown: () => Promise.resolve(),
      report: s => samples.push(s),
    };
    return {timing, samples};
  };

  it('AC-EDT-044.1: reports the time from dispatch until shown against the 300 ms budget', async () => {
    const fast = clock([0, 120]);
    expect(await measureStructural('x', () => {}, fast.timing)).toEqual({
      kind: 'x',
      ms: 120,
      withinBudget: true,
    });
    const slow = clock([0, STRUCTURAL_BUDGET_MS + 1]);
    await measureStructural('x', () => {}, slow.timing);
    expect(slow.samples[0]?.withinBudget).toBe(false);
  });

  it('AC-EDT-044.1: structural panel edits report a sample, slider edits do not', async () => {
    const store = openProject();
    const {timing, samples} = clock([0, 50, 0, 50]);
    render(<LookPanel store={store} catalog={catalog} timing={timing} />);
    await userEvent.selectOptions(picker(), 'hi-bit');
    await vi.waitFor(() => expect(samples).toHaveLength(1));
    expect(samples[0]).toMatchObject({
      kind: 'look-preset',
      ms: 50,
      withinBudget: true,
    });
    fireEvent.change(screen.getByRole('slider', {name: 'Ambient light'}), {
      target: {value: '0.3'},
    });
    expect(samples).toHaveLength(1);
  });
});
