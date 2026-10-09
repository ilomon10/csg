import {PALETTE_PRESETS, canonicalProjectJson} from '@csg/parts-schema';
import type {AssetLicense, ProjectDocument} from '@csg/parts-schema';
import type {EngineAssetRegistry, ExportContext} from '@csg/engine';

type Credit = ExportContext['credits'][number];

/** License record used when the registry cannot describe a ref: it raises `LICENSE_UNKNOWN`. */
function unknownLicense(ref: string): AssetLicense {
  return {
    license: 'other',
    author: 'Unknown',
    title: ref,
    commercialUse: 'unknown',
    attributionRequired: false,
  };
}

function licenceOf(registry: EngineAssetRegistry, ref: string): AssetLicense {
  try {
    return registry.licenseOf(ref as never);
  } catch {
    return unknownLicense(ref);
  }
}

/**
 * The assets an export uses (REQ-EXP-020): body, equipped parts, the clips of the animation
 * selections and the palette preset. Pure; refs the registry does not know count as unknown.
 *
 * @param doc The document snapshot.
 * @param registry Registry that knows the licences.
 * @returns Credit entries in document order (the exporter sorts them).
 */
export function collectCredits(
  doc: ProjectDocument,
  registry: EngineAssetRegistry,
): Credit[] {
  const out: Credit[] = [
    {
      ref: doc.character.body.ref,
      kind: 'body',
      license: licenceOf(registry, doc.character.body.ref),
    },
  ];
  for (const sel of Object.values(doc.character.parts)) {
    if (sel === undefined) continue;
    out.push({
      ref: sel.ref,
      kind: 'part',
      license: licenceOf(registry, sel.ref),
    });
  }
  const clips = new Set<string>();
  for (const a of doc.render.animations) {
    if (clips.has(a.clipId)) continue;
    clips.add(a.clipId);
    out.push({
      ref: a.clipId,
      kind: 'clip',
      license: licenceOf(registry, a.clipId),
    });
  }
  const paletteId = doc.render.palette.id;
  if (paletteId === 'pico-8' || paletteId === 'endesga-32') {
    const source = PALETTE_PRESETS[paletteId].source;
    out.push({
      ref: `palette:${paletteId}`,
      kind: 'palette',
      license: {
        license: 'own-work',
        author: source.author,
        title: PALETTE_PRESETS[paletteId].name,
        sourceUrl: source.sourceUrl,
        commercialUse: 'yes',
        attributionRequired: false,
        notes: 'Color list, no license stated by source',
      },
    });
  }
  return out;
}

/** Lowercase hex SHA-256 of the canonical project JSON (REQ-EXP-011). */
export async function projectSha256(doc: ProjectDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProjectJson(doc));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
