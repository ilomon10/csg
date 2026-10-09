/**
 * Diff-based character assembly (spec 001 REQ-CMP-002, REQ-CMP-007,
 * REQ-CMP-011/012, REQ-CMP-013/015, REQ-CMP-033, REQ-CMP-037,
 * REQ-CMP-043/048; spec 002 REQ-ANA-006, REQ-ANA-011; spec 004
 * REQ-ANM-013/014/023). Framework-agnostic and renderer-free: it owns a three
 * `Group` that a renderer adds to its scene, so it runs in Node tests.
 *
 * Materials are owned per assembly (M3-05): every attached clone gets a
 * material built by this assembly from the part's original material
 * ({@link createPartMaterials}); the registry's cached part scenes are never
 * re-materialed, so two renderers on one registry keep their own tints.
 */
import {Group} from 'three';
import type {Color} from 'three';
import type {UniformNode} from 'three/webgpu';
import {TINT_SLOTS, V1_SLOT_IDS} from '@csg/parts-schema';
import type {
  AnatomyParams,
  AssetRef,
  CharacterSpec,
  ClipRef,
  HexColor,
  PartEntry,
  PartSelection,
  PartSocket,
  SlotId,
  SlotRegistry,
  TintSlot,
} from '@csg/parts-schema';
import {resolveRenderPair} from '../catalog/resolve-render-pair';
import type {RenderPair} from '../catalog/resolve-render-pair';
import {SUPPORTED_STYLE_COMBOS} from '../catalog/supported-style-combos';
import {createAnatomyBinding} from '../anatomy/binding';
import {createClipPlayer} from '../animation/clip-player';
import {inPlaceVariantRef} from '../animation/root-motion';
import type {AnatomyBinding} from '../contracts/anatomy';
import type {
  ClipPlayer,
  PoseContext,
  RootMotionMode,
} from '../contracts/animation';
import type {
  AttachedPart,
  BodySkeleton,
  TintUniforms,
} from '../contracts/composition';
import type {EngineError, Result} from '../contracts/errors';
import type {
  ClipEntryView,
  LoadedClip,
  LoadedPartInternal,
  StyleCombo,
} from '../contracts/registry';
import {partIdFor} from '../pipeline/part-ids';
import type {PartIdRegistry} from '../pipeline/part-ids';
import {PART_ID_USER_DATA} from '../pipeline/toon-material';
import {characterSkeletonGroupOf, restPoseOf} from '../registry/rest-pose';
import {attachSkinnedPart} from './attach-skinned-part';
import {attachStaticPart} from './attach-static-part';
import {createBodySkeleton} from './body-skeleton';
import {evaluatePose} from './evaluate-pose';
import {computeHides, createRegionMask} from './region-mask';
import {
  createPartMaterials,
  createTintUniform,
  createTintUniforms,
  setTint,
} from './tint-material';
import type {PartMaterials, TintMaterialOptions} from './tint-material';

/** Name of {@link CharacterAssembly.root}. */
export const CHARACTER_ROOT_NAME = 'character';

/**
 * Error code of a call on a disposed assembly or renderer, including a call that
 * was in flight when `dispose()` ran (its result is dropped and nothing it built
 * stays attached).
 */
export const ENGINE_DISPOSED = 'ENGINE_DISPOSED';

/** The registry calls the assembly needs (an `EngineAssetRegistry` fits). */
export interface AssemblyRegistry {
  /** Loads a part with its parsed scene; never throws. */
  resolve(ref: AssetRef): Promise<Result<LoadedPartInternal, EngineError>>;
  /** Loads a clip; never throws. */
  resolveClip(ref: ClipRef): Promise<Result<LoadedClip, EngineError>>;
  /** Registered clip entry (for `inPlaceVariant`), or `undefined`. */
  clipEntry(ref: ClipRef): ClipEntryView | undefined;
  /**
   * Available (style, species) pairs (REQ-CMP-043/045; `EngineAssetRegistry`
   * has it). Omitted: `SUPPORTED_STYLE_COMBOS`.
   */
  availableStyleCombos?(): readonly StyleCombo[];
}

