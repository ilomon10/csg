/**
 * `_REGION` to `regionId` conversion (spec 011 REQ-AST-028).
 */
import {BufferAttribute, InterleavedBufferAttribute} from 'three';
import type {BufferGeometry, Mesh, Object3D} from 'three';

/** Name of the Float32 vertex attribute the shaders read (REQ-AST-028). */
export const REGION_ATTRIBUTE = 'regionId';

/** Name three's `GLTFLoader` gives the file's `_REGION` attribute (it lowercases custom names). */
export const SOURCE_REGION_ATTRIBUTE = '_region';

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/** Raw (non-normalized) integer value of component 0 of vertex `index`. */
function rawX(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  index: number,
): number {
  if (attribute instanceof InterleavedBufferAttribute) {
    const data = attribute.data;
    return data.array[index * data.stride + attribute.offset] ?? 0;
  }
  return attribute.array[index * attribute.itemSize] ?? 0;
}

function convertGeometry(geometry: BufferGeometry): boolean {
  if (geometry.getAttribute(REGION_ATTRIBUTE) !== undefined) return true;
  const source = geometry.getAttribute(SOURCE_REGION_ATTRIBUTE) as
    BufferAttribute | InterleavedBufferAttribute | undefined;
  if (source === undefined) return false;
  const values = new Float32Array(source.count);
  for (let i = 0; i < source.count; i++) values[i] = rawX(source, i);
  geometry.setAttribute(REGION_ATTRIBUTE, new BufferAttribute(values, 1));
  geometry.deleteAttribute(SOURCE_REGION_ATTRIBUTE);
  return true;
}

/**
 * Converts `_region` to a single-component Float32 `regionId` with the same integer values on
 * every mesh under `root`, and drops `_region` (REQ-AST-028). Idempotent: a geometry that
 * already has `regionId` counts as converted.
 *
 * @param root Parsed glTF scene of a body part.
 * @returns `false` when there is no mesh or some mesh has neither attribute (the caller
 *   reports `region-missing`); geometries converted before the failure stay converted.
 */
export function convertRegionAttribute(root: Object3D): boolean {
  const geometries = new Set<BufferGeometry>();
  root.traverse(object => {
    if (isMesh(object)) geometries.add(object.geometry);
  });
  if (geometries.size === 0) return false;
  let ok = true;
  for (const geometry of geometries) ok = convertGeometry(geometry) && ok;
  return ok;
}
