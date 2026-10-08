import type {SheetInfo} from '@/components/landing/sprite';

/** Sprite sheets in public/sprites (all listed in public/sprites/manifest.json). */
export const SHEETS = {
  hero: {
    src: '/sprites/hero/adventurer-walk-8dir.png',
    width: 384,
    height: 512,
    cell: 64,
  },
  lineup: {
    src: '/sprites/features/lineup.png',
    width: 384,
    height: 384,
    cell: 64,
  },
  parade: {
    src: '/sprites/parade/lineup-east.png',
    width: 384,
    height: 384,
    cell: 64,
  },
  anatomy: {
    src: '/sprites/features/anatomy.png',
    width: 384,
    height: 192,
    cell: 64,
  },
  cameras: {
    src: '/sprites/features/cameras.png',
    width: 384,
    height: 128,
    cell: 64,
  },
  looks: {src: '/sprites/features/looks.png', width: 256, height: 64, cell: 64},
  robot: {src: '/sprites/features/robot.png', width: 384, height: 64, cell: 64},
  export32: {
    src: '/sprites/features/export-32.png',
    width: 192,
    height: 128,
    cell: 32,
  },
} as const satisfies Record<string, SheetInfo>;

/** Character names for alt text, in lineup row order. */
export const LINEUP_NAMES = [
  'scout',
  'mage',
  'knight',
  'ranger',
  'bard',
  'rogue',
] as const;
