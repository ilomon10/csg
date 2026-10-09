// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import type {EasyCategoryDef} from '@csg/parts-schema';
import {createDraftTarget} from '../../../shared/document';
import {loadWizardCatalog} from '../../views/wizard/wizard-test-support';
import {EasyCategoryPanel} from './easy-panel';

afterEach(cleanup);

describe('EasyCategoryPanel is data-driven (REQ-UX-060)', () => {
  it('AC-UX-060.2: a slot added to the Accessories category data file shows as a tile group with no code change', async () => {
    const base = await loadWizardCatalog();
    const accessories = base.easyCategories.find(c => c.id === 'accessories');
    if (accessories === undefined) throw new Error('no accessories category');
    expect(accessories.slots).not.toContain('headwear');

    const render_ = async (def: EasyCategoryDef) => {
      const catalog = await loadWizardCatalog(undefined, {
        '/packs/quaternius-ubc/presets/categories/accessories.json':
          JSON.stringify(def),
      });
      const target = createDraftTarget(
        createDefaultCharacterSpec(),
        () => catalog,
      );
      const shown = catalog.easyCategories.find(c => c.id === 'accessories');
      if (shown === undefined) throw new Error('category lost');
      render(
        <EasyCategoryPanel
          def={shown}
          catalog={catalog}
          target={target}
          onEditInPro={() => undefined}
        />,
      );
    };

    await render_(accessories);
    expect(screen.queryByRole('listbox', {name: 'Headwear'})).toBeNull();
    cleanup();

    await render_({...accessories, slots: [...accessories.slots, 'headwear']});
    expect(screen.getByRole('listbox', {name: 'Headwear'})).toBeTruthy();
    // The groups that were there before are still there.
    expect(screen.getByRole('listbox', {name: 'Back'})).toBeTruthy();
  });
});
