import { describe, expect, it } from 'vitest';
import {
  confirmTwoFactorSchema,
  enableTwoFactorSchema,
  isMfaChallenge,
  isMfaEnrolmentRequired,
  secondFactorCodeSchema,
  setTwoFactorPolicySchema,
  totpCodeSchema,
  twoFactorChallengeSchema,
} from './two-factor';

describe('two-factor schemas', () => {
  it('takes a six-digit authenticator code, trimmed', () => {
    expect(totpCodeSchema.parse(' 123456 ')).toBe('123456');
    for (const bad of ['12345', '1234567', 'abcdef', '123 456', '']) {
      expect(totpCodeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('takes either an authenticator code or a recovery code, lower-cased', () => {
    expect(secondFactorCodeSchema.parse('123456')).toBe('123456');
    expect(secondFactorCodeSchema.parse(' ABCDE-23456 ')).toBe('abcde-23456');
    expect(secondFactorCodeSchema.parse('abcde23456')).toBe('abcde23456');
    // i, l, o and u are not in the alphabet.
    for (const bad of ['abcdi-23456', 'abcde-2345', 'abcde-234567', '12345a']) {
      expect(secondFactorCodeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('requires a password and a code to turn it off, and rejects unknown fields', () => {
    expect(confirmTwoFactorSchema.safeParse({ password: 'x', code: '123456' }).success).toBe(true);
    expect(confirmTwoFactorSchema.safeParse({ code: '123456' }).success).toBe(false);
    expect(
      confirmTwoFactorSchema.safeParse({ password: 'x', code: '123456', extra: 1 }).success,
    ).toBe(false);
  });

  it('checks the other request bodies', () => {
    expect(enableTwoFactorSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(
      twoFactorChallengeSchema.safeParse({ challengeToken: 't', code: '123456' }).success,
    ).toBe(true);
    expect(twoFactorChallengeSchema.safeParse({ code: '123456' }).success).toBe(false);
    expect(setTwoFactorPolicySchema.safeParse({ required: true }).success).toBe(true);
    expect(setTwoFactorPolicySchema.safeParse({ required: 'yes' }).success).toBe(false);
  });

  it('tells the two half-signed-in answers apart from a session', () => {
    expect(isMfaChallenge({ mfaRequired: true, challengeToken: 't' })).toBe(true);
    expect(isMfaEnrolmentRequired({ mfaEnrolmentRequired: true, challengeToken: 't' })).toBe(true);
    expect(isMfaChallenge({ mfaEnrolmentRequired: true, challengeToken: 't' })).toBe(false);
  });
});
