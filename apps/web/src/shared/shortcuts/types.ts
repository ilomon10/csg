/** Scopes in precedence order (REQ-UX-012; spec 009 Data & contracts). */
export type ShortcutScope =
  | 'global'
  | 'library'
  | 'viewport'
  | 'inspector'
  | 'timeline'
  | 'graph'
  | 'easy-preview'
  | 'easy-panel'
  | 'home'
  | 'wizard'
  | 'modal'
  | 'prop-fitting'
  | 'palette'
  | 'help'
  | 'tour';

/** Scopes that outrank focused regions (REQ-UX-012). */
export const MODAL_SCOPES: readonly ShortcutScope[] = [
  'modal',
  'prop-fitting',
  'palette',
  'help',
  'tour',
];

/** Scopes bound to the focused region. */
export const REGION_SCOPES: readonly ShortcutScope[] = [
  'library',
  'viewport',
  'inspector',
  'timeline',
  'graph',
  'easy-preview',
  'easy-panel',
  'home',
  'wizard',
];

/** One command, shared by shortcuts, palette, menus and toolbar buttons. */
export interface CommandDef {
  readonly id: string;
  readonly titleKey: string;
  readonly category:
    | 'app'
    | 'project'
    | 'composer'
    | 'animation'
    | 'viewport'
    | 'graph'
    | 'export'
    | 'upload'
    | 'dock'
    | 'inspector';
  readonly synonyms?: readonly string[];
  /** Returns null when enabled, or an i18n key explaining why not. */
  readonly disabledReason?: () => string | null;
  readonly run: () => void | Promise<void>;
}

/** One binding row of the registry (REQ-UX-011, 013). */
export interface ShortcutDef {
  readonly commandId: string;
  /** Platform-neutral chords: `Mod+Shift+Z`, `Shift+A`, `Space`, `?`. */
  readonly keys: readonly string[];
  readonly scope: ShortcutScope;
  readonly allowInInput?: boolean;
  /** Command id this binding intentionally overrides in its scope. */
  readonly shadows?: string;
  /** Named extra condition, evaluated by the dispatcher's `when` option, or `tap`. */
  readonly when?: string;
}

/** A parsed chord. `mod` is Ctrl on Windows/Linux and Cmd on macOS. */
export interface Chord {
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Key name as in `KeyboardEvent.key`, except `Space` for the space bar. */
  readonly key: string;
}

/** The parts of a keyboard event the matcher reads. */
export interface KeyboardEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Display and matching platform. */
export type Platform = 'mac' | 'other';
