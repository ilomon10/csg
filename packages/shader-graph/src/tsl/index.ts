import type {Vector3} from 'three';
import type {SocketType} from '../index';

/** Subpath `@csg/shader-graph/tsl`: graph to TSL compiler (may import three). */
export const TSL_COMPILER_VERSION = 0;

/** Placeholder signature proving the subpath may reference three types. */
export type CompiledVec3Default = (type: SocketType) => Vector3;