/**
 * Why an equipped part is not drawn although it stays in the spec:
 * `hair` (another part hides `hair`, REQ-CMP-012), `occupied` (another part's
 * `alsoOccupies` lists the slot, REQ-CMP-007), `style` / `species` (the part
 * does not fit the rendered pair, REQ-CMP-048 rules (d)/(e), REQ-CMP-043).
 */
export interface HiddenSlot {
  readonly reason: 'hair' | 'occupied' | 'style' | 'species';
  /** The slot whose part hides or occupies this one (`hair`, `occupied`). */
  readonly by?: SlotId;
}

/** Options of {@link createCharacterAssembly}. */
export interface CharacterAssemblyOptions {
  /** Where parts and clips come from. */
  readonly registry: AssemblyRegistry;
  /**
   * Slot registry, for `defaultSocket` of static parts whose manifest entry and
   * selection carry no socket (spec 001 SlotDefinition), and for the slot
   * order of part IDs (REQ-PIX-014). Default order: {@link V1_SLOT_IDS}.
   */
  readonly slots?: SlotRegistry;
  /**
   * Pixel-pipeline materials (spec 003): passed to `applyTintMaterial`, so
   * every part, static props included, gets toon materials bound to the
   * renderer's binder. Omitted = the unlit M1 materials.
   */
  readonly material?: TintMaterialOptions;
}

/** One attached part of the current character. */
export interface AssembledPart {
  /** Slot key (`body` for the body). */
  readonly slot: SlotId;
  /** The selection it was built from. */
  readonly selection: PartSelection;
  /** The loaded part (registry-owned scene). */
  readonly part: LoadedPartInternal;
  /** The attachment in the character. */
  readonly attached: AttachedPart;
}

/**
 * A character assembled from a {@link CharacterSpec}. Mutated only by
 * {@link CharacterAssembly.setCharacter} and {@link CharacterAssembly.setClip},
 * which are serialized (each call diffs against the last applied state).
 */
