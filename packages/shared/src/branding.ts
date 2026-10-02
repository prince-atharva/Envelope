import { z } from 'zod';

/** Workspace branding (docs/22, ADR 0034). */
export const BRAND_LOGO_MAX_BYTES = 512 * 1024;
/** Guards against a small file that decodes to a huge bitmap. */
export const BRAND_LOGO_MAX_PIXELS = 16_000_000;
export const BRAND_LOGO_FIT = { width: 480, height: 160 } as const;
export const BRAND_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;
/** The least contrast white text must have on the accent colour (WCAG 2.2 AA, normal text). */
export const BRAND_MIN_CONTRAST = 4.5;
/** The colour the product uses when a workspace sets none. */
export const DEFAULT_ACCENT_COLOR = '#4f46e5';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of white text on this colour, from 1 (none) to 21. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

export function isReadableWithWhiteText(hex: string): boolean {
  return contrastWithWhite(hex) >= BRAND_MIN_CONTRAST;
}

export const brandColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOUR, 'Use a colour like #1d4ed8')
  .transform((value) => value.toLowerCase())
  .refine(isReadableWithWhiteText, {
    message: 'This colour is too light for white text. Choose a darker one.',
  });

/** PATCH /branding. `null` goes back to the product colour. */
export const updateBrandingSchema = z.strictObject({
  color: brandColorSchema.nullable(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

/** GET /branding and the responses that change it. */
export interface BrandingSettings {
  workspaceName: string;
  color: string | null;
  /** A path on this site, or null when no logo is set. */
  logoUrl: string | null;
}

/** What a recipient-facing page needs to look like the sender's workspace. */
export interface SigningBrand {
  name: string;
  color: string | null;
  logoUrl: string | null;
}
