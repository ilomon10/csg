import {parseClipManifestJson, parsePartManifestJson} from '@csg/engine';
import type {EngineAssetRegistry} from '@csg/engine';

/** URL prefix the dev server, preview server and build serve `assets/packs` under. */
export const PACKS_BASE_URL = '/packs';

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Registers the bundled packs with the registry: the part packs first (they embed the rig),
 * then the clip pack (REQ-ANM-001, spec 011 REQ-AST-013).
 *
 * @param registry The engine registry.
 * @throws Error naming the file when a manifest cannot be fetched or parsed.
 */
export async function loadBundledPacks(
  registry: EngineAssetRegistry,
): Promise<void> {
  for (const pack of ['quaternius-ubc', 'quaternius-outfits']) {
    const base = `${PACKS_BASE_URL}/${pack}`;
    const parsed = parsePartManifestJson(
      await fetchText(`${base}/manifest.json`),
    );
    if (!parsed.ok) {
      throw new Error(
        `${base}/manifest.json: ${parsed.issues.map(i => i.message).join('; ')}`,
      );
    }
    registry.registerPack(parsed.value, base);
  }
  const clipBase = `${PACKS_BASE_URL}/quaternius-ual`;
  const clips = parseClipManifestJson(
    await fetchText(`${clipBase}/clips.json`),
  );
  if (!clips.ok) {
    throw new Error(
      `${clipBase}/clips.json: ${clips.issues.map(i => i.message).join('; ')}`,
    );
  }
  registry.registerClips(clips.value, clipBase);
}
