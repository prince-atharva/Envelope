import { describe, expect, it } from 'vitest';
import { roleKindLabel, templateFacts } from './templates-presentation';

describe('templateFacts', () => {
  it('counts pages, roles and fields, singular and plural', () => {
    expect(templateFacts({ pageCount: 1, roleCount: 1, fieldCount: 1 })).toBe(
      '1 page · 1 role · 1 field',
    );
    expect(templateFacts({ pageCount: 12, roleCount: 2, fieldCount: 0 })).toBe(
      '12 pages · 2 roles · 0 fields',
    );
  });
});

describe('roleKindLabel', () => {
  it('says what each kind of role does', () => {
    expect(roleKindLabel('SIGNER')).toBe('Signs');
    expect(roleKindLabel('CC')).toBe('Gets a copy');
  });
});
