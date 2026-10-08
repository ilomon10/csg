import {z} from 'zod';
import {clipRefSchema} from './primitives';

/** Export label: `[a-z0-9-]{1,48}`, used for frame, tag and file names (spec 005). */
export const animationLabelSchema = z.string().regex(/^[a-z0-9-]{1,48}$/, {
  error: issue =>
    `invalid label ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,48}`,
});

/**
 * One entry of `RenderSettings.animations` (spec 004 Data & contracts). Clip selection lives
 * in render settings, not in `CharacterSpec`.
 */
export const animationSelectionSchema = z
  .object({
    clipId: clipRefSchema,
    /** Unique within the export; see {@link animationSelectionsSchema}. */
    label: animationLabelSchema,
    frameCount: z.number().int().min(1).max(64, {error: 'Frames must be 1–64'}),
    fps: z.number().int().min(1).max(60),
    loop: z.boolean(),
    pingPong: z.boolean().optional(),
    /** Only with `pingPong`. */
    bakePingPong: z.boolean().optional(),
    timing: z.enum(['fit', 'fixed-fps']).optional(),
    range: z
      .object({
        startSec: z.number().finite().min(0),
        endSec: z.number().finite().min(0),
      })
      .optional(),
    rootMotion: z.enum(['in-place', 'metadata']).optional(),
    /** Key = direction index (spec 003 REQ-PIX-005). */
    directionOverrides: z
      .record(
        z.string().regex(/^\d+$/, {error: 'must be a direction index'}),
        clipRefSchema,
      )
      .optional(),
  })
  .superRefine((selection, ctx) => {
    if (
      selection.range !== undefined &&
      selection.range.startSec >= selection.range.endSec
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['range'],
        message: 'range: startSec must be less than endSec',
      });
    }
    if (selection.bakePingPong === true && selection.pingPong !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['bakePingPong'],
        message: 'bakePingPong requires pingPong',
      });
    }
  });

/** Inferred type of {@link animationSelectionSchema}. */
export type AnimationSelection = z.infer<typeof animationSelectionSchema>;

/** The animation list of one export: at most 32 entries (REQ-ANM-004), labels unique (REQ-ANM-006). */
export const animationSelectionsSchema = z
  .array(animationSelectionSchema)
  .max(32, {error: 'Maximum 32 animations per export'})
  .superRefine((selections, ctx) => {
    const seen = new Set<string>();
    selections.forEach((selection, i) => {
      if (seen.has(selection.label)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'label'],
          message: `duplicate label "${selection.label}"`,
        });
      }
      seen.add(selection.label);
    });
  });
