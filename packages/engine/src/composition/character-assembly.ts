/**
 * Diff-based character assembly (spec 001 REQ-CMP-002, REQ-CMP-011/012,
 * REQ-CMP-013, REQ-CMP-033, REQ-CMP-037; spec 002 REQ-ANA-006, REQ-ANA-011;
 * spec 004 REQ-ANM-013/014/023). Framework-agnostic and renderer-free: it owns
 * a three `Group` that a renderer adds to its scene, so it runs in Node tests.
 */
import {Group} from 'three';
import type {UniformNode} from 'three/webgpu';
import {TINT_SLOTS} from '@csg/parts-schema';
import type {
  AnatomyParams,
  AssetRef,
  CharacterSpec,
  ClipRef,
  PartSelection,
  PartSocket,
  SlotId,
  SlotRegistry,
} from '@csg/parts-schema';
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
} from '../contracts/registry';
import {characterSkeletonGroupOf, restPoseOf} from '../registry/rest-pose';
import {attachSkinnedPart} from './attach-skinned-part';
import {attachStaticPart} from './attach-static-part';
import {createBodySkeleton} from './body-skeleton';
import {evaluatePose} from './evaluate-pose';
import {computeHides, createRegionMask} from './region-mask';
import {
  applyTintMaterial,
  createTintUniforms,
  restoreMaterials,
  setTint,
} from './tint-material';

/** Name of {@link CharacterAssembly.root}. */
export const CHARACTER_ROOT_NAME = 'character';

/** The registry calls the assembly needs (an `EngineAssetRegistry` fits). */
export interface AssemblyRegistry {
  /** Loads a part with its parsed scene; never throws. */
  resolve(ref: AssetRef): Promise<Result<LoadedPartInternal, EngineError>>;
  /** Loads a clip; never throws. */
  resolveClip(ref: ClipRef): Promise<Result<LoadedClip, EngineError>>;
  /** Registered clip entry (for `inPlaceVariant`), or `undefined`. */
  clipEntry(ref: ClipRef): ClipEntryView | undefined;
}

