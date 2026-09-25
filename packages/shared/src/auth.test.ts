import { describe, expect, it } from 'vitest';
import { hasAtLeast, loginSchema, ROLE_RANK, registerSchema, USER_ROLES } from './auth';

describe('registerSchema', () => {
  const valid = {
    fullName: '  Raj Kumar ',
    email: '  Raj.Kumar@Example.COM ',
    password: 'twelve chars',
  };

  it('normalises the name and email', () => {
    expect(registerSchema.parse(valid)).toEqual({
      fullName: 'Raj Kumar',
      email: 'raj.kumar@example.com',
      password: 'twelve chars',
    });
  });

  it('requires at least 12 password characters', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'elevenchars' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['password'],
      message: 'Use at least 12 characters',
    });
  });

  it('rejects unknown fields', () => {
    expect(registerSchema.safeParse({ ...valid, role: 'OWNER' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not apply the password policy, so it cannot be probed', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('hasAtLeast (docs/17 step 5)', () => {
  it('admits a role at or above the minimum', () => {
    expect(hasAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(hasAtLeast('ADMIN', 'ADMIN')).toBe(true);
    expect(hasAtLeast('MEMBER', 'ADMIN')).toBe(false);
  });

  it('every role compares consistently with its own rank', () => {
    for (const a of USER_ROLES) {
      for (const b of USER_ROLES) {
        expect(hasAtLeast(a, b)).toBe(ROLE_RANK[a] >= ROLE_RANK[b]);
      }
    }
  });

  it('ranks OWNER above ADMIN above MEMBER', () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MEMBER);
  });
});
