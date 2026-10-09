// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createDefaultCharacterSpec,
  parseCharacterSpec,
} from '@csg/parts-schema';
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {toastQueue} from '../../shared/ui';
import {axeViolations} from '../../shared/ui/test-utils';
import {CharacterFileMenu} from './character-file-menu';
import {serializeCharacter} from './character-file';
import {OpenSharedDialog} from './open-shared-dialog';
import {loadTestCatalog, projectFor} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});
beforeEach(() => {
  for (const t of toastQueue.visible()) toastQueue.dismiss(t.id);
});
afterEach(cleanup);

const fileFrom = (text: string) =>
  ({
    size: text.length,
    text: () => Promise.resolve(text),
  }) as unknown as File;

async function pick(menu: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', {name: 'Character file'}));
  await user.click(screen.getByRole('menuitem', {name: menu}));
}

describe('CharacterFileMenu', () => {
  it('AC-CMP-022.1: Save downloads <name>.character.json with the canonical text', async () => {
    const {target} = projectFor(catalog, {
      spec: {...createDefaultCharacterSpec(), name: 'Hero #1'},
    });
    const saved: Array<[string, string]> = [];
    render(
      <CharacterFileMenu
        target={target}
        catalog={catalog}
        download={(f, t) => saved.push([f, t])}
      />,
    );
    await pick('Save character file');
    expect(saved).toEqual([
      ['hero-1.character.json', serializeCharacter(target.getSpec())],
    ]);
  });

  it('AC-CMP-023.1: Load replaces the character as one undoable command', async () => {
    const {store, target} = projectFor(catalog);
    const incoming = {
      ...createDefaultCharacterSpec(),
      name: 'Loaded one',
      seed: 7,
    };
    const before = target.getSpec();
    render(<CharacterFileMenu target={target} catalog={catalog} />);
    fireEvent.change(screen.getByTestId('character-file-input'), {
      target: {files: [fileFrom(serializeCharacter(incoming))]},
    });
    await waitFor(() => expect(target.getSpec().name).toBe('Loaded one'));
    expect(store.getState().historyLength).toBe(1);
    store.undo();
    expect(target.getSpec()).toEqual(before);
  });

  it('AC-CMP-023.2: a bad file shows CMP_SPEC_INVALID and changes nothing', async () => {
    const {store, target} = projectFor(catalog);
    const before = target.getSpec();
    render(<CharacterFileMenu target={target} catalog={catalog} />);
    fireEvent.change(screen.getByTestId('character-file-input'), {
      target: {
        files: [fileFrom('{"format":"x","body":{"ref":"builtin:a/b"}}')],
      },
    });
    await waitFor(() => expect(toastQueue.visible().length).toBeGreaterThan(0));
    const toast = toastQueue.visible().at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.code).toBe('CMP_SPEC_INVALID');
    expect(target.getSpec()).toBe(before);
    expect(store.getState().historyLength).toBe(0);
  });

  it('AC-CMP-024.1: a missing builtin part is reported in a non-blocking notice', async () => {
    const {target} = projectFor(catalog);
    const spec = JSON.parse(serializeCharacter(createDefaultCharacterSpec()));
    spec.parts.back = {ref: 'builtin:quaternius-outfits/cape-99'};
    render(<CharacterFileMenu target={target} catalog={catalog} />);
    fireEvent.change(screen.getByTestId('character-file-input'), {
      target: {files: [fileFrom(JSON.stringify(spec))]},
    });
    await waitFor(() =>
      expect(
        toastQueue.visible().some(t => t.message.includes('cape-99')),
      ).toBe(true),
    );
    expect(target.getSpec().parts['back']).toBeUndefined();
  });

  it('AC-CMP-025.1: Copy share link writes the link to the clipboard', async () => {
    const {target} = projectFor(catalog);
    const copied: string[] = [];
    render(
      <CharacterFileMenu
        target={target}
        catalog={catalog}
        shareUrl={async () => 'https://editor.example/#c=abc'}
        copyText={async text => void copied.push(text)}
      />,
    );
    await pick('Copy share link');
    await waitFor(() =>
      expect(copied).toEqual(['https://editor.example/#c=abc']),
    );
  });

  it('AC-CMP-026.1: a character with a user part asks first, lists it, and shares without it', async () => {
    const base = createDefaultCharacterSpec();
    const {target} = projectFor(catalog, {
      spec: {
        ...base,
        parts: {...base.parts, headwear: {ref: 'user:hat-1' as never}},
      },
    });
    const urls: string[] = [];
    const copied: string[] = [];
    const user = userEvent.setup();
    render(
      <CharacterFileMenu
        target={target}
        catalog={catalog}
        shareUrl={async spec => {
          const url = `link:${JSON.stringify(spec.parts)}`;
          urls.push(url);
          return url;
        }}
        copyText={async text => void copied.push(text)}
      />,
    );
    await pick('Copy share link');
    const dialog = screen.getByRole('alertdialog', {
      name: 'Some parts are not included',
    });
    expect(dialog.textContent).toContain('hat-1');
    expect(urls).toHaveLength(0);
    await user.click(screen.getByRole('button', {name: 'Share without it'}));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).not.toContain('user:');
  });

  it('AC-UX-036.1: the menu has no axe violations', async () => {
    const {container} = render(
      <CharacterFileMenu
        target={projectFor(catalog).target}
        catalog={catalog}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('OpenSharedDialog', () => {
  const shared = {...createDefaultCharacterSpec(), name: 'Rowan'};

  it('AC-CMP-035.1: "Open as new project" hands the shared character to the host', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <OpenSharedDialog
        open
        spec={shared}
        onOpenAsNew={s => opened.push(s.name)}
        onCancel={() => opened.push('cancel')}
      />,
    );
    expect(
      screen.getByRole('alertdialog', {name: 'Open shared character?'}),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Open as new project'}));
    expect(opened).toEqual(['Rowan']);
  });

  it('AC-CMP-035.2: Cancel and Escape create nothing; Cancel has initial focus', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <OpenSharedDialog
        open
        spec={shared}
        onOpenAsNew={() => calls.push('open')}
        onCancel={() => calls.push('cancel')}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'Cancel'}),
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(calls).toEqual(['cancel', 'cancel']);
  });

  it('AC-CMP-049.3: a #c= fragment holding a version-1 spec shows the confirmation and opens as version 2', async () => {
    const {style: _s, species: _sp, ...rest} = createDefaultCharacterSpec();
    const v1 = {...rest, version: 1};
    // The share codec (node-tested, AC-CMP-034.3) hands this exact parse result to the dialog.
    const decoded = parseCharacterSpec(v1);
    if (!decoded.ok) throw new Error('v1 spec must migrate');
    expect(decoded.value.version).toBe(2);
    const opened: number[] = [];
    render(
      <OpenSharedDialog
        open
        spec={decoded.value}
        onOpenAsNew={s => opened.push(s.version)}
        onCancel={() => undefined}
      />,
    );
    expect(
      screen.getByRole('alertdialog', {name: 'Open shared character?'}),
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', {name: 'Open as new project'}));
    expect(opened).toEqual([2]);
  });

  it('AC-CMP-035.3: clearing the fragment leaves an empty hash and no extra history entry', async () => {
    const {clearShareFragment} = await import('./share-link');
    window.history.pushState(null, '', '/edit?x=1#c=abc');
    const length = window.history.length;
    clearShareFragment();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/edit?x=1');
    expect(window.history.length).toBe(length);
  });
});
