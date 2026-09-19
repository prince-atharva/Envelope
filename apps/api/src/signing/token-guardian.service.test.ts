import { describe, expect, it } from 'vitest';
import { checkSignerAccess } from './token-guardian.service';

const NOW = new Date('2026-10-01T12:00:00Z');
const LATER = new Date('2026-10-10T00:00:00Z');
const EARLIER = new Date('2026-09-20T00:00:00Z');

const waiting = { status: 'SENT', tokenUsedAt: null, tokenExpiresAt: LATER } as const;
const open = { status: 'SENT', expiresAt: LATER } as const;

describe('checkSignerAccess', () => {
  it('lets a waiting signer in while the envelope is open', () => {
    for (const status of ['SENT', 'DELIVERED', 'PARTIALLY_SIGNED'] as const) {
      expect(checkSignerAccess(waiting, { ...open, status }, NOW)).toBeNull();
    }
    expect(checkSignerAccess({ ...waiting, status: 'VIEWED' }, open, NOW)).toBeNull();
  });

  it('says who closed it: the sender, someone else, or this signer', () => {
    expect(checkSignerAccess(waiting, { ...open, status: 'VOIDED' }, NOW)).toEqual({
      code: 'ENVELOPE_TERMINAL',
      reason: 'VOIDED',
    });
    expect(checkSignerAccess(waiting, { ...open, status: 'DECLINED' }, NOW)).toEqual({
      code: 'ENVELOPE_TERMINAL',
      reason: 'DECLINED',
    });
    expect(
      checkSignerAccess({ ...waiting, status: 'DECLINED' }, { ...open, status: 'DECLINED' }, NOW),
    ).toEqual({ code: 'ENVELOPE_TERMINAL', reason: 'YOU_DECLINED' });
  });

  it('treats a spent token as signed, even before the status changes', () => {
    expect(checkSignerAccess({ ...waiting, status: 'SIGNED' }, open, NOW)).toEqual({
      code: 'TOKEN_ALREADY_USED',
    });
    expect(checkSignerAccess({ ...waiting, tokenUsedAt: EARLIER }, open, NOW)).toEqual({
      code: 'TOKEN_ALREADY_USED',
    });
  });

  it('expires on whichever comes first: the link or the envelope', () => {
    expect(checkSignerAccess({ ...waiting, tokenExpiresAt: EARLIER }, open, NOW)).toEqual({
      code: 'TOKEN_EXPIRED',
      expiredAt: EARLIER,
    });
    expect(checkSignerAccess(waiting, { ...open, expiresAt: EARLIER }, NOW)).toEqual({
      code: 'TOKEN_EXPIRED',
      expiredAt: EARLIER,
    });
    expect(checkSignerAccess(waiting, { ...open, expiresAt: NOW }, NOW)?.code).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('refuses a paused envelope as an expired link, whatever its deadline says', () => {
    const paused = { status: 'EXPIRED', expiresAt: EARLIER } as const;
    expect(checkSignerAccess(waiting, paused, NOW)).toEqual({
      code: 'TOKEN_EXPIRED',
      expiredAt: EARLIER,
    });
    // Extended but not yet resumed: the link still does not work.
    expect(checkSignerAccess(waiting, { ...paused, expiresAt: LATER }, NOW)).toEqual({
      code: 'TOKEN_EXPIRED',
      expiredAt: LATER,
    });
  });

  it('checks in a fixed order: closed, then signed, then expired', () => {
    const signedAndExpired = {
      status: 'SIGNED',
      tokenUsedAt: EARLIER,
      tokenExpiresAt: EARLIER,
    } as const;
    expect(checkSignerAccess(signedAndExpired, open, NOW)?.code).toBe('TOKEN_ALREADY_USED');
    expect(checkSignerAccess(signedAndExpired, { ...open, status: 'EXPIRED' }, NOW)?.code).toBe(
      'TOKEN_ALREADY_USED',
    );
    expect(checkSignerAccess(signedAndExpired, { ...open, status: 'VOIDED' }, NOW)?.code).toBe(
      'ENVELOPE_TERMINAL',
    );
  });

  it('refuses an envelope that should never have a live link', () => {
    for (const status of ['DRAFT', 'COMPLETED'] as const) {
      expect(checkSignerAccess(waiting, { ...open, status }, NOW)).toEqual({
        code: 'ENVELOPE_NOT_OPEN',
      });
    }
  });
});
