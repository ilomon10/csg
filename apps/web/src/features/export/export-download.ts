/** A Blob URL for a ZIP, and the anchor click that saves it. No network is involved. */
export interface ZipDownload {
  readonly url: string;
  /** Clicks a temporary anchor with the `download` attribute. */
  save(): void;
  /** Frees the Blob URL. Idempotent. */
  dispose(): void;
}

/**
 * Wraps ZIP bytes in a Blob URL (REQ-EXP-017: exactly one download).
 *
 * @param zipName File name, `<base>.zip`.
 * @param zip ZIP bytes.
 * @returns The download handle.
 */
export function createZipDownload(
  zipName: string,
  zip: Uint8Array,
): ZipDownload {
  const url = URL.createObjectURL(
    new Blob([zip as Uint8Array<ArrayBuffer>], {type: 'application/zip'}),
  );
  let disposed = false;
  return {
    url,
    save() {
      if (disposed) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      URL.revokeObjectURL(url);
    },
  };
}
