/**
 * Test-only builder of tiny texture-free GLB files (one triangle, optional `_REGION`
 * attribute, optional translation animations). Used by the loader and registry tests in Node
 * until the committed M1-10 fixtures land; never imported by runtime code.
 */

/** Options of {@link buildTestGlb}. */
export interface TestGlbOptions {
  /** `_REGION` values for the 3 vertices (UNSIGNED_BYTE); omitted means no attribute. */
  readonly region?: readonly [number, number, number];
  /** Names of 1 s translation animations on node 0. */
  readonly animations?: readonly string[];
  /** Written to `extensionsUsed`. */
  readonly extensions?: readonly string[];
  /** URI of an external buffer (a second, empty-use buffer) to exercise the URL policy. */
  readonly externalBufferUri?: string;
}

function pad4(length: number): number {
  return (length + 3) & ~3;
}

/**
 * Builds a valid glTF 2.0 binary.
 *
 * @param options Content switches.
 * @returns The GLB bytes.
 */
export function buildTestGlb(options: TestGlbOptions = {}): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let offset = 0;
  const add = (bytes: Uint8Array): number => {
    const padded = new Uint8Array(pad4(bytes.byteLength));
    padded.set(bytes);
    chunks.push(padded);
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.byteLength,
    });
    offset += padded.byteLength;
    return bufferViews.length - 1;
  };
  const f32 = (values: number[]) =>
    new Uint8Array(new Float32Array(values).buffer);

  const positions = add(f32([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  accessors.push({
    bufferView: positions,
    componentType: 5126,
    count: 3,
    type: 'VEC3',
    min: [0, 0, 0],
    max: [1, 1, 0],
  });
  const attributes: Record<string, number> = {POSITION: 0};
  if (options.region !== undefined) {
    const view = add(new Uint8Array(options.region));
    accessors.push({
      bufferView: view,
      componentType: 5121,
      count: 3,
      type: 'SCALAR',
    });
    attributes['_REGION'] = accessors.length - 1;
  }

  const animations = (options.animations ?? []).map(name => {
    const input = add(f32([0, 1]));
    accessors.push({
      bufferView: input,
      componentType: 5126,
      count: 2,
      type: 'SCALAR',
      min: [0],
      max: [1],
    });
    const inputIndex = accessors.length - 1;
    const output = add(f32([0, 0, 0, 0, 1, 0]));
    accessors.push({
      bufferView: output,
      componentType: 5126,
      count: 2,
      type: 'VEC3',
    });
    return {
      name,
      samplers: [{input: inputIndex, output: accessors.length - 1}],
      channels: [{sampler: 0, target: {node: 0, path: 'translation'}}],
    };
  });

  const buffers: Array<Record<string, unknown>> = [{byteLength: offset}];
  if (options.externalBufferUri !== undefined) {
    buffers.push({uri: options.externalBufferUri, byteLength: 4});
    bufferViews.push({buffer: 1, byteOffset: 0, byteLength: 4});
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: 1,
      type: 'SCALAR',
    });
    attributes['_EXTRA'] = accessors.length - 1;
  }

  const json: Record<string, unknown> = {
    asset: {version: '2.0', generator: 'csg-test-glb'},
    scene: 0,
    scenes: [{nodes: [0]}],
    nodes: [{name: 'part', mesh: 0}],
    meshes: [{primitives: [{attributes}]}],
    accessors,
    bufferViews,
    buffers,
  };
  if (animations.length > 0) json['animations'] = animations;
  if (options.extensions !== undefined && options.extensions.length > 0) {
    json['extensionsUsed'] = [...options.extensions];
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLength + 8 + offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  let cursor = 20 + jsonLength;
  view.setUint32(cursor, offset, true);
  view.setUint32(cursor + 4, 0x004e4942, true);
  cursor += 8;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out.buffer;
}

/** A fetch stub over an in-memory file map that counts calls (AC-ANM-021.2). */
export interface TestFetch {
  /** The fetch function to inject. */
  readonly fetch: (url: string) => Promise<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  /** URLs requested so far, in order. */
  readonly requests: string[];
}

/**
 * Creates a fetch stub: known URLs return their bytes (a copy), unknown URLs HTTP 404.
 *
 * @param files URL to GLB bytes.
 * @returns The stub and its request log.
 */
export function createTestFetch(
  files: ReadonlyMap<string, ArrayBuffer>,
): TestFetch {
  const requests: string[] = [];
  return {
    requests,
    fetch: url => {
      requests.push(url);
      const bytes = files.get(url);
      return Promise.resolve(
        bytes === undefined
          ? {
              ok: false,
              status: 404,
              arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
            }
          : {
              ok: true,
              status: 200,
              arrayBuffer: () => Promise.resolve(bytes.slice(0)),
            },
      );
    },
  };
}
