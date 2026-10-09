import {defaultPivotRowPx, parseRenderSettings} from '@csg/parts-schema';
import type {
  LookPreset,
  ProjectDocument,
  RenderSettings,
  RenderSettingsIssue,
} from '@csg/parts-schema';
import type {DocCommand, DocumentStore} from '../../shared/document';

/** A partial `RenderSettings` (the shape of a look preset's `render`). */
export type RenderPatch = Readonly<Record<string, unknown>>;

/** One field error of a rejected edit (REQ-PIX-037): path, stable code and message. */
export type RenderIssue = Pick<
  RenderSettingsIssue,
  'path' | 'code' | 'message'
>;

/** Result of validating a patch over the current settings. */
export type RenderEdit =
  | {readonly ok: true; readonly render: RenderSettings}
  | {readonly ok: false; readonly issues: readonly RenderIssue[]};

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality of JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => deepEqual(v, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  );
}

/**
 * Merges `patch` over `base`: objects merge key by key, arrays and `params` are replaced,
 * and the keys `__proto__`, `constructor` and `prototype` are dropped (preset files are data
 * from packs, so they are untrusted).
 */
export function mergeRenderPatch(
  base: Record<string, unknown>,
  patch: RenderPatch,
  replaceKeys: ReadonlySet<string> = new Set(['params']),
): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN.has(key)) continue;
    const current = out[key];
    out[key] =
      isRecord(value) && isRecord(current) && !replaceKeys.has(key)
        ? mergeRenderPatch(current, value, new Set())
        : value;
  }
  return out;
}

/** Whether the explicit pivot row is just the preset default of these settings. */
function pivotIsDefault(render: RenderSettings): boolean {
  const {camera, outline, resolution} = render;
  return (
    camera.pivotRowPx ===
    defaultPivotRowPx(
      camera.preset,
      resolution.height,
      outline.outer.enabled ? outline.outer.widthPx : 0,
    )
  );
}

/**
 * Validates `patch` over `render` with `parseRenderSettings` and reports every invalid field.
 * Derived fields follow the edit: a pivot row that was still the default is recomputed, toon
 * thresholds are dropped when the band count changes, and palette colors are dropped when the
 * palette stops being `custom`.
 */
export function resolveRenderPatch(
  render: RenderSettings,
  patch: RenderPatch,
): RenderEdit {
  const merged = mergeRenderPatch(
    render as unknown as Record<string, unknown>,
    patch,
  );
  const camera = {...(merged['camera'] as Record<string, unknown>)};
  if (pivotIsDefault(render)) delete camera['pivotRowPx'];
  merged['camera'] = camera;
  const toonPatch = isRecord(patch['toon']) ? patch['toon'] : null;
  if (toonPatch && 'bands' in toonPatch && !('thresholds' in toonPatch)) {
    const {thresholds: _drop, ...toon} = merged['toon'] as Record<
      string,
      unknown
    >;
    merged['toon'] = toon;
  }
  const palette = merged['palette'];
  if (isRecord(palette) && palette['id'] !== 'custom' && 'colors' in palette) {
    const {colors: _drop, ...rest} = palette;
    merged['palette'] = rest;
  }
  const result = parseRenderSettings(merged);
  if (!result.ok) {
    return {
      ok: false,
      issues: result.issues.map(({path, code, message}) => ({
        path,
        code,
        message,
      })),
    };
  }
  return {ok: true, render: result.value};
}

/** One undoable `render` command; invalid or unchanged settings record nothing. */
export function renderCommand(
  label: string,
  patch: RenderPatch,
  coalesceKey?: string,
): DocCommand {
  return {
    label,
    feature: 'render',
    ...(coalesceKey ? {coalesceKey} : {}),
    apply(doc: ProjectDocument) {
      const edit = resolveRenderPatch(doc.render, patch);
      if (!edit.ok || deepEqual(edit.render, doc.render)) return null;
      return {...doc, render: edit.render};
    },
  };
}

/**
 * Validates, then dispatches one `render` command. Returns the field errors and leaves the
 * document untouched when the patch is invalid (AC-PIX-037.1 in the UI).
 */
export function dispatchRenderPatch(
  store: DocumentStore,
  label: string,
  patch: RenderPatch,
  coalesceKey?: string,
): readonly RenderIssue[] {
  const doc = store.getState().doc;
  if (!doc) return [];
  const edit = resolveRenderPatch(doc.render, patch);
  if (!edit.ok) return edit.issues;
  store.dispatch(renderCommand(label, patch, coalesceKey));
  return [];
}

/** The patch a look preset applies: its graph refs, params and typed `render` fields. */
export function lookPatch(preset: LookPreset): RenderPatch {
  return {
    materialGraph: preset.materialGraph,
    postGraph: preset.postGraph,
    params: preset.params,
    ...(preset.render ?? {}),
  };
}

/** Whether `render` already equals the result of applying `preset`. */
export function presetMatches(
  render: RenderSettings,
  preset: LookPreset,
): boolean {
  const edit = resolveRenderPatch(render, lookPatch(preset));
  return edit.ok && deepEqual(edit.render, render);
}

const LOOK_GROUPS = [
  'toon',
  'outline',
  'palette',
  'lighting',
  'materialGraph',
  'postGraph',
  'params',
] as const;

/** Look groups whose values differ between two settings, in a fixed order. */
export function changedLookGroups(
  from: RenderSettings,
  to: RenderSettings,
): readonly (typeof LOOK_GROUPS)[number][] {
  return LOOK_GROUPS.filter(group => !deepEqual(from[group], to[group]));
}
