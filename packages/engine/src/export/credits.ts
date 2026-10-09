/** CREDITS.txt and licence warnings (REQ-EXP-020, 021, 022). Pure, UTF-8, LF, no dates. */
import type {ExportContext, ExportWarning} from './types';

type CreditEntry = ExportContext['credits'][number];

function compareRefs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One entry per ref (first wins), sorted by ref in code-unit order. */
function uniqueSorted(credits: ExportContext['credits']): CreditEntry[] {
  const byRef = new Map<string, CreditEntry>();
  for (const c of credits) if (!byRef.has(c.ref)) byRef.set(c.ref, c);
  return [...byRef.values()].sort((a, b) => compareRefs(a.ref, b.ref));
}

/**
 * Licence warnings of the used assets (REQ-EXP-021): `LICENSE_UNKNOWN` (`other` or unknown
 * commercial use), `LICENSE_NON_COMMERCIAL`, `LICENSE_SHARE_ALIKE`. Each lists its refs sorted;
 * codes without assets are omitted. Empty for CC0-only exports (AC-EXP-021.2).
 *
 * @param credits The credit entries of the export.
 * @returns Warnings in the fixed order unknown, non-commercial, share-alike.
 */
export function licenseWarnings(
  credits: ExportContext['credits'],
): ExportWarning[] {
  const unknown: string[] = [];
  const nonCommercial: string[] = [];
  const shareAlike: string[] = [];
  for (const c of uniqueSorted(credits)) {
    const {license, commercialUse} = c.license;
    if (license === 'other' || commercialUse === 'unknown') unknown.push(c.ref);
    if (commercialUse === 'no') nonCommercial.push(c.ref);
    if (license === 'CC-BY-SA-4.0') shareAlike.push(c.ref);
  }
  const out: ExportWarning[] = [];
  if (unknown.length > 0) out.push({code: 'LICENSE_UNKNOWN', assets: unknown});
  if (nonCommercial.length > 0) {
    out.push({code: 'LICENSE_NON_COMMERCIAL', assets: nonCommercial});
  }
  if (shareAlike.length > 0) {
    out.push({code: 'LICENSE_SHARE_ALIKE', assets: shareAlike});
  }
  return out;
}

/**
 * Builds `CREDITS.txt` (spec 005 format): an "Attribution required" block of ready-to-paste
 * lines, every asset sorted by ref, and a `WARNINGS` section only when warnings exist.
 *
 * @param context Export context (credits).
 * @param baseName Sanitized base file name.
 * @param appVersion App version for the header.
 * @param warnings Warnings to repeat; defaults to the licence warnings.
 * @returns The file text.
 */
export function buildCreditsTxt(
  context: ExportContext,
  baseName: string,
  appVersion: string,
  warnings: readonly ExportWarning[] = licenseWarnings(context.credits),
): string {
  const entries = uniqueSorted(context.credits);
  const lines: string[] = [
    `Credits for ${baseName} (exported with Character Sprite Generator ${appVersion})`,
    '',
    '== Attribution required ==',
  ];
  const required = entries.filter(e => e.license.attributionRequired);
  if (required.length === 0) lines.push('(none)');
  for (const e of required) {
    const l = e.license;
    const url = l.sourceUrl === undefined ? '' : ` ${l.sourceUrl}`;
    lines.push(`"${l.title ?? e.ref}" by ${l.author} (${l.license})${url}`);
  }
  lines.push('', '== All assets ==');
  for (const e of entries) {
    const l = e.license;
    lines.push(
      e.ref,
      `  Title: ${l.title ?? e.ref} | License: ${l.license} | Author: ${l.author}`,
      `  Source: ${l.sourceUrl ?? 'n/a'} | Attribution required: ${l.attributionRequired ? 'yes' : 'no'}`,
    );
  }
  if (warnings.length > 0) {
    lines.push('', '== WARNINGS ==');
    for (const w of warnings) {
      const detail =
        w.assets !== undefined && w.assets.length > 0
          ? w.assets.join(', ')
          : (w.message ?? '');
      lines.push(`${w.code}: ${detail}`.trimEnd());
    }
  }
  return `${lines.join('\n')}\n`;
}
