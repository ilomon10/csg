import type {CharacterSpec, EasyCategoryDef} from '@csg/parts-schema';
import type {CharacterCommand, CharacterTarget} from '../../../shared/document';
import type {EasyCategoryId} from '../../../shared/document';

/** Attribute value of the focus target of a category's swatch row (AC-UX-051.3). */
export const swatchFocusKey = (channel: string): string =>
  `easy.swatch.${channel}`;

/**
 * Wraps a target so every command it applies records the active Easy category and, for a tint,
 * the swatch to focus, so undo brings the user back to where the change was made (REQ-UX-024,
 * AC-UX-051.3). The wrapped target is otherwise the same object model: one shared history.
 */
export function withEasyContext(
  base: CharacterTarget,
  category: EasyCategoryId,
): CharacterTarget {
  return {
    getSpec: base.getSpec,
    subscribe: base.subscribe,
    apply(cmd: CharacterCommand) {
      const channel = cmd.coalesceKey?.startsWith('tint:')
        ? cmd.coalesceKey.slice('tint:'.length)
        : null;
      return base.apply({
        ...cmd,
        context: {
          ...cmd.context,
          easyCategory: category,
          ...(channel === null ? {} : {focusKey: swatchFocusKey(channel)}),
        },
      });
    },
  };
}

/** The tint channel whose swatch row is shown, given the most recent choice (REQ-UX-062). */
export function activeChannel(
  def: EasyCategoryDef,
  remembered: string | null,
): string | null {
  if (
    remembered !== null &&
    (def.tintChannels as readonly string[]).includes(remembered)
  ) {
    return remembered;
  }
  return def.tintChannels[0] ?? null;
}

/** Name of the equipped part of the first slot that has one, else null. */
export function equippedName(
  def: EasyCategoryDef,
  spec: CharacterSpec,
  nameOf: (ref: string) => string | undefined,
): string | null {
  for (const slot of def.slots) {
    const ref = slot === 'body' ? spec.body.ref : spec.parts[slot]?.ref;
    const name = ref === undefined ? undefined : nameOf(ref);
    if (name !== undefined) return name;
  }
  return null;
}
