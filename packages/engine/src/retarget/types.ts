/**
 * Structural types of the retarget contract (REQ-ANM-023, m1-plan section 2.6). Plain number
 * tuples and typed arrays only, so the module stays free of three.js, the DOM
 * and every other `@csg/*` package.
 */

/** A 3D vector `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];

/** A quaternion in glTF order `[x, y, z, w]`. */
export type Quat = readonly [number, number, number, number];

/** Local rest transform of one joint. */
export interface JointRestTRS {
  /** Joint (bone) name, unique within its rest pose. */
  readonly name: string;
  /** Parent joint name, or `null` for a root joint. */
  readonly parent: string | null;
  /** Local rest translation. */
  readonly translation: Vec3;
  /** Local rest rotation. */
  readonly rotation: Quat;
  /** Local rest scale. */
  readonly scale: Vec3;
}

/**
 * Rest pose of one skeleton group; joints are ordered parent-before-child.
 * Structurally equal to the parts-schema skeleton group joints plus an id.
 */
export interface RestPose {
  /** Skeleton group id. */
  readonly id: string;
  /** Joints, parent-before-child. */
  readonly joints: readonly JointRestTRS[];
}

/** Options of {@link createRetargetPlan}. */
export interface RetargetOptions {
  /** Hip (pelvis) bone (rig `socketBones.pelvis`); translation retargeted in delta form. */
  readonly hipBone: string;
  /** Root bone (rig `rootBone`); translation (root motion) retargeted in delta form. */
  readonly rootBone: string;
  /** Foot bones (rig `anatomyBones.feet`); the lowest one defines the leg length. */
  readonly footBones: readonly string[];
  /** Target bone to source bone. Default: identity by name (M5 bone maps plug in here). */
  readonly boneMap?: ReadonlyMap<string, string>;
}

/** Error code of a failed plan: hip, root or foot bone missing, or leg length at most 1e-6. */
export type RetargetErrorCode = 'AST_RIG_MISMATCH';

/** Error payload of a failed {@link RetargetResult}. */
export interface RetargetError {
  /** Spec-prefixed error code. */
  readonly code: RetargetErrorCode;
  /** Human-readable explanation. */
  readonly message: string;
  /** Bone names that were required but not found (sorted, unique). */
  readonly missing: string[];
}

/** Result of an expected-failure operation of the retarget module. */
export type RetargetResult<T> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly error: RetargetError};

/** One mapped bone of a {@link RetargetPlan}. */
export interface RetargetBone {
  /** Target bone name. */
  readonly target: string;
  /** Source bone name. */
  readonly source: string;
  /** `q_tRest · q_sRest⁻¹`, applied as `preRotation · q_s`. */
  readonly preRotation: Quat;
}

/** Precomputed retarget data for one (source, target) rest-pose pair. */
export interface RetargetPlan {
  /** Source skeleton group id. */
  readonly sourceId: string;
  /** Target skeleton group id. */
  readonly targetId: string;
  /** `k = L_t / L_s`, L = rest pelvis height above the lowest foot joint. */
  readonly legLengthRatio: number;
  /** Mapped bones, sorted by target name (code-unit order). */
  readonly bones: readonly RetargetBone[];
  /** Hip bone pair with both local rest translations. */
  readonly hip: {
    readonly target: string;
    readonly source: string;
    readonly sourceRest: Vec3;
    readonly targetRest: Vec3;
  };
  /** Root bone pair with both local rest translations. */
  readonly root: {
    readonly target: string;
    readonly source: string;
    readonly sourceRest: Vec3;
    readonly targetRest: Vec3;
  };
  /** Same id, or every pre-rotation and k equal to identity within 1e-7. */
  readonly identity: boolean;
}

/** Animated property of a track. */
export type TrackPath = 'rotation' | 'translation' | 'scale';

/** One keyframe track in plain arrays. */
export interface TrackData {
  /** Bone name. */
  readonly bone: string;
  /** Animated property. */
  readonly path: TrackPath;
  /** Key times in seconds. */
  readonly times: Float32Array;
  /** Values: 4 per key for rotation, 3 per key otherwise. */
  readonly values: Float32Array;
}

/** A source track that {@link retargetTracks} did not carry over. */
export interface RetargetDrop {
  /** Source bone name of the dropped track. */
  readonly bone: string;
  /** Path of the dropped track. */
  readonly path: TrackPath;
  /**
   * Why it was dropped. `'scale'` is reserved: REQ-ANM-023 passes scale tracks
   * through, so the current implementation never reports it.
   */
  readonly reason: 'unmapped' | 'translation' | 'scale';
}
