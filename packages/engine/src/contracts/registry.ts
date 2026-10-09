/**
 * Asset registry contracts (architecture 3.6, spec 004 Data & contracts, spec 011).
 * Type-only. User-asset methods throw `Error('not implemented (M5)')` in M1.
 */
import type {AnimationClip, Group} from 'three';
import type {
  AssetLicense,
  AssetRef,
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
  ClipEntry,
  ClipManifest,
  ClipRef,
  PartEntry,
  PartManifest,
  RigDefinition,
  RigId,
  SkeletonGroupId,
  SlotId,
  StyleDefinition,
} from '@csg/parts-schema';
import type {RestPose} from '../retarget/types';
import type {EngineError, Result} from './errors';

/** A registered part with its ref and origin. */
export type PartEntryView = PartEntry & {
  readonly ref: AssetRef;
  readonly source: 'builtin' | 'user';
};

/** A registered clip with its ref and origin. */
export type ClipEntryView = ClipEntry & {
  readonly ref: ClipRef;
  readonly source: 'builtin' | 'user';
};

/**
 * Reason a part does not fit a character: rules (a)-(c) of REQ-CMP-008 and
 * (d) style, (e) species of REQ-CMP-048.
 */
export type IncompatibleReason =
  'rig' | 'body' | 'body-type' | 'style' | 'species';

/** The (style, species) of a character, as compatibility rules (d)/(e) read it (REQ-CMP-048). */
export type CharacterKind = Pick<CharacterSpec, 'style' | 'species'>;

/** A (style, species) pair (REQ-CMP-043/045). */
export type StyleCombo = readonly [CharacterStyle, CharacterSpecies];

/** Result of {@link CompatibilityCheck}. */
export type Compatibility =
  | {readonly ok: true}
  | {readonly ok: false; readonly reason: IncompatibleReason};

/**
 * Compatibility of a part with a body (REQ-CMP-008) and, when `character` is
 * given, with the character's style and species (REQ-CMP-048 rules (d), (e),
 * checked after (a)-(c)). A skinned part whose `skeletonGroup` differs from
 * the character skeleton group is NOT incompatible on that basis
 * (REQ-CMP-037): each mesh keeps its own inverse bind matrices.
 */
export type CompatibilityCheck = (
  part: PartEntry,
  body: PartEntry,
  character?: CharacterKind,
) => Compatibility;

/** A part GLB loaded by the registry; internals are three.js objects. */
export interface LoadedPart {
  readonly ref: AssetRef;
  readonly entry: PartEntry;
}

/**
 * Engine-internal view of a loaded part: the parsed scene (skinned meshes with
 * their own `boneInverses`, body `regionId` attribute already converted,
 * REQ-AST-028) and the rig it belongs to.
 */
export interface LoadedPartInternal extends LoadedPart {
  readonly rig: RigDefinition;
  /** Parsed scene; owned by the registry cache, cloned by attach functions. */
  readonly scene: Group;
}

/**
 * A loaded clip. Carries its source rest pose so the player can retarget it
 * (REQ-ANM-021/023).
 */
export interface LoadedClip {
  readonly ref: ClipRef;
  readonly entry: ClipEntry;
  readonly durationSec: number;
  /** The animation named `entry.sourceName` in the clip GLB. */
  readonly clip: AnimationClip;
  readonly rig: RigDefinition;
  /** Rest pose of `rig.skeletonGroups[entry.skeletonGroup]`. */
  readonly source: RestPose;
}

/** Registry of bundled and user assets (architecture 3.6). */
export interface AssetRegistry {
  /** Registers a bundled part manifest; GLBs load from `baseUrl`. */
  registerPack(manifest: PartManifest, baseUrl: string): void;
  /** Registers a bundled clip manifest (REQ-ANM-001). Refs are `builtin:<packId>/<clipId>`. */
  registerClips(manifest: ClipManifest, baseUrl: string): void;
  /** Spec 008; throws `Error('not implemented (M5)')` in M1. */
  registerUserAsset(record: unknown): void;
  /** Spec 008; throws `Error('not implemented (M5)')` in M1. */
  unregisterUserAsset(id: string): void;
  /** Lists parts, optionally filtered by slot and rig. */
  list(filter?: {slot?: SlotId; rig?: RigId}): PartEntryView[];
  /** Lists clips (REQ-ANM-002): same rig, any skeleton group, is listed. */
  listClips(filter?: {rig?: RigId}): ClipEntryView[];
  /** Loads a part; failures return `CMP_PART_LOAD_FAILED`, never throw. */
  resolve(ref: AssetRef): Promise<Result<LoadedPart, EngineError>>;
  /** Loads a clip (REQ-ANM-021/022); failures return `ANM_CLIP_LOAD_FAILED`, never throw. */
  resolveClip(ref: ClipRef): Promise<Result<LoadedClip, EngineError>>;
  /** License of a registered part or clip. */
  licenseOf(ref: AssetRef | ClipRef): AssetLicense;
  /** Rig of a registered part or clip, or `undefined` when unknown. */
  rigOf(ref: AssetRef | ClipRef): RigDefinition | undefined;
  /**
   * Registers the style data files of the loaded packs
   * (`presets/styles/<style>.json`, spec 002 REQ-ANA-024). A later file for
   * the same style replaces the earlier one. The first call turns on content
   * gating of {@link availableStyleCombos} (REQ-CMP-045 condition 2).
   */
  registerStyles(defs: readonly StyleDefinition[]): void;
  /**
   * The (style, species) pairs that are available: in
   * `SUPPORTED_STYLE_COMBOS` and provided by the loaded content
   * (`availableStyleCombos` of `@csg/parts-schema`, REQ-CMP-043/045). Before
   * the first {@link registerStyles} call no content is known and the result
   * is `SUPPORTED_STYLE_COMBOS` unchanged. Deterministic: supported-list order.
   */
  availableStyleCombos(): readonly StyleCombo[];
}

/**
 * Converts the rest pose of one skeleton group of a rig into the retarget
 * `RestPose` (pure, cached per rig and group). Unknown group: `AST_RIG_MISMATCH`.
 */
export type RestPoseOf = (
  rig: RigDefinition,
  groupId: SkeletonGroupId,
) => Result<RestPose, EngineError>;

/**
 * The skeleton group that builds a character (REQ-CMP-037): body
 * `characterSkeletonGroup`, else its `skeletonGroup`, else
 * `rig.defaultSkeletonGroup`.
 */
export type CharacterSkeletonGroupOf = (
  body: PartEntry,
  rig: RigDefinition,
) => SkeletonGroupId;