export interface CharacterAssembly {
  /** Container added to the scene; the body skeleton root is its child. */
  readonly root: Group;
  /** Current character skeleton, or `null` before the first successful spec. */
  readonly body: BodySkeleton | null;
  /** Anatomy binding of {@link CharacterAssembly.body}. */
  readonly anatomy: AnatomyBinding | null;
  /** Clip player bound to {@link CharacterAssembly.body}; replaced on body change. */
  readonly player: ClipPlayer | null;
  /** Last successfully applied spec. */
  readonly spec: CharacterSpec | null;
  /**
   * One color uniform per tint slot, shared by every part (REQ-CMP-013) that
   * has no override for that slot (REQ-CMP-015).
   */
  readonly tints: TintUniforms;
  /**
   * The (style, species) pair the character renders with (REQ-CMP-043): the
   * stored pair when available, else the fallback with `fallback: true`.
   * `null` before the first successful spec.
   */
  readonly renderPair: RenderPair | null;
  /**
   * Equipped slots that are not drawn and why (REQ-CMP-007/012/048). Their
   * parts stay attached and in the spec; their `hides` do not apply.
   */
  readonly hidden: ReadonlyMap<SlotId, HiddenSlot>;
  /** Hidden-body-region mask uniform (REQ-CMP-011). */
  readonly regionMask: UniformNode<'float', number>;
  /** Attached parts by slot, the body under `body`. */
  readonly parts: ReadonlyMap<SlotId, AssembledPart>;
  /**
   * Part ID per attached slot (REQ-PIX-014): body = 1, then the slot registry
   * order ({@link partIdFor}); never load order. Every object of a part's
   * attachment carries it as `userData.partId` (`PART_ID_USER_DATA`).
   */
  readonly partIds: ReadonlyMap<SlotId, number>;
  /** Duration in seconds of the clip the player holds, or `null` without a clip. */
  readonly clipDurationSec: number | null;
  /**
   * Event log for tests and diagnostics: `body:rebuild:<group>`,
   * `clip-cache:invalidate:<group>`, `part:attach:<slot>`,
   * `part:detach:<slot>`, `tint:<slot>`, `tint-override:<slot>:<tintSlot>`,
   * `clip:<ref>`, `materials:<unlit|toon>`.
   */
  readonly log: readonly string[];
  /**
   * Applies only the differences from the previous spec (REQ-CMP-033): tint
   * change → uniform update (a per-part override value too; adding or
   * removing an override slot rebuilds that part's materials only, REQ-CMP-015);
   * part change → load and rebind that part only;
   * body change → full rebuild (new skeleton from the body's
   * `characterSkeletonGroup`, REQ-CMP-037, and a new clip player, which drops
   * the retarget cache of the old group). Anatomy changes only update the
   * parameters read by {@link CharacterAssembly.evaluate} (REQ-ANA-011).
   *
   * Every load happens before anything changes: on any failure the result is
   * `ok: false` and the previous character is untouched (AC-CMP-033.2). A spec
   * without a body yields `CMP_BODY_MISSING` (AC-CMP-002.2); a part whose
   * `slot` differs from its slot key yields `CMP_SLOT_MISMATCH` (REQ-CMP-003).
   * On a body change the selected clip is retargeted onto the new skeleton
   * before the commit; if that fails, the retarget error is returned (with
   * `details.reason: 'retarget'`) and the previous character is kept. After
   * {@link CharacterAssembly.dispose} (also when it runs while this call is
   * loading) the result is {@link ENGINE_DISPOSED}; it never throws for that.
   */
  setCharacter(spec: CharacterSpec): Promise<Result<void, EngineError>>;
  /**
   * Selects the clip to play (`null` clears it). With `in-place` (default),
   * a clip with an `inPlaceVariant` is replaced by that variant before it
   * reaches the player (REQ-ANM-014); otherwise the player strips root motion
   * (REQ-ANM-013). Load failures return `ANM_CLIP_LOAD_FAILED` and a clip that
   * cannot be retargeted returns the player's retarget error; both keep the
   * previous clip (REQ-ANM-022). The selection survives body changes. After
   * {@link CharacterAssembly.dispose} the result is {@link ENGINE_DISPOSED}.
   */
  setClip(
    ref: ClipRef | null,
    rootMotion?: RootMotionMode,
  ): Promise<Result<void, EngineError>>;
  /** Poses the character at an absolute time ({@link evaluatePose}); no-op without a body. */
  evaluate(timeSec: number): void;
  /**
   * Switches every part between the M1 unlit materials (`undefined`) and the
   * pixel-pipeline toon materials (spec 003). Only this assembly's materials
   * change. Parts attached later use the same options.
   *
   * @param options Toon binding, or `undefined` for unlit materials.
   */
  setMaterialOptions(options: TintMaterialOptions | undefined): void;
  /** Detaches everything and disposes the materials this assembly built. */
  dispose(): void;
}

/** Materials of one (slot, part) of the assembly, shared while re-attached (body rebuild). */
interface MaterialSet {
  readonly materials: PartMaterials;
  count: number;
  /** Override uniform per overridden tint slot (REQ-CMP-015). */
  readonly own: Map<TintSlot, UniformNode<'color', Color>>;
  /** Sorted overridden slots the materials were built for. */
  overrideKey: string;
}

/** Default tints before the first spec (overwritten by every spec). */
const NEUTRAL = '#ffffff';

const IDENTITY_OFFSET: PartSocket['offset'] = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
};

function failure(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): {ok: false; error: EngineError} {
  return {
    ok: false,
    error: details === undefined ? {code, message} : {code, message, details},
  };
}

function disposedFailure(call: string): {ok: false; error: EngineError} {
  return failure(
    ENGINE_DISPOSED,
    `${call}: the character assembly is disposed`,
  );
}

