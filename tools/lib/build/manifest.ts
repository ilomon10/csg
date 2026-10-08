import {createHash} from 'node:crypto';
import {partManifestSchema, validatePartsAgainstRig} from '@csg/parts-schema';
import type {
  PackConfig,
  PartEntry,
  PartManifest,
  RigDefinition,
} from '@csg/parts-schema';
import type {BuiltPartInput} from './types.js';

export type {BuiltPartInput} from './types.js';

/** Error raised when generated manifest data is inconsistent or fails its schema. */
export class ManifestBuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ManifestBuildError';
  }
}

/** Lowercase hex SHA-256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Pack-relative GLB path of a part. */
export function partFilePath(id: string): string {
  return `parts/${id}.glb`;
}

/**
 * Builds `manifest.json` content: authored fields from the pack config, computed fields
 * (`file`, `sha256`, `stats`, `skeletonGroup`, `thumbnail`) from the outputs, and a copy of the
 * rig (REQ-AST-013). Parts are sorted by id. Validates with `partManifestSchema` and
 * `validatePartsAgainstRig`; throws {@link ManifestBuildError} otherwise.
 */
export function buildPartManifest(args: {
  config: PackConfig;
  rig: RigDefinition;
  parts: readonly BuiltPartInput[];
}): PartManifest {
  const {config, rig} = args;
  if (rig.id !== config.rig) {
    throw new ManifestBuildError(
      'AST_MANIFEST_RIG',
      `pack "${config.packId}" declares rig "${config.rig}" but got rig "${rig.id}"`,
    );
  }
  const built = new Map(args.parts.map(part => [part.id, part]));
  if (built.size !== args.parts.length) {
    throw new ManifestBuildError(
      'AST_MANIFEST_DUPLICATE',
      'duplicate built part id',
    );
  }
  const authored = new Map(config.parts.map(part => [part.id, part]));
  for (const id of [...authored.keys()].sort()) {
    if (!built.has(id)) {
      throw new ManifestBuildError(
        'AST_MANIFEST_MISSING',
        `part "${id}" has no built output`,
      );
    }
  }
  for (const id of [...built.keys()].sort()) {
    if (!authored.has(id)) {
      throw new ManifestBuildError(
        'AST_MANIFEST_UNKNOWN',
        `built part "${id}" is not in pack.config.json`,
      );
    }
  }
  const parts = [...authored.keys()].sort().map((id): PartEntry => {
    const cfg = authored.get(id)!;
    const out = built.get(id)!;
    return {
      id,
      name: cfg.name,
      slot: cfg.slot,
      kind: out.kind,
      file: partFilePath(id),
      node: cfg.match.node,
      rig: out.kind === 'skinned' ? config.rig : undefined,
      skeletonGroup: out.kind === 'skinned' ? out.skeletonGroup : undefined,
      characterSkeletonGroup: cfg.characterSkeletonGroup,
      bodyType: cfg.bodyType,
      hides: [...cfg.hides],
      alsoOccupies: cfg.alsoOccupies,
      tintSlots: cfg.tintSlots,
      socket: cfg.socket,
      bodies: cfg.bodies,
      bodyTypes: cfg.bodyTypes,
      thumbnail: out.thumbnail,
      sha256: sha256Hex(out.bytes),
      stats: {triangles: out.triangles, textures: out.textures},
      tags: cfg.tags,
      license: cfg.license,
    };
  });
  const manifest = {
    format: 'sprite-parts-manifest' as const,
    version: 1 as const,
    packId: config.packId,
    name: config.name,
    license: config.license,
    rigs: [rig],
    parts,
  };
  const parsed = partManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ManifestBuildError(
      'AST_MANIFEST_INVALID',
      parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
  const rigCheck = validatePartsAgainstRig(parsed.data);
  if (!rigCheck.ok) {
    throw new ManifestBuildError(
      'AST_MANIFEST_RIG',
      rigCheck.issues.map(i => i.message).join('; '),
    );
  }
  return parsed.data;
}
