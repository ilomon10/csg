import {z} from 'zod';

/** Socket value types of the shader graph (pure model, no three.js). */
export const socketTypeSchema = z.enum([
  'float',
  'int',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'color',
  'texture',
]);

/**
 * Inferred type of {@link socketTypeSchema}:
 * `'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'texture'`.
 */
export type SocketType = z.infer<typeof socketTypeSchema>;
