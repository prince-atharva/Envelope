import { describe, expect, it } from 'vitest';
import {
  BRAND_MIN_CONTRAST,
  brandColorSchema,
  contrastWithWhite,
  DEFAULT_ACCENT_COLOR,
  isReadableWithWhiteText,
  updateBrandingSchema,
} from './branding';

describe('contrastWithWhite', () => {
  it('is 21 for black and 1 for white', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1, 5);
  });

  it('matches the published value for a mid grey', () => {
    // #767676 is the lightest grey that passes 4.5:1 on white.
    expect(contrastWithWhite('#767676')).toBeGreaterThan(BRAND_MIN_CONTRAST);
    expect(contrastWithWhite('#777777')).toBeLessThan(BRAND_MIN_CONTRAST + 0.05);
  });

  it('accepts the product colour', () => {
    expect(isReadableWithWhiteText(DEFAULT_ACCENT_COLOR)).toBe(true);
  });
});

describe('brandColorSchema', () => {
  it('lower-cases a valid colour', () => {
    expect(brandColorSchema.parse(' #1D4ED8 ')).toBe('#1d4ed8');
  });

  it.each(['red', '#fff', '#12345g', '1d4ed8', '#1d4ed8ff'])('rejects %s', (value) => {
    expect(brandColorSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a colour too light for white text', () => {
    const result = brandColorSchema.safeParse('#ffeb3b');
    expect(result.success).toBe(false);
  });
});

describe('updateBrandingSchema', () => {
  it('allows null to go back to the product colour', () => {
    expect(updateBrandingSchema.parse({ color: null })).toEqual({ color: null });
  });

  it('refuses unknown keys and a missing colour', () => {
    expect(updateBrandingSchema.safeParse({ color: null, logo: 'x' }).success).toBe(false);
    expect(updateBrandingSchema.safeParse({}).success).toBe(false);
  });
});
