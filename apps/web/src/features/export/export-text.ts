/**
 * UI text of the export dialog (REQ-UX-033). The feature keeps its own table because the shared
 * message table belongs to the shell; the keys can move there without touching the components.
 */
export const EXPORT_TEXT = {
  title: 'Export sprite sheet',
  layout: 'Layout',
  layoutGrid: 'Grid',
  layoutStrip: 'Strips',
  layoutFrames: 'Frame PNGs',
  rowOrder: 'Row order',
  rowClip: 'By clip',
  rowDirection: 'By direction',
  scales: 'Scales',
  maxColumns: 'Max columns',
  maxColumnsHint: 'Empty for no wrap (1 to 256)',
  padding: 'Padding (px)',
  margin: 'Margin (px)',
  powerOfTwo: 'Power-of-two sheet size',
  metadata: 'Metadata',
  metaNone: 'None',
  metaJson: 'Manifest',
  metaAseprite: 'Aseprite JSON',
  baseName: 'File name',
  baseNameHint: 'Empty uses the character name',
  planHeading: 'This export',
  planLoading: 'Checking the export size…',
  export: 'Export',
  cancel: 'Cancel',
  close: 'Close',
  back: 'Back to settings',
  downloadAgain: 'Download again',
  licenceTitle: 'Check asset licences before exporting',
  licenceIntro:
    'These assets need your attention. Nothing is rendered until you confirm.',
  licenceConfirm: 'Export anyway',
  licenceCancel: 'Cancel export',
  cancelled: 'Export cancelled. Nothing was downloaded.',
  done: 'Export complete',
  failed: 'Export failed',
  preparing: 'Preparing…',
  rendering: 'Rendering frames',
  encoding: 'Encoding images',
  packaging: 'Packaging the ZIP',
} as const;

/** Heading of one licence warning code (AC-EXP-021.1 "Unknown license"). */
export const LICENCE_HEADINGS: Readonly<Record<string, string>> = {
  LICENSE_UNKNOWN: 'Unknown license',
  LICENSE_NON_COMMERCIAL: 'Non-commercial license',
  LICENSE_SHARE_ALIKE: 'Share-alike license',
};

/** One-line explanation under a licence heading. */
export const LICENCE_NOTES: Readonly<Record<string, string>> = {
  LICENSE_UNKNOWN:
    'The license or the commercial use of these assets is not known.',
  LICENSE_NON_COMMERCIAL: 'These assets may not be used commercially.',
  LICENSE_SHARE_ALIKE:
    'These assets require derived work to share the same license.',
};

/**
 * Reason text of REQ-CMP-044.
 *
 * @param label The unavailable style or species label.
 * @returns "<label> is coming soon. Choose a supported style to export."
 */
export function styleBlockedText(label: string): string {
  return `${label} is coming soon. Choose a supported style to export.`;
}

/** "1.4 MB" style size text. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
