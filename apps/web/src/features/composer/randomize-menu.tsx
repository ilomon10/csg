import type {ReactElement} from 'react';
import type {EasyCategoryId} from '@csg/parts-schema';
import {
  defaultLocks,
  freshSeed,
  randomize,
  type CharacterTarget,
  type RandomizeLocks,
} from '../../shared/document';
import {t} from '../../shared/i18n';
import {announce, Icon, MenuButton, type MenuItem} from '../../shared/ui';

/** Props of {@link RandomizeMenu}. */
export interface RandomizeMenuProps {
  readonly target: CharacterTarget;
  /** Active Easy category: adds "This tab" (REQ-UX-065). Omit in Pro and the wizard. */
  readonly category?: EasyCategoryId;
  /** Fields randomize may not touch; style and species are locked by default (REQ-CMP-046). */
  readonly locks?: RandomizeLocks;
  /** Seed source; a fresh seed per roll by default. Inject a constant in tests. */
  readonly seed?: () => number;
  /** Accessible name of the trigger. */
  readonly ariaLabel?: string;
}

/**
 * Randomize menu button (REQ-UX-064): "This tab" (when a category is active) and "Everything".
 * Each choice is one command on the target, so it is one undo step. Locked style and species
 * and `availableStyleCombos` gating are handled by the command, never re-implemented here.
 */
export function RandomizeMenu({
  target,
  category,
  locks = defaultLocks(),
  seed = freshSeed,
  ariaLabel,
}: RandomizeMenuProps): ReactElement {
  const roll = (scope: Parameters<typeof randomize>[0]['scope']) => {
    target.apply(randomize({scope, locks, seed: seed()}));
    announce(t('composer.randomize'));
  };
  const items: MenuItem[] = [];
  if (category) {
    items.push({
      id: 'tab',
      label: t('composer.randomize.tab'),
      onSelect: () => roll({category}),
    });
  }
  items.push({
    id: 'all',
    label: t('composer.randomize.all'),
    onSelect: () => roll('all'),
  });
  return (
    <MenuButton items={items} ariaLabel={ariaLabel ?? t('composer.randomize')}>
      <Icon name="dice" />
      {t('composer.randomize')}
    </MenuButton>
  );
}
