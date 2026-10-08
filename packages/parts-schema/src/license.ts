import {z} from 'zod';

/** License identifiers known to the app. Only the first two may be bundled (REQ-AST-017). */
export const LICENSE_IDS = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'own-work',
  'other',
] as const;

/** Licenses accepted for bundled assets. */
export const BUNDLED_LICENSE_IDS = ['CC0-1.0', 'CC-BY-4.0'] as const;

const httpUrl = z
  .string()
  .regex(/^https?:\/\/\S+$/, {error: 'must be an http(s) URL'});

/** License record of any asset, bundled or user-declared (architecture 3.1). */
export const assetLicenseSchema = z.object({
  license: z.enum(LICENSE_IDS),
  author: z.string().min(1),
  title: z.string().min(1).optional(),
  sourceUrl: httpUrl.optional(),
  commercialUse: z.enum(['yes', 'no', 'unknown']),
  attributionRequired: z.boolean(),
  notes: z.string().optional(),
});

/** Inferred type of {@link assetLicenseSchema}. */
export type AssetLicense = z.infer<typeof assetLicenseSchema>;

/**
 * License of a bundled asset: CC0-1.0 or CC-BY-4.0 with author and source URL required
 * (REQ-GEN-008, REQ-AST-017, constitution P-02).
 */
export const bundledLicenseSchema = z.object({
  license: z.enum(BUNDLED_LICENSE_IDS),
  author: z.string().min(1),
  title: z.string().min(1).optional(),
  sourceUrl: httpUrl,
  commercialUse: z.enum(['yes', 'no', 'unknown']),
  attributionRequired: z.boolean(),
  notes: z.string().optional(),
});

/** Inferred type of {@link bundledLicenseSchema}. */
export type BundledLicense = z.infer<typeof bundledLicenseSchema>;
