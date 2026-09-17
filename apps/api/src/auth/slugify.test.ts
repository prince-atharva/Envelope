import { describe, expect, it } from 'vitest';
import { slugify } from './auth.service';

describe('slugify', () => {
  it('lower-cases, strips accents and joins words with dashes', () => {
    expect(slugify('Clínica São José')).toBe('clinica-sao-jose');
    expect(slugify("  Raj Kumar's   workspace!! ")).toBe('raj-kumar-s-workspace');
  });

  it('caps the length and never returns an empty slug', () => {
    expect(slugify('x'.repeat(80))).toHaveLength(40);
    expect(slugify('！？')).toBe('workspace');
  });
});
