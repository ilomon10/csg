import {MESSAGES} from './messages';
import type {MessageKey} from './messages';

/**
 * Looks up a message and fills `{name}` placeholders. The result is plain text: render it as
 * text, never as HTML.
 */
export function t(
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return MESSAGES[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** Formats an edit time for the home details line (REQ-UX-071), via `Intl`. */
export function formatEditedDate(epochMs: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}).format(
    new Date(epochMs),
  );
}

/** Formats a byte count for the storage usage line (REQ-UX-050), via `Intl`. */
export function formatBytes(bytes: number, locale?: string): string {
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, {maximumFractionDigits: 1}).format(mb)} MB`;
}

/** Resolves a data-file message key (a `label` or `labelKey`); unknown keys use `fallback`. */
export function tOr(key: string, fallback: string): string {
  return Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : fallback;
}

/** Title of a command id (`cmd.<id>`); falls back to the id for commands without a message. */
export function commandTitle(id: string): string {
  const key = `cmd.${id}`;
  return Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : id;
}
