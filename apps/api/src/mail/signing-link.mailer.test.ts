import { describe, expect, it } from 'vitest';
import { whyNotSend } from './signing-link.mailer';

const NOW = new Date('2026-10-01T12:00:00Z');
const LATER = new Date('2026-10-10T00:00:00Z');

const invited = { role: 'SIGNER', status: 'SENT', tokenUsedAt: null } as const;
const open = { status: 'SENT', expiresAt: LATER } as const;

describe('whyNotSend', () => {
  it('sends to an invited signer or approver while the envelope is open', () => {
    expect(whyNotSend(invited, open, NOW)).toBeNull();
    expect(whyNotSend({ ...invited, role: 'APPROVER', status: 'VIEWED' }, open, NOW)).toBeNull();
    expect(whyNotSend(invited, { ...open, status: 'PARTIALLY_SIGNED' }, NOW)).toBeNull();
  });

  it('skips once the envelope is closed or expired', () => {
    for (const status of ['DRAFT', 'COMPLETED', 'DECLINED', 'VOIDED'] as const) {
      expect(whyNotSend(invited, { ...open, status }, NOW)).toBe('envelope closed');
    }
    expect(whyNotSend(invited, { ...open, expiresAt: NOW }, NOW)).toBe('envelope expired');
  });

  it('skips people who are not due a link', () => {
    expect(whyNotSend({ ...invited, status: 'PENDING' }, open, NOW)).toBe('not their turn');
    expect(whyNotSend({ ...invited, status: 'SIGNED' }, open, NOW)).toBe('already finished');
    expect(whyNotSend({ ...invited, tokenUsedAt: NOW }, open, NOW)).toBe('already finished');
    expect(whyNotSend({ ...invited, role: 'CC' }, open, NOW)).toBe('role receives no link');
  });
});
