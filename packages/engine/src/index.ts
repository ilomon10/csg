import {Object3D} from 'three';

/**
 * Creates an empty named scene node. Placeholder for the real scene assembly.
 *
 * @param name Node name.
 * @returns A new `Object3D` with the given name.
 */
export function createNamedNode(name: string): Object3D {
  const node = new Object3D();
  node.name = name;
  return node;
}
