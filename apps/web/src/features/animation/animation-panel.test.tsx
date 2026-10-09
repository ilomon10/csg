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
import type {Catalog} from '../../shared/catalog';
import {axeViolations} from '../../shared/ui/test-utils';
import {AnimationPanel} from './animation-panel';
import {loadTestCatalog, openProject} from './test-support';

afterEach(cleanup);

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});

const clipByRef = (id: string) => {
  const clip = catalog.clips.find(c => c.id === id);
  if (!clip) throw new Error(`no clip ${id}`);
  return clip;
};
const add = async (id: string) =>
  userEvent.click(
    screen.getByRole('button', {name: `Add ${clipByRef(id).name}`}),
  );
const animations = (store: ReturnType<typeof openProject>['store']) =>
  store.getState().doc?.render.animations ?? [];

describe('animation panel: picker', () => {
  it('AC-ANM-001.1: clips are grouped by category and show their duration with 2 decimals', () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    const walk = clipByRef('walk');
    const group = screen.getByRole('region', {name: /Locomotion/i});
    const row = within(group).getByText(walk.name).closest('li');
    expect(row?.textContent).toContain(`${walk.durationSec.toFixed(2)} s`);
    expect(screen.getAllByRole('heading', {level: 4}).length).toBeGreaterThan(
      1,
    );
  });

  it('AC-ANM-002.1: a clip on another rig is hidden, and shown disabled with "Different skeleton" on request', async () => {
    const {store} = openProject(catalog);
    render(
      <AnimationPanel store={store} catalog={catalog} bodyRig="other-rig" />,
    );
    expect(screen.queryByRole('button', {name: /^Add /})).toBeNull();
    await userEvent.click(
      screen.getByRole('checkbox', {name: 'Show incompatible'}),
    );
    const button = screen.getByRole('button', {
      name: `Add ${clipByRef('walk').name}`,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Different skeleton').length).toBeGreaterThan(0);
  });

  it('AC-ANM-003.1: search filters by name, id and tag', async () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    await userEvent.type(screen.getByRole('searchbox'), 'WALK');
    const names = screen
      .getAllByRole('button', {name: /^Add /})
      .map(b => b.getAttribute('aria-label') ?? '');
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.every(
        n =>
          /walk/i.test(n) ||
          catalog.clips.some(
            c =>
              `Add ${c.name}` === n &&
              (c.id.includes('walk') ||
                c.tags.some(t => t.toLowerCase().includes('walk'))),
          ),
      ),
    ).toBe(true);
    expect(names.length).toBeLessThan(catalog.clips.length);
  });

  it('AC-ANA-025.1: a style-excluded clip is not listed or found; changing the style lists it again', async () => {
    const hit = clipByRef('hit-head');
    const styled: Catalog = {
      ...catalog,
      styles: new Map([
        ...catalog.styles,
        [
          'chibi',
          {
            format: 'sprite-style',
            version: 1,
            style: 'chibi',
            excludedClips: [{clip: hit.ref, reason: 'fixture'}],
          },
        ],
      ]),
    };
    const {store} = openProject(styled, {style: 'chibi'});
    render(<AnimationPanel store={store} catalog={styled} />);
    expect(screen.queryByRole('button', {name: `Add ${hit.name}`})).toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'hit');
    expect(screen.queryByRole('button', {name: `Add ${hit.name}`})).toBeNull();
    act(() => {
      store.dispatch({
        label: 'Style: realistic',
        feature: 'composer',
        apply: doc => ({
          ...doc,
          character: {...doc.character, style: 'realistic'},
        }),
      });
    });
    expect(screen.getByRole('button', {name: `Add ${hit.name}`})).toBeTruthy();
  });

  it('AC-ANA-027.1: an excluded clip stays selected after a style change and a warning names it', () => {
    const hit = clipByRef('hit-head');
    const styled: Catalog = {
      ...catalog,
      styles: new Map([
        ...catalog.styles,
        [
          'chibi',
          {
            format: 'sprite-style',
            version: 1,
            style: 'chibi',
            excludedClips: [{clip: hit.ref, reason: 'fixture'}],
          },
        ],
      ]),
    };
    const {store} = openProject(styled);
    render(<AnimationPanel store={store} catalog={styled} />);
    return (async () => {
      await add('hit-head');
      const before = animations(store);
      expect(screen.queryByText(/may look broken/)).toBeNull();
      act(() => {
        store.dispatch({
          label: 'Style: chibi',
          feature: 'composer',
          apply: doc => ({
            ...doc,
            character: {...doc.character, style: 'chibi'},
          }),
        });
      });
      expect(animations(store)).toEqual(before);
      expect(
        screen.getByText(`${hit.name} may look broken in Chibi style`),
      ).toBeTruthy();
    })();
  });
});

