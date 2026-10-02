import { describe, expect, it } from 'vitest';
import { brandShades, brandStyle } from './brand-theme';

describe('brandShades', () => {
  it('keeps the accent as the 700 step', () => {
    expect(brandShades('#1d4ed8')['700']).toBe('#1d4ed8');
  });

  it('tints lighter steps toward white and darker steps toward black', () => {
    const shades = brandShades('#1d4ed8');
    expect(shades['50']).toBe('#edf1fc');
    expect(shades['950']?.startsWith('#')).toBe(true);
    const sum = (hex: string | undefined) =>
      hex ? Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(3, 5), 16) : 0;
    expect(sum(shades['50'])).toBeGreaterThan(sum(shades['300']));
    expect(sum(shades['300'])).toBeGreaterThan(sum(shades['700']));
    expect(sum(shades['700'])).toBeGreaterThan(sum(shades['950']));
  });
});

describe('brandStyle', () => {
  it('sets every brand variable for a valid colour', () => {
    const style = brandStyle('#1D4ED8') as Record<string, string>;
    expect(Object.keys(style)).toHaveLength(11);
    expect(style['--color-brand-700']).toBe('#1d4ed8');
  });

  it.each([null, undefined, '', 'red', '#fff', 'url(javascript:1)'])(
    'gives no override for %s',
    (value) => {
      expect(brandStyle(value)).toBeUndefined();
    },
  );
});
