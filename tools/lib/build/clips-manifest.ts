import {clipManifestSchema} from '@csg/parts-schema';
import type {ClipEntry, ClipManifest, PackConfig} from '@csg/parts-schema';
import {ManifestBuildError, sha256Hex} from './manifest.js';
import type {BuiltClipInput} from './types.js';

export type {BuiltClipInput} from './types.js';

/** Pack-relative GLB path of a clip. */
export function clipFilePath(id: string): string {
  return `clips/${id}.glb`;
}

/**
 * Builds `clips.json` content (spec 004 ClipEntry): authored fields from the pack config,
 * computed `file`, `rig`, `sha256`, `durationSec`, `hasRootMotion`, `skeletonGroup` from the
 * outputs. Clips are sorted by id. Validates with `clipManifestSchema`.
 */
export function buildClipManifest(args: {
  config: PackConfig;
  clips: readonly BuiltClipInput[];
}): ClipManifest {
  const {config} = args;
  const built = new Map(args.clips.map(clip => [clip.id, clip]));
  if (built.size !== args.clips.length) {
    throw new ManifestBuildError(
      'AST_MANIFEST_DUPLICATE',
      'duplicate built clip id',
    );
  }
  const authored = new Map(config.clips.map(clip => [clip.id, clip]));
  for (const id of [...authored.keys()].sort()) {
    if (!built.has(id)) {
      throw new ManifestBuildError(
        'AST_MANIFEST_MISSING',
        `clip "${id}" has no built output`,
      );
    }
  }
  for (const id of [...built.keys()].sort()) {
    if (!authored.has(id)) {
      throw new ManifestBuildError(
        'AST_MANIFEST_UNKNOWN',
        `built clip "${id}" is not in pack.config.json`,
      );
    }
  }
  const clips = [...authored.keys()].sort().map((id): ClipEntry => {
    const cfg = authored.get(id)!;
    const out = built.get(id)!;
    return {
      id,
      name: cfg.name,
      category: cfg.category,
      file: clipFilePath(id),
      sourceName: cfg.match.animation,
      rig: config.rig,
      durationSec: out.durationSec,
      loop: cfg.loop,
      defaultFrameCount: cfg.defaultFrameCount,
      hasRootMotion: out.hasRootMotion,
      inPlaceVariant: cfg.inPlaceVariant,
      tags: cfg.tags,
      license: cfg.license,
      sha256: sha256Hex(out.bytes),
      skeletonGroup: out.skeletonGroup,
    };
  });
  const manifest = {
    format: 'sprite-clips-manifest' as const,
    version: 1 as const,
    packId: config.packId,
    name: config.name,
    license: config.license,
    clips,
  };
  const parsed = clipManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ManifestBuildError(
      'AST_MANIFEST_INVALID',
      parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}
