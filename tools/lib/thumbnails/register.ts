/**
 * The manifest `thumbnail` field (spec 011 REQ-AST-013, AC-AST-015.1): a computed field, set to
 * `thumbnails/<partId>.webp` exactly when that file exists in the built pack. Used by
 * `assets:build` (emit) and by `assets:thumbnails` after it installs new files, so both write the
 * same manifest. Pure.
 */

/** Pack-relative thumbnail path of a part. */
export function partThumbnailPath(partId: string): string {
  return `thumbnails/${partId}.webp`;
}

/** Thumbnail field of a part given which pack files exist. */
export function thumbnailFor(
  partId: string,
  exists: (packPath: string) => boolean,
): string | undefined {
  const path = partThumbnailPath(partId);
  return exists(path) ? path : undefined;
}

/**
 * Returns a copy of a parsed `manifest.json` whose parts carry `thumbnail` exactly when the file
 * exists (removed otherwise), plus whether anything changed. Other fields are untouched.
 */
export function registerPartThumbnails(
  manifest: Record<string, unknown>,
  exists: (packPath: string) => boolean,
): {manifest: Record<string, unknown>; changed: boolean} {
  const parts = Array.isArray(manifest['parts']) ? manifest['parts'] : [];
  let changed = false;
  const next = parts.map((p: unknown) => {
    if (typeof p !== 'object' || p === null) return p;
    const part = p as Record<string, unknown>;
    if (typeof part['id'] !== 'string') return part;
    const want = thumbnailFor(part['id'], exists);
    if (part['thumbnail'] === want) return part;
    changed = true;
    const {thumbnail: _old, ...rest} = part;
    return want === undefined ? rest : {...rest, thumbnail: want};
  });
  return {manifest: {...manifest, parts: next}, changed};
}
