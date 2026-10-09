import {useSyncExternalStore} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';
import type {CharacterTarget} from '../../shared/document';

/** Subscribes a component to the character of a {@link CharacterTarget} (project or wizard draft). */
export function useCharacterSpec(target: CharacterTarget): CharacterSpec {
  return useSyncExternalStore(target.subscribe, target.getSpec, target.getSpec);
}