function sameSocket(a: PartSocket | undefined, b: PartSocket | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Default slot order of part IDs: the v1 slots in display order. */
const DEFAULT_PART_ID_REGISTRY: PartIdRegistry = {
  slots: V1_SLOT_IDS.map((id, order) => ({id, order})),
};

/**
 * Part IDs of `slots` (REQ-PIX-014): registry order through {@link partIdFor};
 * slots the registry does not know (custom data) follow after every known
 * slot, sorted by id. A function of the slot set only, never of load order.
 */
function partIdsOf(
  slots: readonly SlotId[],
  registry: PartIdRegistry,
): Map<SlotId, number> {
  const known = new Set(registry.slots.map(s => s.id));
  const unknown = slots.filter(s => !known.has(s)).sort();
  let maxOrder = -1;
  for (const s of registry.slots) maxOrder = Math.max(maxOrder, s.order);
  const extended: PartIdRegistry =
    unknown.length === 0
      ? registry
      : {
          slots: [
            ...registry.slots,
            ...unknown.map((id, i) => ({id, order: maxOrder + 1 + i})),
          ],
        };
  const out = new Map<SlotId, number>();
  for (const slot of slots) out.set(slot, partIdFor(slot, extended));
  return out;
}

/**
 * REQ-CMP-048 rules (d) and (e) of a part against the rendered pair: `null`
 * when it fits, else the first failing rule.
 */
function pairFit(
  entry: PartEntry,
  pair: RenderPair,
): 'style' | 'species' | null {
  const styles = entry.styles ?? [];
  if (styles.length > 0 && !styles.includes(pair.style)) return 'style';
  const species = entry.species ?? [];
  if (species.length > 0 && !species.includes(pair.species)) return 'species';
  return null;
}

/** Slot keys of a spec's non-body parts, sorted (deterministic order). */
function slotKeys(spec: CharacterSpec): SlotId[] {
  return Object.keys(spec.parts)
    .filter(slot => slot !== 'body')
    .sort();
}

interface PoseState {
  body: BodySkeleton;
  player: ClipPlayer;
  anatomy: AnatomyBinding;
  props: AttachedPart[];
  params: AnatomyParams;
}

/**
 * Creates an empty character assembly. Call
 * {@link CharacterAssembly.setCharacter} to build the character.
 *
 * @param options Registry and optional slot registry.
 * @returns The assembly.
 */
export function createCharacterAssembly(
  options: CharacterAssemblyOptions,
): CharacterAssembly {
  const {registry} = options;
  const root = new Group();
  root.name = CHARACTER_ROOT_NAME;
  const initialTints = Object.fromEntries(
    TINT_SLOTS.map(slot => [slot, NEUTRAL]),
  ) as Record<(typeof TINT_SLOTS)[number], string>;
  const tints = createTintUniforms(initialTints);
  const regionMask = createRegionMask(0);
  const log: string[] = [];
  const parts = new Map<SlotId, AssembledPart>();
  const partIds = new Map<SlotId, number>();
  const idRegistry: PartIdRegistry = options.slots ?? DEFAULT_PART_ID_REGISTRY;
  let materialOptions = options.material;
  /** Material sets by `slot`+`ref`, with their attachment count. */
  const materialSets = new Map<string, MaterialSet>();
  const hidden = new Map<SlotId, HiddenSlot>();
  let renderPair: RenderPair | null = null;
  let pose: PoseState | null = null;
  let spec: CharacterSpec | null = null;
  let clip: {loaded: LoadedClip; rootMotion: RootMotionMode} | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const setKey = (slot: SlotId, part: LoadedPartInternal): string =>
    `${slot}\u0000${part.ref}`;

  /** Overridden tint slots of a selection, sorted (REQ-CMP-015). */
  const overridesOf = (selection: PartSelection): TintSlot[] =>
    TINT_SLOTS.filter(t => selection.tints?.[t] !== undefined);

  /** Uniforms of a set: its own override uniforms, else the shared ones. */
  const uniformsOf = (own: MaterialSet['own']): TintUniforms => {
    const out = {} as Record<TintSlot, TintUniforms[TintSlot]>;
    for (const t of TINT_SLOTS) out[t] = own.get(t) ?? tints[t];
    return out;
  };

  /** Gets (or builds) the material set of a slot's part; counts the use. */
  const acquire = (
    slot: SlotId,
    selection: PartSelection,
    part: LoadedPartInternal,
  ): MaterialSet => {
    const key = setKey(slot, part);
    const known = materialSets.get(key);
    if (known !== undefined) {
      known.count++;
      return known;
    }
    const own = new Map<TintSlot, UniformNode<'color', Color>>();
    const overridden = overridesOf(selection);
    for (const t of overridden) {
      own.set(t, createTintUniform(selection.tints?.[t] as HexColor));
    }
    const set: MaterialSet = {
      materials: createPartMaterials(part, {
        tintSlots: part.entry.tintSlots,
        uniforms: uniformsOf(own),
        mask: regionMask,
        material: materialOptions,
      }),
      count: 1,
      own,
      overrideKey: overridden.join(','),
    };
    materialSets.set(key, set);
    return set;
  };

  const releaseSet = (slot: SlotId, part: LoadedPartInternal): void => {
    const key = setKey(slot, part);
    const known = materialSets.get(key);
    if (known === undefined) return;
    known.count--;
    if (known.count <= 0) {
      materialSets.delete(key);
      known.materials.dispose();
    }
  };

  /**
   * Applies a selection's tint overrides to its material set (REQ-CMP-015):
   * values in place; a changed set of overridden slots rebuilds the set's
   * materials (that part only).
   */
  const applyOverrides = (
    slot: SlotId,
    selection: PartSelection,
    part: LoadedPartInternal,
  ): void => {
    const set = materialSets.get(setKey(slot, part));
    if (set === undefined) return;
    const overridden = overridesOf(selection);
    const key = overridden.join(',');
    for (const t of overridden) {
      const hex = selection.tints?.[t] as HexColor;
      const u = set.own.get(t);
      if (u === undefined) {
        set.own.set(t, createTintUniform(hex));
      } else if (`#${u.value.getHexString()}` !== hex) {
        u.value.set(hex);
        log.push(`tint-override:${slot}:${t}`);
      }
    }
    for (const t of [...set.own.keys()]) {
      if (!overridden.includes(t)) set.own.delete(t);
    }
    if (key !== set.overrideKey) {
      set.overrideKey = key;
      set.materials.rebuild({uniforms: uniformsOf(set.own)});
      log.push(`tint-override:${slot}:rebuild`);
    }
  };

  const socketOf = (
    slot: SlotId,
    selection: PartSelection,
    part: LoadedPartInternal,
  ): PartSocket | undefined => {
    if (selection.socket !== undefined) return selection.socket;
    if (part.entry.socket !== undefined) return part.entry.socket;
    const bone = options.slots?.slots.find(s => s.id === slot)?.defaultSocket;
    return bone === undefined ? undefined : {bone, offset: IDENTITY_OFFSET};
  };

  /** Tints and attaches one part to `body`; on failure nothing stays attached. */
  const attach = (
    slot: SlotId,
    selection: PartSelection,
    part: LoadedPartInternal,
    body: BodySkeleton,
  ): Result<AssembledPart, EngineError> => {
    if (part.entry.kind === 'static') {
      const socket = socketOf(slot, selection, part);
      if (socket === undefined) {
        return failure(
          'CMP_SLOT_MISMATCH',
          `static part "${part.ref}" has no socket for slot "${slot}"`,
          {ref: part.ref, slot, reason: 'no-socket'},
        );
      }
      const set = acquire(slot, selection, part);
      const attached = attachStaticPart(part, body, socket, {
        materials: set.materials,
      });
      if (!attached.ok) {
        releaseSet(slot, part);
        return attached;
      }
      return {
        ok: true,
        value: {slot, selection, part, attached: attached.value},
      };
    }
    const set = acquire(slot, selection, part);
    const attached = attachSkinnedPart(part, body, {materials: set.materials});
    if (!attached.ok) {
      releaseSet(slot, part);
      return attached;
    }
    return {ok: true, value: {slot, selection, part, attached: attached.value}};
  };

  const detach = (assembled: AssembledPart): void => {
    assembled.attached.dispose();
    releaseSet(assembled.slot, assembled.part);
  };

  const rebuildProps = (state: PoseState): void => {
    state.props.length = 0;
    for (const assembled of parts.values()) {
      if (assembled.part.entry.kind === 'static') {
        state.props.push(assembled.attached);
      }
    }
  };

  /** Writes `userData.partId` on every object of every attachment (REQ-PIX-014). */
  const assignPartIds = (): void => {
    partIds.clear();
    for (const [slot, id] of partIdsOf([...parts.keys()], idRegistry)) {
      partIds.set(slot, id);
      parts.get(slot)?.attached.object.traverse(o => {
        o.userData[PART_ID_USER_DATA] = id;
      });
    }
  };

  /**
   * Slots not drawn because their part does not fit the rendered pair
   * (REQ-CMP-048 (d)/(e)) or another drawn part's `alsoOccupies` lists them
   * (REQ-CMP-007). Parts are visited in part-ID order (body first, then the
   * slot registry order), so a part hidden earlier occupies nothing.
   */
  const excludedSlots = (pair: RenderPair): void => {
    hidden.clear();
    const order = [...parts.keys()].sort(
      (a, b) => (partIds.get(a) ?? 0) - (partIds.get(b) ?? 0),
    );
    for (const slot of order) {
      if (slot === 'body') continue;
      const fit = pairFit((parts.get(slot) as AssembledPart).part.entry, pair);
      if (fit !== null) hidden.set(slot, {reason: fit});
    }
    for (const slot of order) {
      if (hidden.has(slot)) continue;
      const entry = (parts.get(slot) as AssembledPart).part.entry;
      for (const other of entry.alsoOccupies ?? []) {
        if (other === slot || other === 'body' || !parts.has(other)) continue;
        if (!hidden.has(other))
          hidden.set(other, {reason: 'occupied', by: slot});
      }
    }
  };

  const applyLooks = (next: CharacterSpec, pair: RenderPair): void => {
    for (const slot of TINT_SLOTS) {
      if (spec === null || spec.tints[slot] !== next.tints[slot]) {
        setTint(tints, slot, next.tints[slot]);
        log.push(`tint:${slot}`);
      }
    }
    for (const [slot, assembled] of parts) {
      const selection =
        slot === 'body' ? next.body : (next.parts[slot] ?? assembled.selection);
      applyOverrides(slot, selection, assembled.part);
      if (selection !== assembled.selection) {
        parts.set(slot, {...assembled, selection});
      }
    }
    excludedSlots(pair);
    const hides = computeHides(
      [...parts.values()]
        .filter(p => !hidden.has(p.slot))
        .map(p => ({slot: p.slot, entry: p.part.entry})),
    );
    regionMask.value = hides.mask;
    for (const slot of hides.hiddenSlots) {
      if (parts.has(slot) && !hidden.has(slot)) {
        const by = [...parts.values()].find(
          p =>
            p.slot !== slot &&
            !hidden.has(p.slot) &&
            p.part.entry.hides.includes('hair'),
        );
        hidden.set(
          slot,
          by === undefined ? {reason: 'hair'} : {reason: 'hair', by: by.slot},
        );
      }
    }
    for (const [slot, assembled] of parts) {
      assembled.attached.setVisible(!hidden.has(slot));
    }
  };

  const loadAll = async (
    wanted: ReadonlyArray<{slot: SlotId; selection: PartSelection}>,
  ): Promise<Result<Map<SlotId, LoadedPartInternal>, EngineError>> => {
    const results = await Promise.all(
      wanted.map(w => registry.resolve(w.selection.ref)),
    );
    const out = new Map<SlotId, LoadedPartInternal>();
    for (let i = 0; i < wanted.length; i++) {
      const {slot, selection} = wanted[i] as (typeof wanted)[number];
      const result = results[i] as (typeof results)[number];
      if (!result.ok) return result;
      if (result.value.entry.slot !== slot) {
        return failure(
          'CMP_SLOT_MISMATCH',
          `part "${selection.ref}" is a "${result.value.entry.slot}" part, not "${slot}"`,
          {ref: selection.ref, slot, partSlot: result.value.entry.slot},
        );
      }
      out.set(slot, result.value);
    }
    return {ok: true, value: out};
  };

  const rebuild = async (
    next: CharacterSpec,
  ): Promise<Result<void, EngineError>> => {
    const wanted = [
      {slot: 'body' as SlotId, selection: next.body},
      ...slotKeys(next).map(slot => ({
        slot,
        selection: next.parts[slot] as PartSelection,
      })),
    ];
    const loaded = await loadAll(wanted);
    // dispose() may have run while loading: build nothing (M1-31 M2).
    if (disposed) return disposedFailure('setCharacter');
    if (!loaded.ok) return loaded;
    const bodyPart = loaded.value.get('body') as LoadedPartInternal;
    const rig = bodyPart.rig;
    const group = characterSkeletonGroupOf(bodyPart.entry, rig);
    const rest = restPoseOf(rig, group);
    if (!rest.ok) return rest;
    const body = createBodySkeleton(rig, rest.value);
    if (!body.ok) return body;
    const anatomy = createAnatomyBinding(rig, body.value);
    if (!anatomy.ok) {
      body.value.skeleton.dispose();
      return anatomy;
    }

    const built: AssembledPart[] = [];
    for (const {slot, selection} of wanted) {
      const part = loaded.value.get(slot) as LoadedPartInternal;
      const assembled = attach(slot, selection, part, body.value);
      if (!assembled.ok) {
        for (const done of built) detach(done);
        body.value.skeleton.dispose();
        return assembled;
      }
      built.push(assembled.value);
    }

    // The selected clip must retarget onto the new skeleton before anything is
    // committed; otherwise the previous character (and clip) stays (REQ-ANM-022).
    const player = createClipPlayer(body.value);
    if (clip !== null) {
      const bound = player.setClip(clip.loaded, clip.rootMotion);
      if (!bound.ok) {
        for (const done of built) detach(done);
        body.value.skeleton.dispose();
        return failure(
          bound.error.code,
          `clip "${clip.loaded.ref}" cannot be retargeted onto "${body.value.skeletonGroupId}": ${bound.error.message}`,
          {
            ...bound.error.details,
            ref: clip.loaded.ref,
            skeletonGroup: body.value.skeletonGroupId,
            reason: 'retarget',
          },
        );
      }
    }

    // Commit: drop the old character, then install the new one.
    const old = pose;
    for (const assembled of parts.values()) detach(assembled);
    parts.clear();
    if (old !== null) {
      old.body.root.removeFromParent();
      old.player.setClip(null, 'in-place');
      old.body.skeleton.dispose();
      log.push(`clip-cache:invalidate:${old.body.skeletonGroupId}`);
    }
    for (const assembled of built) parts.set(assembled.slot, assembled);
    root.add(body.value.root);
    pose = {
      body: body.value,
      player,
      anatomy: anatomy.value,
      props: [],
      params: next.anatomy,
    };
    rebuildProps(pose);
    log.push(`body:rebuild:${body.value.skeletonGroupId}`);
    for (const assembled of built) log.push(`part:attach:${assembled.slot}`);
    return {ok: true, value: undefined};
  };

  const update = async (
    state: PoseState,
    prev: CharacterSpec,
    next: CharacterSpec,
  ): Promise<Result<void, EngineError>> => {
    const changed: Array<{slot: SlotId; selection: PartSelection}> = [];
    for (const slot of slotKeys(next)) {
      const selection = next.parts[slot] as PartSelection;
      const before = prev.parts[slot];
      if (
        before === undefined ||
        before.ref !== selection.ref ||
        !sameSocket(before.socket, selection.socket)
      ) {
        changed.push({slot, selection});
      }
    }
    const removed = slotKeys(prev).filter(
      slot => next.parts[slot] === undefined,
    );
    if (changed.length > 0 || removed.length > 0) {
      const loaded = await loadAll(changed);
      if (disposed) return disposedFailure('setCharacter');
      if (!loaded.ok) return loaded;
      const built: AssembledPart[] = [];
      for (const {slot, selection} of changed) {
        const part = loaded.value.get(slot) as LoadedPartInternal;
        const assembled = attach(slot, selection, part, state.body);
        if (!assembled.ok) {
          for (const done of built) detach(done);
          return assembled;
        }
        built.push(assembled.value);
      }
      for (const slot of [...removed, ...changed.map(c => c.slot)]) {
        const old = parts.get(slot);
        if (old === undefined) continue;
        detach(old);
        parts.delete(slot);
        log.push(`part:detach:${slot}`);
      }
      for (const assembled of built) {
        parts.set(assembled.slot, assembled);
        log.push(`part:attach:${assembled.slot}`);
      }
      rebuildProps(state);
    }
    state.params = next.anatomy;
    return {ok: true, value: undefined};
  };

  const assembly: CharacterAssembly = {
    root,
    get body() {
      return pose?.body ?? null;
    },
    get anatomy() {
      return pose?.anatomy ?? null;
    },
    get player() {
      return pose?.player ?? null;
    },
    get spec() {
      return spec;
    },
    get renderPair() {
      return renderPair;
    },
    hidden,
    tints,
    regionMask,
    parts,
    partIds,
    log,
    get clipDurationSec() {
      return clip?.loaded.durationSec ?? null;
    },

    setCharacter(next) {
      return serialize(async () => {
        if (disposed) return disposedFailure('setCharacter');
        const bodyRef = (next as Partial<CharacterSpec>).body?.ref;
        if (bodyRef === undefined || bodyRef === '') {
          return failure('CMP_BODY_MISSING', 'the character has no body');
        }
        const result =
          pose === null || spec === null || spec.body.ref !== bodyRef
            ? await rebuild(next)
            : await update(pose, spec, next);
        if (!result.ok) return result;
        const pair = resolveRenderPair(
          next,
          registry.availableStyleCombos?.() ?? SUPPORTED_STYLE_COMBOS,
        );
        assignPartIds();
        applyLooks(next, pair);
        renderPair = pair;
        spec = next;
        return result;
      });
    },

    setClip(ref, rootMotion = 'in-place') {
      return serialize(async (): Promise<Result<void, EngineError>> => {
        if (disposed) return disposedFailure('setClip');
        if (ref === null) {
          clip = null;
          pose?.player.setClip(null, rootMotion);
          log.push('clip:none');
          return {ok: true, value: undefined};
        }
        const entry = registry.clipEntry(ref);
        const variant =
          rootMotion === 'in-place' && entry !== undefined
            ? inPlaceVariantRef(ref, entry)
            : undefined;
        const loaded = await registry.resolveClip(variant ?? ref);
        if (disposed) return disposedFailure('setClip');
        if (!loaded.ok) return loaded;
        if (pose !== null) {
          const bound = pose.player.setClip(loaded.value, rootMotion);
          if (!bound.ok) {
            return failure(
              bound.error.code,
              `clip "${loaded.value.ref}" cannot be retargeted onto "${pose.body.skeletonGroupId}": ${bound.error.message}`,
              {
                ...bound.error.details,
                ref: loaded.value.ref,
                skeletonGroup: pose.body.skeletonGroupId,
                reason: 'retarget',
              },
            );
          }
        }
        clip = {loaded: loaded.value, rootMotion};
        log.push(`clip:${loaded.value.ref}`);
        return {ok: true, value: undefined};
      });
    },

    evaluate(timeSec) {
      if (pose !== null) evaluatePose(pose as PoseContext, timeSec);
    },

    setMaterialOptions(next) {
      if (disposed) return;
      materialOptions = next;
      for (const set of materialSets.values()) {
        set.materials.rebuild({material: materialOptions});
      }
      log.push(`materials:${next === undefined ? 'unlit' : 'toon'}`);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const assembled of parts.values()) detach(assembled);
      parts.clear();
      partIds.clear();
      hidden.clear();
      for (const set of materialSets.values()) set.materials.dispose();
      materialSets.clear();
      renderPair = null;
      if (pose !== null) {
        pose.body.root.removeFromParent();
        pose.body.skeleton.dispose();
        pose = null;
      }
      clip = null;
      spec = null;
    },
  };
  return assembly;
}
