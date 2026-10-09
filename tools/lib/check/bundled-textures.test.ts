import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {describe, expect, it} from 'vitest';
import {listBuiltPacks} from '../build/sole-io.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const packsDir = join(repoRoot, 'assets/packs');

describe('bundled texture sizes (REQ-AST-010)', () => {
  it('AC-AST-010.3: every image of a bundled body is at most 512 px and every image of any other part or prop at most 256 px', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({'meshopt.decoder': MeshoptDecoder});
    const packs = await listBuiltPacks(packsDir);
    expect(packs.length).toBeGreaterThan(0);
    const tooBig: string[] = [];
    let images = 0;
    for (const packId of packs) {
      const manifest = JSON.parse(
        readFileSync(join(packsDir, packId, 'manifest.json'), 'utf8'),
      ) as {parts?: Array<{id: string; slot: string; file: string}>};
      for (const part of manifest.parts ?? []) {
        const file = join(packsDir, packId, part.file);
        if (!existsSync(file)) continue;
        const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
        const limit = part.slot === 'body' ? 512 : 256;
        for (const texture of doc.getRoot().listTextures()) {
          images++;
          const size = texture.getSize();
          const longest = size === null ? 0 : Math.max(...size);
          if (longest > limit) {
            tooBig.push(`${packId}/${part.id}: ${longest}px > ${limit}px`);
          }
        }
      }
    }
    expect(images).toBeGreaterThan(0);
    expect(tooBig).toEqual([]);
  });
});