/** Options of {@link createCharacterAssembly}. */
export interface CharacterAssemblyOptions {
  /** Where parts and clips come from. */
  readonly registry: AssemblyRegistry;
  /**
   * Slot registry, for `defaultSocket` of static parts whose manifest entry and
   * selection carry no socket (spec 001 SlotDefinition).
   */
  readonly slots?: SlotRegistry;
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
  /** One color uniform per tint slot, shared by every part (REQ-CMP-013). */
  readonly tints: TintUniforms;
  /** Hidden-body-region mask uniform (REQ-CMP-011). */
  readonly regionMask: UniformNode<'float', number>;
  /** Attached parts by slot, the body under `body`. */
  readonly parts: ReadonlyMap<SlotId, AssembledPart>;
  /**
   * Event log for tests and diagnostics: `body:rebuild:<group>`,
   * `clip-cache:invalidate:<group>`, `part:attach:<slot>`,
   * `part:detach:<slot>`, `tint:<slot>`, `clip:<ref>`.
   */
  readonly log: readonly string[];
  /**
   * Applies only the differences from the previous spec (REQ-CMP-033): tint
   * change → uniform update; part change → load and rebind that part only;
   * body change → full rebuild (new skeleton from the body's
   * `characterSkeletonGroup`, REQ-CMP-037, and a new clip player, which drops
   * the retarget cache of the old group). Anatomy changes only update the
   * parameters read by {@link CharacterAssembly.evaluate} (REQ-ANA-011).
   *
   * Every load happens before anything changes: on any failure the result is
   * `ok: false` and the previous character is untouched (AC-CMP-033.2). A spec
   * without a body yields `CMP_BODY_MISSING` (AC-CMP-002.2); a part whose
   * `slot` differs from its slot key yields `CMP_SLOT_MISMATCH` (REQ-CMP-003).
   */
  setCharacter(spec: CharacterSpec): Promise<Result<void, EngineError>>;
  /**
   * Selects the clip to play (`null` clears it). With `in-place` (default),
   * a clip with an `inPlaceVariant` is replaced by that variant before it
   * reaches the player (REQ-ANM-014); otherwise the player strips root motion
   * (REQ-ANM-013). Load failures return `ANM_CLIP_LOAD_FAILED` and keep the
   * previous clip. The selection survives body changes.
   */
  setClip(
    ref: ClipRef | null,
    rootMotion?: RootMotionMode,
  ): Promise<Result<void, EngineError>>;
  /** Poses the character at an absolute time ({@link evaluatePose}); no-op without a body. */
  evaluate(timeSec: number): void;
  /** Detaches everything and restores the materials this assembly tinted. */
  dispose(): void;
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

function sameSocket(a: PartSocket | undefined, b: PartSocket | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
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
  /** Part scenes tinted by this assembly, with their attachment count. */
  const tinted = new Map<object, {part: LoadedPartInternal; count: number}>();
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

  const tintOnce = (part: LoadedPartInternal): void => {
    const known = tinted.get(part.scene);
    if (known !== undefined) {
      known.count++;
      return;
    }
    applyTintMaterial(part, part.entry.tintSlots, tints, regionMask);
    tinted.set(part.scene, {part, count: 1});
  };

  const untint = (part: LoadedPartInternal): void => {
    const known = tinted.get(part.scene);
    if (known === undefined) return;
    known.count--;
    if (known.count <= 0) {
      tinted.delete(part.scene);
      restoreMaterials(part.scene);
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
      tintOnce(part);
      const attached = attachStaticPart(part, body, socket);
      if (!attached.ok) {
        untint(part);
        return attached;
      }
      return {
        ok: true,
        value: {slot, selection, part, attached: attached.value},
      };
    }
    tintOnce(part);
    const attached = attachSkinnedPart(part, body);
    if (!attached.ok) {
      untint(part);
      return attached;
    }
    return {ok: true, value: {slot, selection, part, attached: attached.value}};
  };

  const detach = (assembled: AssembledPart): void => {
    assembled.attached.dispose();
    untint(assembled.part);
  };

  const rebuildProps = (state: PoseState): void => {
    state.props.length = 0;
    for (const assembled of parts.values()) {
      if (assembled.part.entry.kind === 'static') {
        state.props.push(assembled.attached);
      }
    }
  };

  const applyLooks = (next: CharacterSpec): void => {
    for (const slot of TINT_SLOTS) {
      if (spec === null || spec.tints[slot] !== next.tints[slot]) {
        setTint(tints, slot, next.tints[slot]);
        log.push(`tint:${slot}`);
      }
    }
    const hides = computeHides(
      [...parts.values()].map(p => ({slot: p.slot, entry: p.part.entry})),
    );
    regionMask.value = hides.mask;
    for (const [slot, assembled] of parts) {
      assembled.attached.setVisible(!hides.hiddenSlots.includes(slot));
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
    const player = createClipPlayer(body.value);
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
    if (clip !== null) player.setClip(clip.loaded, clip.rootMotion);
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
    tints,
    regionMask,
    parts,
    log,

    setCharacter(next) {
      return serialize(async () => {
        if (disposed) throw new Error('setCharacter: assembly is disposed');
        const bodyRef = (next as Partial<CharacterSpec>).body?.ref;
        if (bodyRef === undefined || bodyRef === '') {
          return failure('CMP_BODY_MISSING', 'the character has no body');
        }
        const result =
          pose === null || spec === null || spec.body.ref !== bodyRef
            ? await rebuild(next)
            : await update(pose, spec, next);
        if (!result.ok) return result;
        applyLooks(next);
        spec = next;
        return result;
      });
    },

    setClip(ref, rootMotion = 'in-place') {
      return serialize(async (): Promise<Result<void, EngineError>> => {
        if (disposed) throw new Error('setClip: assembly is disposed');
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
        if (!loaded.ok) return loaded;
        if (pose !== null) {
          pose.player.setClip(loaded.value, rootMotion);
          const last = pose.player.log[pose.player.log.length - 1] ?? '';
          if (last.startsWith('retarget:error:')) {
            return failure(
              last.slice('retarget:error:'.length),
              `clip "${loaded.value.ref}" cannot be retargeted onto "${pose.body.skeletonGroupId}"`,
              {ref: loaded.value.ref},
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

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const assembled of parts.values()) detach(assembled);
      parts.clear();
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
