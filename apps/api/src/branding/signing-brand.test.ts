import { describe, expect, it } from 'vitest';
import { absoluteBrand, toSigningBrand } from './signing-brand';

describe('toSigningBrand', () => {
  it('has no logo address without a logo, and never the tenant id', () => {
    expect(toSigningBrand({ name: 'Acme', brandColor: null, brandLogoRef: null })).toEqual({
      name: 'Acme',
      color: null,
      logoUrl: null,
    });
  });

  it('points at the public logo route by reference', () => {
    expect(toSigningBrand({ name: 'Acme', brandColor: '#1d4ed8', brandLogoRef: 'r1' })).toEqual({
      name: 'Acme',
      color: '#1d4ed8',
      logoUrl: '/api/v1/branding/logo/r1',
    });
  });
});

describe('absoluteBrand', () => {
  it('makes the logo address absolute for a mail client', () => {
    const brand = { name: 'Acme', color: null, logoUrl: '/api/v1/branding/logo/r1' };
    expect(absoluteBrand(brand, 'https://app.example.com/').logoUrl).toBe(
      'https://app.example.com/api/v1/branding/logo/r1',
    );
  });

  it('leaves a missing logo missing', () => {
    expect(absoluteBrand({ name: 'A', color: null, logoUrl: null }, 'https://x.test').logoUrl).toBe(
      null,
    );
  });
});
