/**
 * Test-only access to the committed engine fixtures (`packages/engine/test/fixtures`, M1-10)
 * for the composition tests. Parses GLBs with three's `GLTFLoader` directly (texture-free
 * fixtures parse in Node) and JSON with the `@csg/parts-schema` schemas. Never imported by
 * runtime code.
 */
import {readFileSync} from 'node:fs';
import type {Group, Object3D} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {partManifestSchema, rigDefinitionSchema} from '@csg/parts-schema';
import type {PartEntry, PartManifest, RigDefinition} from '@csg/parts-schema';
import type {LoadedPartInternal} from '../contracts/registry';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);

/** Reads a fixture file as bytes. */
export function readFixtureBytes(path: string): ArrayBuffer {
  const bytes = readFileSync(new URL(path, FIXTURES));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** The fixture rig `fixture-ue5-22`. */
export function loadFixtureRig(): RigDefinition {
  const text = new TextDecoder().decode(
    readFileSync(new URL('rigs/fixture-ue5-22.json', FIXTURES)),
  );
  return rigDefinitionSchema.parse(JSON.parse(text));
}

/** The fixture part manifest. */
export function loadFixtureManifest(): PartManifest {
  const text = new TextDecoder().decode(
    readFileSync(new URL('pack/manifest.json', FIXTURES)),
  );
  return partManifestSchema.parse(JSON.parse(text));
}

/**
 * Parses a fixture GLB. Nodes that are in no scene (the M1-10 generator currently leaves the
 * skinned mesh node out of the scene) are added to the scene so the mesh is reachable.
 */
export async function parseFixtureGlb(path: string): Promise<GLTF> {
  const gltf = await new GLTFLoader().parseAsync(readFixtureBytes(path), '');
  const nodes = (await gltf.parser.getDependencies('node')) as Object3D[];
  for (const node of nodes) {
    if (node.parent === null) gltf.scene.add(node);
  }
  return gltf;
}

/** Parses a fixture GLB as a {@link LoadedPartInternal}. */
export async function loadFixturePart(
  path: string,
  entry: PartEntry,
  rig: RigDefinition,
  ref = `builtin:fixture-pack/${entry.id}`,
): Promise<LoadedPartInternal> {
  const gltf = await parseFixtureGlb(path);
  const scene: Group = gltf.scene;
  return {ref, entry, rig, scene};
}

/** A part entry of the fixture manifest by id. */
export function fixtureEntry(manifest: PartManifest, id: string): PartEntry {
  const entry = manifest.parts.find(p => p.id === id);
  if (entry === undefined) throw new Error(`no fixture part "${id}"`);
  return entry;
}

interface GlbJson {
  readonly skins?: ReadonlyArray<{readonly inverseBindMatrices?: number}>;
  readonly accessors: ReadonlyArray<{
    readonly bufferView?: number;
    readonly byteOffset?: number;
    readonly count: number;
  }>;
  readonly bufferViews: ReadonlyArray<{
    readonly byteOffset?: number;
    readonly byteLength: number;
  }>;
}

/**
 * Raw float32 inverse bind matrices of skin 0 of a fixture GLB, read from the file bytes
 * (16 column-major floats per joint), independent of three's loader.
 */
export function readInverseBindMatrices(path: string): Float32Array[] {
  const buffer = readFixtureBytes(path);
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  ) as GlbJson;
  const binStart = 20 + jsonLength + 8;
  const accessorIndex = json.skins?.[0]?.inverseBindMatrices;
  if (accessorIndex === undefined) throw new Error(`${path}: no IBM accessor`);
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor?.bufferView ?? -1];
  if (accessor === undefined || bufferView === undefined) {
    throw new Error(`${path}: bad IBM accessor`);
  }
  const start =
    binStart + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out: Float32Array[] = [];
  for (let i = 0; i < accessor.count; i++) {
    out.push(
      new Float32Array(buffer.slice(start + i * 64, start + i * 64 + 64)),
    );
  }
  return out;
}
