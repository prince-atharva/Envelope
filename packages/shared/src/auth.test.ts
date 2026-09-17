import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth';

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
