import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {PackConfig, RigDefinition} from '@csg/parts-schema';
import {canonicalJson} from './canonical-json.js';
import {buildClipManifest} from './clips-manifest.js';
import type {BuiltClipInput} from './clips-manifest.js';
import {buildPartManifest, sha256Hex} from './manifest.js';
import type {BuiltPartInput} from './manifest.js';

/** A part to emit: manifest inputs plus the optional thumbnail bytes are not handled here. */
export type EmitPart = BuiltPartInput;
/** A clip to emit. */
export type EmitClip = BuiltClipInput;

/** One file written by {@link emitPack}. */
export interface EmittedFile {
  /** Path relative to the pack folder, forward slashes. */
  path: string;
  sha256: string;
}

/** Result of {@link emitPack}. */
export interface EmitResult {
  packDir: string;
  /** Every file under the pack folder that emit owns, sorted by path. */
  files: EmittedFile[];
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/**
 * Writes `<outRoot>/<packId>/{parts/<id>.glb, clips/<id>.glb, manifest.json, clips.json,
 * retired-ids.json}` (REQ-AST-013, 014). Output is deterministic: sorted entries, canonical
 * JSON, no timestamps. GLBs not in the build are removed. `clips.json` is written only when
 * there are clips. `retiredIds` replaces `retired-ids.json`; when omitted an existing file is
 * kept, else an empty list is written.
 */
export async function emitPack(args: {
  outRoot: string;
  config: PackConfig;
  rig: RigDefinition;
  parts: readonly EmitPart[];
  clips: readonly EmitClip[];
  retiredIds?: readonly string[];
}): Promise<EmitResult> {
  const {config} = args;
  const manifest = buildPartManifest({
    config,
    rig: args.rig,
    parts: args.parts,
  });
  const clipManifest =
    args.clips.length > 0 || config.clips.length > 0
      ? buildClipManifest({config, clips: args.clips})
      : undefined;

  const packDir = join(args.outRoot, config.packId);
  const files: EmittedFile[] = [];
  const write = async (rel: string, data: Uint8Array | string) => {
    await mkdir(join(packDir, rel, '..'), {recursive: true});
    await writeFile(join(packDir, rel), data);
    files.push({path: rel, sha256: sha256Hex(data)});
  };

  for (const [dir, items] of [
    ['parts', args.parts],
    ['clips', args.clips],
  ] as const) {
    const keep = new Set(items.map(item => `${item.id}.glb`));
    for (const name of await listFiles(join(packDir, dir))) {
      if (name.endsWith('.glb') && !keep.has(name)) {
        await rm(join(packDir, dir, name));
      }
    }
    for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      await write(`${dir}/${item.id}.glb`, item.bytes);
    }
  }

  await write('manifest.json', canonicalJson(manifest));
  if (clipManifest !== undefined) {
    await write('clips.json', canonicalJson(clipManifest));
  } else {
    await rm(join(packDir, 'clips.json'), {force: true});
  }

  let retired: string | undefined;
  if (args.retiredIds !== undefined) {
    retired = canonicalJson({
      format: 'sprite-retired-ids',
      version: 1,
      ids: [...new Set(args.retiredIds)].sort(),
    });
  } else {
    try {
      retired = await readFile(join(packDir, 'retired-ids.json'), 'utf8');
    } catch {
      retired = canonicalJson({
        format: 'sprite-retired-ids',
        version: 1,
        ids: [],
      });
    }
  }
  await write('retired-ids.json', retired);

  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return {packDir, files};
}