describe('animation panel: selections', () => {
  it('AC-ANM-004.1: idle and walk are stored in selection order with manifest defaults', async () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    await add('idle');
    await add('walk');
    const list = animations(store);
    expect(list.map(a => a.clipId)).toEqual([
      clipByRef('idle').ref,
      clipByRef('walk').ref,
    ]);
    for (const entry of list) {
      const clip = catalog.clips.find(c => c.ref === entry.clipId);
      expect(entry.frameCount).toBe(clip?.defaultFrameCount);
      expect(entry.loop).toBe(clip?.loop);
    }
  });

  it('AC-ANM-004.2: the 33rd clip cannot be added and the text says why', async () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    const idle = screen.getByRole('button', {
      name: `Add ${clipByRef('idle').name}`,
    });
    for (let i = 0; i < 32; i += 1) fireEvent.click(idle);
    expect(animations(store)).toHaveLength(32);
    expect((idle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Maximum 32 animations per export')).toBeTruthy();
    fireEvent.click(idle);
    expect(animations(store)).toHaveLength(32);
  });

  it('AC-ANM-006.1: adding the same clip twice gives the second a unique label', async () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    await add('walk');
    await add('walk');
    expect(animations(store).map(a => a.label)).toEqual(['walk', 'walk-2']);
  });

  it('AC-ANM-004.3: Alt+Down reorders and one undo restores the order', async () => {
    const {store} = openProject(catalog);
    render(<AnimationPanel store={store} catalog={catalog} />);
    await add('idle');
    await add('walk');
    const rows = screen.getAllByRole('button', {name: /^Settings for /});
    rows[0]?.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(animations(store).map(a => a.label)).toEqual(['walk', 'idle']);
    act(() => {
      store.undo();
    });
    expect(animations(store).map(a => a.label)).toEqual(['idle', 'walk']);
  });

  it('AC-ANM-020.1: choosing a clip sets the preview clip at once', async () => {
    const {store} = openProject(catalog);
    const viewport = {setPreviewClip: vi.fn()};
    render(
      <AnimationPanel store={store} catalog={catalog} viewport={viewport} />,
    );
    await add('walk');
    expect(viewport.setPreviewClip).toHaveBeenCalledWith(clipByRef('walk').ref);
  });
});

describe('animation panel: per-clip settings', () => {
  async function openSettings(id: string, testCatalog = catalog) {
    const {store} = openProject(testCatalog);
    const view = render(<AnimationPanel store={store} catalog={testCatalog} />);
    await userEvent.click(
      screen.getByRole('button', {name: `Add ${clipByRef(id).name}`}),
    );
    await userEvent.click(screen.getByRole('button', {name: /^Settings for /}));
    return {store, ...view};
  }

  it('AC-ANM-005.1: frames 65 is rejected with "Frames must be 1–64" and the value is kept', async () => {
    const {store} = await openSettings('walk');
    const frames = screen.getByRole('spinbutton', {name: 'Frames'});
    const before = animations(store)[0]?.frameCount;
    fireEvent.change(frames, {target: {value: '65'}});
    fireEvent.blur(frames);
    expect(screen.getByRole('alert').textContent).toBe('Frames must be 1–64');
    expect(animations(store)[0]?.frameCount).toBe(before);
    expect((frames as HTMLInputElement).value).toBe(String(before));
    fireEvent.change(frames, {target: {value: '12'}});
    fireEvent.blur(frames);
    expect(animations(store)[0]?.frameCount).toBe(12);
  });

  it('AC-ANM-005.2: range [1.2, 0.8] is rejected naming the range', async () => {
    const {store} = await openSettings('walk');
    const start = screen.getByRole('spinbutton', {name: 'Range start (s)'});
    const end = screen.getByRole('spinbutton', {name: 'Range end (s)'});
    fireEvent.change(end, {target: {value: '0.8'}});
    fireEvent.blur(end);
    expect(animations(store)[0]?.range).toEqual({startSec: 0, endSec: 0.8});
    fireEvent.change(start, {target: {value: '1.2'}});
    fireEvent.blur(start);
    expect(screen.getByRole('alert').textContent).toMatch(/^Range:/);
    expect(animations(store)[0]?.range).toEqual({startSec: 0, endSec: 0.8});
  });

  it('AC-ANM-009.1: D 1.2 s, N 8 defaults fps to 7; fps 14 shows "Plays at 2.1× source speed"', async () => {
    const base = clipByRef('walk');
    const fixture: Catalog = {
      ...catalog,
      clips: [{...base, durationSec: 1.2, defaultFrameCount: 8}],
    };
    const {store} = await openSettings('walk', fixture);
    expect(animations(store)[0]?.fps).toBe(7);
    expect(screen.queryByText(/source speed/)).toBeNull();
    const fps = screen.getByRole('spinbutton', {name: 'FPS'});
    fireEvent.change(fps, {target: {value: '14'}});
    fireEvent.blur(fps);
    expect(screen.getByText('Plays at 2.1× source speed')).toBeTruthy();
  });

  it('AC-UX-102.1: the panel with an open settings form has no axe violations', async () => {
    const {container} = await openSettings('walk');
    expect(await axeViolations(container)).toEqual([]);
  });
});
