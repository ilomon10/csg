/**
 * Detects hand-edited or outdated manifests (spec 011 REQ-AST-013,
 * AC-AST-013.2): authored fields must equal `pack.config.json`, and the
 * embedded rig copy must equal the committed canonical rig. Pure.
 */
import type {CheckIssue} from './types.js';

type Json = unknown;

function isRecord(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Canonical JSON: sorted keys, `undefined` dropped, empty arrays dropped when `dropEmpty`. */
export function stableStringify(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter(k => value[k] !== undefined)
      .sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Deep equality of two JSON values, ignoring key order. */
export function jsonEqual(a: Json, b: Json): boolean {
  return stableStringify(a) === stableStringify(b);
}

const PART_FIELDS = [
  'name',
  'slot',
  'hides',
  'tintSlots',
  'alsoOccupies',
  'bodyType',
  'bodies',
  'bodyTypes',
  'characterSkeletonGroup',
  'socket',
  'tags',
] as const;
const OPTIONAL_LISTS = new Set(['alsoOccupies', 'bodies', 'bodyTypes']);

const CLIP_FIELDS = [
  'name',
  'category',
  'loop',
  'defaultFrameCount',
  'inPlaceVariant',
  'tags',
] as const;

function normalize(field: string, value: Json): Json {
  // Spec 001: an empty or absent `bodies`, `bodyTypes` list means "all".
  if (OPTIONAL_LISTS.has(field) && Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  return value;
}

function entriesById(list: Json): Map<string, Record<string, Json>> {
  const map = new Map<string, Record<string, Json>>();
  if (!Array.isArray(list)) return map;
  for (const e of list) {
    if (isRecord(e) && typeof e['id'] === 'string') map.set(e['id'], e);
  }
  return map;
}

/** What to do about a stale manifest, in every message. */
function hint(packId: string): string {
  return `Do not edit manifest.json by hand: edit tools/packs/${packId}/pack.config.json and run pnpm assets:build.`;
}

/** Inputs of {@link checkManifestFresh}; all raw parsed JSON. */
export interface FreshnessInput {
  packId: string;
  /** Parsed `pack.config.json` (already schema-valid). */
  config: Json;
  /** Parsed `manifest.json`. */
  manifest: Json;
  /** Parsed `clips.json`, when the pack has one. */
  clips?: Json;
  /** Parsed `packages/parts-schema/rigs/<rigId>.json`, or undefined when absent. */
  canonicalRig: Json;
}

/** Compares manifests with their config and the canonical rig (`AST_MANIFEST_STALE`). */
export function checkManifestFresh(input: FreshnessInput): CheckIssue[] {
  const {packId} = input;
  const issues: CheckIssue[] = [];
  const stale = (message: string, id?: string) =>
    issues.push({
      severity: 'error',
      code: 'AST_MANIFEST_STALE',
      packId,
      ...(id === undefined ? {} : {id}),
      message: `${message} ${hint(packId)}`,
    });
  if (!isRecord(input.config) || !isRecord(input.manifest)) return issues;
  const config = input.config;
  const manifest = input.manifest;

  for (const field of ['packId', 'name', 'license'] as const) {
    if (!jsonEqual(config[field], manifest[field])) {
      stale(`manifest.json field "${field}" differs from pack.config.json.`);
    }
  }

  // Embedded rig copy (F5).
  const rigs = Array.isArray(manifest['rigs']) ? manifest['rigs'] : [];
  const embedded = rigs.find(r => isRecord(r) && r['id'] === config['rig']);
  if (embedded === undefined) {
    stale(`manifest.json does not embed rig "${String(config['rig'])}".`);
  } else if (
    input.canonicalRig !== undefined &&
    !jsonEqual(embedded, input.canonicalRig)
  ) {
    stale(
      `The rig "${String(config['rig'])}" embedded in manifest.json differs from packages/parts-schema/rigs/${String(config['rig'])}.json.`,
    );
  }

  const packLicense = config['license'];
  const compare = (
    kind: 'part' | 'clip',
    configList: Json,
    builtList: Json,
    fields: readonly string[],
  ) => {
    const built = entriesById(builtList);
    const authored = entriesById(configList);
    for (const [id, c] of [...authored].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const b = built.get(id);
      if (!b) {
        stale(`${kind} ${id} is in pack.config.json but not built.`, id);
        continue;
      }
      const diff: string[] = [];
      for (const f of fields) {
        if (!jsonEqual(normalize(f, c[f]), normalize(f, b[f]))) diff.push(f);
      }
      const wantLicense = c['license'] ?? packLicense;
      const gotLicense = b['license'] ?? packLicense;
      if (!jsonEqual(wantLicense, gotLicense)) diff.push('license');
      if (kind === 'clip') {
        const match = isRecord(c['match']) ? c['match'] : {};
        if (match['animation'] !== b['sourceName']) diff.push('sourceName');
      }
      if (kind === 'part') {
        const match = isRecord(c['match']) ? c['match'] : {};
        if (match['node'] !== undefined && match['node'] !== b['node'])
          diff.push('node');
      }
      if (diff.length > 0) {
        stale(
          `${kind} ${id}: manifest field(s) ${diff.join(', ')} differ from pack.config.json.`,
          id,
        );
      }
    }
    for (const id of [...built.keys()].sort()) {
      if (!authored.has(id)) {
        // Removed ids are reported by the id check; keep the manifest stale note short.
        stale(
          `${kind} ${id} is in the built manifest but not in pack.config.json.`,
          id,
        );
      }
    }
  };
  compare('part', config['parts'], manifest['parts'], PART_FIELDS);
  if (Array.isArray(config['clips']) && config['clips'].length > 0) {
    compare(
      'clip',
      config['clips'],
      isRecord(input.clips) ? input.clips['clips'] : [],
      CLIP_FIELDS,
    );
    if (isRecord(input.clips)) {
      for (const field of ['packId', 'name', 'license'] as const) {
        if (!jsonEqual(config[field], input.clips[field])) {
          stale(`clips.json field "${field}" differs from pack.config.json.`);
        }
      }
    }
  }
  return issues;
}
