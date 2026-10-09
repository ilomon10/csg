import type {ReactElement} from 'react';

const PATHS = {
  check: <path d="M4 12l5 5L20 6" />,
  plus: <path d="M12 4v16M4 12h16" />,
  x: <path d="M5 5l14 14M19 5L5 19" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  dots: (
    <>
      <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={4} />
    </>
  ),
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h3" />,
  dice: (
    <>
      <path d="M4 4h16v16H4z" />
      <path
        d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"
        strokeWidth={3}
      />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  pencil: <path d="M4 20l1-5L16 4l4 4L9 19z" />,
  info: <path d="M12 8h.01M11 12h1v5h1M3 3h18v18H3z" />,
  warning: <path d="M12 4L3 20h18zM12 10v5M12 17.5h.01" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  gear: (
    <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM4 11h2M18 11h2M11 4v2M11 18v2" />
  ),
  home: <path d="M4 11l8-7 8 7M6 10v10h12V10M10 20v-6h4v6" />,
  help: <path d="M9 9a3 3 0 116 0c0 2-3 2-3 5M12 18h.01M3 3h18v18H3z" />,
  search: <path d="M10 4a6 6 0 100 12 6 6 0 000-12zM15 15l5 5" />,
  logo: <path d="M6 4h12v6h-4v4h4v6H6v-6h4v-4H6z" />,
  play: <path d="M7 4l12 8-12 8z" />,
  pause: <path d="M7 4v16M17 4v16" strokeWidth={4} />,
  'arrow-up': <path d="M12 20V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 4v15M6 13l6 6 6-6" />,
  box: <path d="M5 5h14v14H5z" />,
  palette: (
    <path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-6-4-11-8-11zM8 11h.01M12 8h.01M16 11h.01" />
  ),
  smiley: (
    <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM9 10h.01M15 10h.01M8 15c2 2.5 6 2.5 8 0" />
  ),
  scissors: (
    <path d="M6 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 8l12 11M8 16L20 5" />
  ),
  't-shirt': <path d="M9 4L3 7l2 4 3-1v10h8V10l3 1 2-4-6-3a3 3 0 01-6 0z" />,
  sword: <path d="M5 19l9-9M14 10l5-6-1-1-6 5M7 13l4 4M4 20l2-2" />,
  swatches: <path d="M4 4h6v16H4zM10 8l5-4 4 5-9 7M10 20h10v-5" />,
  // Slot glyphs (composer placeholders for parts without a thumbnail, REQ-CMP-029).
  'slot-body': <path d="M9 4h6v5H9zM6 11h12v6h-3v4H9v-4H6z" />,
  'slot-hair': <path d="M5 13V9l3-4h8l3 4v4l-3-2H8z" />,
  'slot-eyebrows': <path d="M4 10l6-2M14 8l6 2" />,
  'slot-beard': <path d="M6 9h12v4l-3 6H9l-3-6z" />,
  'slot-face': <path d="M6 5h12v14H6zM9 10h.01M15 10h.01M9 15h6" />,
  'slot-headwear': <path d="M5 16a7 7 0 0114 0zM3 16h18v3H3z" />,
  'slot-torso': <path d="M8 4l-4 4 2 3 2-1v10h8V10l2 1 2-3-4-4-2 2h-4z" />,
  'slot-arms': <path d="M6 4l4 0 0 6-3 10H4l2-10z" />,
  'slot-hands': <path d="M7 20v-8l-1-4 2-1 1 4V5l2-1v7l2-6 2 1-1 6 3-1v8z" />,
  'slot-legs': <path d="M7 3h10l-1 18h-3l-1-12-1 12H8z" />,
  'slot-feet': <path d="M6 4h5v10l8 3v3H5z" />,
  'slot-back': <path d="M6 4h12v6l-3 10H9L6 10z" />,
  'slot-accessory': <path d="M12 4l3 5 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1z" />,
  'slot-prop-main-hand': <path d="M5 19L17 7M14 4h6v6M4 20l2-5 3 3z" />,
  'slot-prop-off-hand': <path d="M6 5h12v8l-6 7-6-7z" />,
  user: <path d="M8 8a4 4 0 118 0 4 4 0 01-8 0zM4 21c0-5 3-7 8-7s8 2 8 7" />,
} as const;

/** Names in the built-in inline SVG icon set (no icon package, REQ-UX-040). */
export type IconName = keyof typeof PATHS;

/** Props of {@link Icon}. */
export interface IconProps {
  readonly name: IconName;
  /** Accessible name; omit for decorative icons (the icon is then `aria-hidden`). */
  readonly label?: string;
  readonly size?: number;
  readonly className?: string;
}

/** Inline SVG icon drawn with `currentColor`, square caps (the mockup's pixel look). */
export function Icon({name, label, size, className}: IconProps): ReactElement {
  return (
    <svg
      className={className ? `csg-icon ${className}` : 'csg-icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={size === undefined ? undefined : {width: size, height: size}}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Icon for a slot id (composer placeholder glyph); unknown slots get a plain box. */
export function slotIconName(slot: string): IconName {
  const name = `slot-${slot}`;
  return Object.hasOwn(PATHS, name) ? (name as IconName) : 'box';
}

/** Icon for an Easy category icon id (`EasyCategoryDef.icon`); unknown ids get a plain box. */
export function categoryIconName(id: string): IconName {
  return Object.hasOwn(PATHS, id) ? (id as IconName) : 'box';
}
