import type {
  AnatomyParams,
  AssetRef,
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
} from '@csg/parts-schema';

/** The part fields the character commands read. The catalog's `CatalogPart` satisfies it. */
export interface CommandPart {
  readonly ref: AssetRef;
  readonly slot: string;
  readonly name: string;
  readonly alsoOccupies?: readonly string[] | undefined;
}

/**
 * The slice of the catalog (`shared/catalog`, C7) that character commands need. Commands
 * depend on this port, not on the catalog module, so they stay pure and testable in Node.
 */
export interface CommandCatalog {
  readonly slots: {
    readonly slots: ReadonlyArray<{
      readonly id: string;
      readonly order: number;
      readonly required: boolean;
      readonly randomize: {readonly emptyChance: number};
    }>;
  };
  readonly parts: readonly CommandPart[];
  readonly anatomyPresets: ReadonlyMap<
    string,
    {readonly values: AnatomyParams}
  >;
  readonly bodyShapes: ReadonlyArray<{
    readonly id: string;
    readonly factors: Partial<AnatomyParams>;
  }>;
  readonly styles: ReadonlyMap<
    CharacterStyle,
    {readonly anatomyPreset?: string | undefined}
  >;
  readonly easyCategories: ReadonlyArray<{
    readonly id: string;
    readonly slots: readonly string[];
    readonly tintChannels: readonly string[];
    readonly anatomyPresets: boolean;
  }>;
  readonly swatchSets: ReadonlyArray<{
    readonly channels: readonly string[];
    readonly swatches: ReadonlyArray<{readonly hex: string}>;
  }>;
  readonly availableCombos: ReadonlyArray<
    readonly [CharacterStyle, CharacterSpecies]
  >;
  /** REQ-CMP-008 and REQ-CMP-048 for `part` against the body, style and species of `spec`. */
  compatible(
    part: CommandPart,
    spec: CharacterSpec,
  ): {readonly ok: true} | {readonly ok: false; readonly reason: string};
}
