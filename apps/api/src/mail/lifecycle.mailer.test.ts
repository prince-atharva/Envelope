import { describe, expect, it } from 'vitest';
import { whyNotSendVoided } from './lifecycle.mailer';

const EMAILED = new Date('2026-09-19T10:00:00Z');

describe('whyNotSendVoided', () => {
  it('tells a signer or approver who was emailed', () => {
    for (const role of ['SIGNER', 'APPROVER'] as const) {
      expect(whyNotSendVoided({ role, notifiedAt: EMAILED }, { status: 'VOIDED' })).toBeNull();
    }
  });

  it('skips anyone never emailed, and roles that get no link', () => {
    expect(whyNotSendVoided({ role: 'SIGNER', notifiedAt: null }, { status: 'VOIDED' })).toBe(
      'never emailed',
    );
    expect(whyNotSendVoided({ role: 'CC', notifiedAt: EMAILED }, { status: 'VOIDED' })).toBe(
      'role receives no link',
    );
  });

  it('sends nothing unless the envelope is cancelled', () => {
    expect(whyNotSendVoided({ role: 'SIGNER', notifiedAt: EMAILED }, { status: 'SENT' })).toBe(
      'envelope not cancelled',
    );
  });
});
