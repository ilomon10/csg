import {
  ANATOMY_PARAM_KEYS,
  applyBodyShape as applyBodyShapeFactors,
  ANATOMY_PARAM_SPECS,
  TINT_SLOTS,
  createDefaultCharacterSpec,
  defaultAnatomy,
  quantizeAnatomy,
} from '@csg/parts-schema';
import type {
  AnatomyParams,
  AssetRef,
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
  PartSelection,
  TintSlot,
} from '@csg/parts-schema';
import type {CommandCatalog, CommandPart} from './catalog-port';
import {mulberry32} from './prng';
import type {EasyCategoryId} from '@csg/parts-schema';
import type {HistoryContext} from './types';

/** Why a part left the character as a side effect of a command. */
export interface RemovedPart {
  readonly slot: string;
  readonly ref: AssetRef;
  /** Compatibility reason (`body`, `style`, ...) or `occupied` (REQ-CMP-007). */
  readonly reason: string;
}

/** Result of running a character command. */
export interface CharacterEdit {
  readonly spec: CharacterSpec;
  readonly removed: readonly RemovedPart[];
}

/** One composer or anatomy edit; a pure function of the spec (REQ-CMP-028). */
export interface CharacterCommand {
  readonly label: string;
  readonly feature: 'composer' | 'anatomy';
  readonly context?: HistoryContext;
  readonly coalesceKey?: string;
  /** Returns null when nothing would change. */
  run(spec: CharacterSpec, catalog: CommandCatalog): CharacterEdit | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function findPart(
  catalog: CommandCatalog,
  ref: AssetRef,
): CommandPart | undefined {
  return catalog.parts.find(part => part.ref === ref);
}

function withParts(
  spec: CharacterSpec,
  parts: Record<string, PartSelection>,
): CharacterSpec {
  return {...spec, parts};
}

/**
 * Drops every non-body part that is no longer compatible with `spec` (REQ-CMP-010,
 * REQ-CMP-048). Refs the catalog does not know (user parts) are kept.
 */
function dropIncompatible(
  spec: CharacterSpec,
  catalog: CommandCatalog,
): CharacterEdit {
  const kept: Record<string, PartSelection> = {};
  const removed: RemovedPart[] = [];
  for (const [slot, selection] of Object.entries(spec.parts)) {
    const part = findPart(catalog, selection.ref);
    const verdict = part ? catalog.compatible(part, spec) : {ok: true as const};
    if (verdict.ok) kept[slot] = selection;
    else removed.push({slot, ref: selection.ref, reason: verdict.reason});
  }
  return {
    spec: removed.length === 0 ? spec : withParts(spec, kept),
    removed,
  };
}

/** Equip a part (REQ-CMP-004, 007). Refuses unknown, mismatched and incompatible parts. */
export function equipPart(slot: string, ref: AssetRef): CharacterCommand {
  return {
    label: 'Equip part',
    feature: 'composer',
    run(spec, catalog) {
      const part = findPart(catalog, ref);
      if (!part || part.slot !== slot) return null;
      if (slot === 'body') return setBody(ref).run(spec, catalog);
      if (spec.parts[slot]?.ref === ref) return null;
      if (!catalog.compatible(part, spec).ok) return null;
      const parts: Record<string, PartSelection> = {...spec.parts};
      const removed: RemovedPart[] = [];
      const drop = (target: string, reason: string) => {
        const old = parts[target];
        if (old) removed.push({slot: target, ref: old.ref, reason});
        delete parts[target];
      };
      // The new part clears the slots it also occupies.
      for (const other of part.alsoOccupies ?? []) drop(other, 'occupied');
      // A part elsewhere that also occupies this slot loses to the latest choice.
      for (const [other, selection] of Object.entries(parts)) {
        if (other === slot) continue;
        const equipped = findPart(catalog, selection.ref);
        if (equipped?.alsoOccupies?.includes(slot)) drop(other, 'occupied');
      }
      parts[slot] = {ref};
      return {spec: withParts(spec, parts), removed};
    },
  };
}

/** Like {@link equipPart} with a label naming the part, for use where the catalog is at hand. */
export function equipPartNamed(
  slot: string,
  ref: AssetRef,
  name: string,
): CharacterCommand {
  return {...equipPart(slot, ref), label: `Equip ${name}`};
}

/** Clear a non-body slot (REQ-CMP-005). */
export function clearSlot(slot: string): CharacterCommand {
  return {
    label: `Clear ${slot}`,
    feature: 'composer',
    run(spec) {
      if (slot === 'body' || !(slot in spec.parts)) return null;
      const parts = {...spec.parts};
      delete parts[slot];
      return {spec: withParts(spec, parts), removed: []};
    },
  };
}

/** Change the body; parts that no longer fit are removed in the same command (REQ-CMP-010). */
export function setBody(ref: AssetRef): CharacterCommand {
  return {
    label: 'Change body',
    feature: 'composer',
    run(spec, catalog) {
      const part = findPart(catalog, ref);
      if (!part || part.slot !== 'body' || spec.body.ref === ref) return null;
      return dropIncompatible({...spec, body: {ref}}, catalog);
    },
  };
}

/** Set one character-wide tint (REQ-CMP-013). Coalesces by slot for color drags (REQ-CMP-017). */
export function setTint(
  slot: TintSlot,
  hex: string,
  options: {coalesceKey?: string; context?: HistoryContext} = {},
): CharacterCommand {
  return {
    label: `Change ${slot} color`,
    feature: 'composer',
    coalesceKey: options.coalesceKey ?? `tint:${slot}`,
    ...(options.context ? {context: options.context} : {}),
    run(spec) {
      if (!HEX.test(hex)) return null;
      const value = hex.toLowerCase();
      if (spec.tints[slot] === value) return null;
      return {
        spec: {...spec, tints: {...spec.tints, [slot]: value}},
        removed: [],
      };
    },
  };
}

/** Per-part tint override (REQ-CMP-015). */
export function setPartTint(
  slot: string,
  tintSlot: TintSlot,
  hex: string,
): CharacterCommand {
  return {
    label: `Change ${slot} ${tintSlot} color`,
    feature: 'composer',
    coalesceKey: `part-tint:${slot}:${tintSlot}`,
    run(spec) {
      const selection = spec.parts[slot];
      if (!selection || !HEX.test(hex)) return null;
      const value = hex.toLowerCase();
      if (selection.tints?.[tintSlot] === value) return null;
      const next: PartSelection = {
        ...selection,
        tints: {...selection.tints, [tintSlot]: value},
      };
      return {
        spec: withParts(spec, {...spec.parts, [slot]: next}),
        removed: [],
      };
    },
  };
}

function stylePresetValues(
  catalog: CommandCatalog,
  style: CharacterStyle,
): AnatomyParams | undefined {
  const id = catalog.styles.get(style)?.anatomyPreset;
  return id === undefined ? undefined : catalog.anatomyPresets.get(id)?.values;
}

/** Change style: applies the style's anatomy preset and drops misfits, one entry (REQ-CMP-042, 048). */
export function setStyle(style: CharacterStyle): CharacterCommand {
  return {
    label: `Style: ${style}`,
    feature: 'composer',
    run(spec, catalog) {
      if (spec.style === style) return null;
      const preset = stylePresetValues(catalog, style);
      const next: CharacterSpec = {
        ...spec,
        style,
        ...(preset ? {anatomy: {...preset}} : {}),
      };
      return dropIncompatible(next, catalog);
    },
  };
}

/** Change species; misfits are dropped (REQ-CMP-048). */
export function setSpecies(species: CharacterSpecies): CharacterCommand {
  return {
    label: `Species: ${species}`,
    feature: 'composer',
    run(spec, catalog) {
      if (spec.species === species) return null;
      return dropIncompatible({...spec, species}, catalog);
    },
  };
}

/** Apply a named anatomy preset to all nine values (REQ-ANA-013). */
export function applyAnatomyPreset(id: string): CharacterCommand {
  return {
    label: 'Apply anatomy preset',
    feature: 'anatomy',
    run(spec, catalog) {
      const preset = catalog.anatomyPresets.get(id);
      if (!preset) return null;
      return {spec: {...spec, anatomy: {...preset.values}}, removed: []};
    },
  };
}

function clampAnatomy(key: keyof AnatomyParams, value: number): number {
  const {min, max} = ANATOMY_PARAM_SPECS[key];
  return Math.min(max, Math.max(min, quantizeAnatomy(value)));
}

function anatomyBase(
  spec: CharacterSpec,
  catalog: CommandCatalog,
): AnatomyParams {
  return stylePresetValues(catalog, spec.style) ?? defaultAnatomy();
}

/** Apply a body-shape preset on top of the style's base proportions (REQ-ANA-023). */
export function applyBodyShape(id: string): CharacterCommand {
  return {
    label: 'Apply body shape',
    feature: 'anatomy',
    run(spec, catalog) {
      const shape = catalog.bodyShapes.find(entry => entry.id === id);
      if (!shape) return null;
      return {
        spec: {
          ...spec,
          anatomy: applyBodyShapeFactors(
            anatomyBase(spec, catalog),
            shape.factors,
          ),
        },
        removed: [],
      };
    },
  };
}

/** Reset one Easy category to the default character's values (REQ-UX-066). */
export function resetCategory(
  category: EasyCategoryId,
  label?: string,
): CharacterCommand {
  const name = label ?? category.charAt(0).toUpperCase() + category.slice(1);
  return {
    label: `Reset ${name}`,
    feature: 'composer',
    run(spec, catalog) {
      const def = catalog.easyCategories.find(entry => entry.id === category);
      if (!def) return null;
      const base = createDefaultCharacterSpec();
      const parts: Record<string, PartSelection> = {...spec.parts};
      let body = spec.body;
      for (const slot of def.slots) {
        if (slot === 'body') {
          body = base.body;
          continue;
        }
        const fallback = base.parts[slot];
        if (fallback) parts[slot] = fallback;
        else delete parts[slot];
      }
      const tints = {...spec.tints};
      for (const channel of def.tintChannels) {
        const key = channel as TintSlot;
        if (key in base.tints) tints[key] = base.tints[key];
      }
      const next: CharacterSpec = {
        ...spec,
        body,
        parts,
        tints,
        ...(def.anatomyPresets ? {anatomy: {...base.anatomy}} : {}),
      };
      return {spec: next, removed: []};
    },
  };
}

/** Replace the whole character: file load, preset apply (REQ-CMP-023, 027). */
export function replaceCharacter(
  next: CharacterSpec,
  label: string,
): CharacterCommand {
  return {
    label,
    feature: 'composer',
    run: () => ({spec: next, removed: []}),
  };
}

/** Which fields randomize may not touch (REQ-CMP-019, 046). */
export interface RandomizeLocks {
  readonly slots: ReadonlySet<string>;
  readonly tints: boolean;
  readonly anatomy: boolean;
  /** Style and species; locked by default in every new session (REQ-CMP-046). */
  readonly styleSpecies: boolean;
}

/** Locks of a fresh session: nothing locked except style and species. */
export function defaultLocks(): RandomizeLocks {
  return {slots: new Set(), tints: false, anatomy: false, styleSpecies: true};
}

/** What randomize reaches: everything, one Easy category, or explicit fields. */
export type RandomizeScope =
  | 'all'
  | {readonly category: EasyCategoryId}
  | {
      readonly fields: ReadonlyArray<
        'tints' | 'anatomy' | 'style' | `parts.${string}`
      >;
    };

/** Input of {@link randomize}. */
export interface RandomizeOptions {
  readonly scope: RandomizeScope;
  readonly locks: RandomizeLocks;
  /** uint32; stored in `CharacterSpec.seed`. Use `freshSeed()` for a reroll. */
  readonly seed: number;
}

/** Locks for `scope`: every field outside the scope counts as locked (REQ-UX-065). */
function effectiveLocks(
  options: RandomizeOptions,
  catalog: CommandCatalog,
): {locks: RandomizeLocks; bodyShapeOnly: boolean} {
  const {scope, locks} = options;
  if (scope === 'all') return {locks, bodyShapeOnly: false};
  const slotIds = catalog.slots.slots.map(slot => slot.id);
  if ('category' in scope) {
    const def = catalog.easyCategories.find(c => c.id === scope.category);
    const open = new Set(def?.slots ?? []);
    const channels = new Set(def?.tintChannels ?? []);
    return {
      locks: {
        slots: new Set(
          slotIds.filter(id => !open.has(id) || locks.slots.has(id)),
        ),
        // Tints are all-or-nothing in the lock model; a category narrows them below.
        tints: locks.tints || channels.size === 0,
        anatomy: locks.anatomy || !def?.anatomyPresets,
        styleSpecies: true,
      },
      bodyShapeOnly: def?.anatomyPresets === true,
    };
  }
  const fields = new Set<string>(scope.fields);
  return {
    locks: {
      slots: new Set(slotIds.filter(id => !fields.has(`parts.${id}`))),
      tints: !fields.has('tints'),
      anatomy: !fields.has('anatomy'),
      styleSpecies: !fields.has('style'),
    },
    bodyShapeOnly: false,
  };
}

/**
 * Randomize (REQ-CMP-018..020, 046, 047, REQ-ANA-026, REQ-UX-065). Deterministic for a
 * seed, catalog, locks and starting spec. Draw order: style pair (only when unlocked), body,
 * slots in registry order (empty-chance draw, then pick draw), tints, anatomy. Locked groups
 * consume no draws, so adding a lock group never shifts the sequence of the others.
 */
export function randomize(options: RandomizeOptions): CharacterCommand {
  const label =
    options.scope === 'all'
      ? 'Randomize'
      : 'category' in options.scope
        ? `Randomize ${options.scope.category}`
        : 'Randomize';
  return {
    label,
    feature: 'composer',
    run(spec, catalog) {
      const rng = mulberry32(options.seed);
      const {locks, bodyShapeOnly} = effectiveLocks(options, catalog);
      const {scope} = options;
      const category =
        typeof scope === 'object' && 'category' in scope
          ? catalog.easyCategories.find(c => c.id === scope.category)
          : undefined;
      let working: CharacterSpec = {...spec, seed: options.seed >>> 0};

      // 1. Style and species.
      if (!locks.styleSpecies && catalog.availableCombos.length > 0) {
        const pick =
          catalog.availableCombos[
            Math.floor(rng() * catalog.availableCombos.length)
          ];
        if (pick) {
          const [style, species] = pick;
          const preset = locks.anatomy
            ? undefined
            : stylePresetValues(catalog, style);
          working = {
            ...working,
            style,
            species,
            ...(preset ? {anatomy: {...preset}} : {}),
          };
        }
      }

      // 2. Body, only among bodies every locked part still fits.
      if (!locks.slots.has('body')) {
        const lockedParts = Object.entries(working.parts)
          .filter(([slot]) => locks.slots.has(slot))
          .map(([, selection]) => findPart(catalog, selection.ref))
          .filter((part): part is CommandPart => part !== undefined);
        const candidates = catalog.parts.filter(
          part =>
            part.slot === 'body' &&
            catalog.compatible(part, {...working, body: {ref: part.ref}}).ok &&
            lockedParts.every(
              locked =>
                catalog.compatible(locked, {...working, body: {ref: part.ref}})
                  .ok,
            ),
        );
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(rng() * candidates.length)];
          if (pick) working = {...working, body: {ref: pick.ref}};
        }
      }

      // 3. Non-body slots in registry order.
      const lockedOccupied = new Set<string>();
      for (const [slot, selection] of Object.entries(working.parts)) {
        if (!locks.slots.has(slot)) continue;
        for (const other of findPart(catalog, selection.ref)?.alsoOccupies ??
          [])
          lockedOccupied.add(other);
      }
      const parts: Record<string, PartSelection> = {};
      for (const [slot, selection] of Object.entries(working.parts)) {
        if (locks.slots.has(slot)) parts[slot] = selection;
      }
      const occupied = new Set(lockedOccupied);
      const slotDefs = [...catalog.slots.slots].sort(
        (a, b) => a.order - b.order,
      );
      for (const def of slotDefs) {
        if (def.required || locks.slots.has(def.id)) continue;
        if (occupied.has(def.id)) continue;
        const draft = {...working, parts};
        const candidates = catalog.parts.filter(
          part =>
            part.slot === def.id &&
            catalog.compatible(part, draft).ok &&
            (part.alsoOccupies ?? []).every(
              other => !locks.slots.has(other) || !(other in parts),
            ),
        );
        const emptyRoll = rng();
        if (candidates.length === 0 || emptyRoll < def.randomize.emptyChance) {
          continue;
        }
        const pick = candidates[Math.floor(rng() * candidates.length)];
        if (!pick) continue;
        for (const other of pick.alsoOccupies ?? []) {
          delete parts[other];
          occupied.add(other);
        }
        parts[def.id] = {ref: pick.ref};
      }
      working = withParts(working, parts);

      // 4. Tints from the swatch sets.
      if (!locks.tints) {
        const tints = {...working.tints};
        const open = category ? new Set(category.tintChannels) : undefined;
        for (const slot of TINT_SLOTS) {
          if (open && !open.has(slot)) continue;
          const pool = catalog.swatchSets
            .filter(set => set.channels.includes(slot))
            .flatMap(set => set.swatches.map(swatch => swatch.hex));
          if (pool.length === 0) continue;
          const hex = pool[Math.floor(rng() * pool.length)];
          if (hex) tints[slot] = hex.toLowerCase();
        }
        working = {...working, tints};
      }

      // 5. Anatomy.
      if (!locks.anatomy) {
        const base = anatomyBase(working, catalog);
        if (bodyShapeOnly) {
          const shape =
            catalog.bodyShapes[Math.floor(rng() * catalog.bodyShapes.length)];
          if (shape) {
            working = {
              ...working,
              anatomy: applyBodyShapeFactors(base, shape.factors),
            };
          }
        } else {
          const anatomy = {...working.anatomy};
          for (const key of ANATOMY_PARAM_KEYS) {
            const [lo, hi] = ANATOMY_PARAM_SPECS[key].randomize;
            anatomy[key] = clampAnatomy(
              key,
              base[key] * (lo + rng() * (hi - lo)),
            );
          }
          working = {...working, anatomy};
        }
      }

      return {spec: working, removed: []};
    },
  };
}
