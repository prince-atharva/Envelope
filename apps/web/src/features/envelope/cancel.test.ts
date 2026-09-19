import type { RecipientDetail } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { cancelModeFor, toldOfCancellation, wasDiscarded } from './cancel';

function person(overrides: Partial<RecipientDetail>): RecipientDetail {
  return {
    id: crypto.randomUUID(),
    name: 'Person',
    email: 'person@example.com',
    role: 'SIGNER',
    status: 'SENT',
    routingOrder: 1,
    colorIndex: 0,
    invitedAt: null,
    notifiedAt: null,
    lastRemindedAt: null,
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declinedReason: null,
    copySentAt: null,
    moreTimeRequestedAt: null,
    ...overrides,
  };
}

describe('cancelModeFor', () => {
  it('discards a draft and cancels anything sent and unfinished', () => {
    expect(cancelModeFor('DRAFT')).toBe('discard');
    for (const status of ['SENT', 'DELIVERED', 'PARTIALLY_SIGNED', 'EXPIRED'] as const) {
      expect(cancelModeFor(status)).toBe('cancel');
    }
  });

  it('offers nothing once it is finished', () => {
    for (const status of ['COMPLETED', 'DECLINED', 'VOIDED'] as const) {
      expect(cancelModeFor(status)).toBeNull();
    }
  });
});

describe('toldOfCancellation', () => {
  it('names signers and approvers who were emailed, and nobody else', () => {
    const emailed = person({ name: 'Emailed', notifiedAt: '2026-09-19T10:00:00Z' });
    const approver = person({ role: 'APPROVER', notifiedAt: '2026-09-19T10:00:00Z' });
    const waiting = person({ name: 'Waiting', status: 'PENDING' });
    const copy = person({ role: 'CC', notifiedAt: '2026-09-19T10:00:00Z' });
    expect(toldOfCancellation([emailed, approver, waiting, copy])).toEqual([emailed, approver]);
  });
});

describe('wasDiscarded', () => {
  it('tells a thrown-away draft from a cancelled envelope', () => {
    expect(wasDiscarded({ status: 'VOIDED', sentAt: null })).toBe(true);
    expect(wasDiscarded({ status: 'VOIDED', sentAt: '2026-09-19T10:00:00Z' })).toBe(false);
    expect(wasDiscarded({ status: 'DRAFT', sentAt: null })).toBe(false);
  });
});
