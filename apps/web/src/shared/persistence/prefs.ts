import {z} from 'zod';
import {EASY_CATEGORY_IDS, findForbiddenKey} from '@csg/parts-schema';
import type {EasyCategoryId} from '@csg/parts-schema';

/** localStorage key of the UI preferences (REQ-UX-047). */
export const PREFS_KEY = 'csg.prefs';
/** Largest accepted stored value, in characters. */
export const MAX_PREFS_CHARS = 65_536;

/** Local UI preferences, version 2 (REQ-UX-047, spec 009 Data & contracts). */
export interface UiPrefs {
  readonly format: 'sprite-ui-prefs';
  readonly version: 2;
  theme: 'dark' | 'light' | 'system';
  layout: {
    libraryPx: number;
    inspectorPx: number;
    dockPx: number;
    collapsed: {library: boolean; inspector: boolean; dock: boolean};
  };
  dockTab: 'timeline' | 'material-graph' | 'post-graph';
  inspectorTab: 'parts' | 'colors' | 'anatomy' | 'render' | 'animation';
  singleKeyShortcuts: boolean;
  reduceMotion: boolean | 'system';
  remaps: Record<string, string[]>;
  workspace: 'easy' | 'pro';
  easyTab: EasyCategoryId;
  showHomeOnStartup: boolean;
  dismissed: {tour: boolean};
}

const px = z.number().int().min(0).max(4000);

const layoutSchema = z.object({
  libraryPx: px,
  inspectorPx: px,
  dockPx: px,
  collapsed: z.object({
    library: z.boolean(),
    inspector: z.boolean(),
    dock: z.boolean(),
  }),
});

const remapsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
    z.array(z.string().min(1).max(32)).max(4),
  )
  .refine(r => Object.keys(r).length <= 512);

/** One schema per preference, so a bad value falls back alone (AC-GEN-013.4). */
const fieldSchemas = {
  theme: z.enum(['dark', 'light', 'system']),
  layout: layoutSchema,
  dockTab: z.enum(['timeline', 'material-graph', 'post-graph']),
  inspectorTab: z.enum(['parts', 'colors', 'anatomy', 'render', 'animation']),
  singleKeyShortcuts: z.boolean(),
  reduceMotion: z.union([z.boolean(), z.literal('system')]),
  remaps: remapsSchema,
  workspace: z.enum(['easy', 'pro']),
  easyTab: z.enum(EASY_CATEGORY_IDS),
  showHomeOnStartup: z.boolean(),
  dismissed: z.object({tour: z.boolean()}),
} as const;

/** Default preferences. A new profile starts in Easy (REQ-UX-054). */
export function defaultPrefs(workspace: 'easy' | 'pro' = 'easy'): UiPrefs {
  return {
    format: 'sprite-ui-prefs',
    version: 2,
    theme: 'dark', // REQ-UX-034: Dark is the default
    layout: {
      libraryPx: 280,
      inspectorPx: 320,
      dockPx: 240,
      collapsed: {library: false, inspector: false, dock: false},
    },
    dockTab: 'timeline',
    inspectorTab: 'parts',
    singleKeyShortcuts: true,
    reduceMotion: 'system',
    remaps: {},
    workspace,
    easyTab: 'body',
    showHomeOnStartup: true,
    dismissed: {tour: false},
  };
}

/** Applies each valid field of `raw` over `base`; an invalid field keeps the base value. */
function overlay(base: UiPrefs, raw: Record<string, unknown>): UiPrefs {
  const out: Record<string, unknown> = {...base};
  for (const [name, schema] of Object.entries(fieldSchemas)) {
    const parsed = schema.safeParse(raw[name]);
    if (parsed.success) out[name] = parsed.data;
  }
  return out as unknown as UiPrefs;
}

/**
 * Migrates a version-1 blob (REQ-UX-047): `workspace` = `pro` (an existing profile keeps the
 * layout it knew), `easyTab` = `body`, `showHomeOnStartup` = `!dismissed.welcome`, and
 * `dismissed.welcome` is dropped.
 */
function migrateV1(raw: Record<string, unknown>): UiPrefs {
  const dismissed = raw['dismissed'];
  const welcome =
    typeof dismissed === 'object' && dismissed !== null
      ? (dismissed as Record<string, unknown>)['welcome']
      : undefined;
  const tour =
    typeof dismissed === 'object' && dismissed !== null
      ? (dismissed as Record<string, unknown>)['tour']
      : undefined;
  return overlay(defaultPrefs('pro'), {
    ...raw,
    workspace: 'pro',
    easyTab: 'body',
    showHomeOnStartup: typeof welcome === 'boolean' ? !welcome : true,
    dismissed: {tour: tour === true},
  });
}

/**
 * Loads the preferences. Missing, oversized, forbidden-key or unparsable storage yields the
 * defaults; a wrong-typed field falls back alone (AC-UX-047.1, AC-GEN-013.4). A version-1 value
 * is migrated; an unknown version yields defaults.
 *
 * @param storage `localStorage`, or `null` when unavailable.
 * @param fresh True for a new profile: the defaults open in Easy; otherwise they open in Pro,
 *   the layout an existing profile knew (REQ-UX-054).
 */
export function loadPrefs(storage: Storage | null, fresh: boolean): UiPrefs {
  const defaults = defaultPrefs(fresh ? 'easy' : 'pro');
  let text: string | null | undefined;
  try {
    text = storage?.getItem(PREFS_KEY);
  } catch {
    return defaults;
  }
  if (text === null || text === undefined) return defaults;
  if (text.length > MAX_PREFS_CHARS) return defaults;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return defaults;
  }
  if (
    typeof json !== 'object' ||
    json === null ||
    Array.isArray(json) ||
    findForbiddenKey(json) !== null
  ) {
    return defaults;
  }
  const raw = json as Record<string, unknown>;
  if (raw['version'] === 1) return migrateV1(raw);
  if (raw['version'] === 2 && raw['format'] === 'sprite-ui-prefs') {
    return overlay(defaults, raw);
  }
  return defaults;
}

/** Writes the preferences; a failure (storage full or blocked) is ignored. */
export function savePrefs(storage: Storage | null, prefs: UiPrefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; the editor keeps working without them.
  }
}
