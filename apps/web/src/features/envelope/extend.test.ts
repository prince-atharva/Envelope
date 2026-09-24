import type { RecipientDetail } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { names } from '../../lib/labels';
import { canExtend, freshLinkFor, stillToSign } from './extend';

function person(name: string, overrides: Partial<RecipientDetail> = {}): RecipientDetail {
  return {
    id: name,
    name,
    email: `${name.toLowerCase()}@example.com`,
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

describe('canExtend', () => {
  it('allows more time while open and once paused, never when finished or a draft', () => {
    for (const status of ['SENT', 'DELIVERED', 'PARTIALLY_SIGNED', 'EXPIRED'] as const) {
      expect(canExtend(status)).toBe(true);
    }
    for (const status of ['DRAFT', 'COMPLETED', 'DECLINED', 'VOIDED'] as const) {
      expect(canExtend(status)).toBe(false);
    }
  });
});

describe('who an extension reaches', () => {
  const team = [
    person('Signed', { status: 'SIGNED' }),
    person('Opened', { status: 'VIEWED' }),
    person('Emailed', { role: 'APPROVER' }),
    person('Later', { status: 'PENDING' }),
    person('Copy', { role: 'CC' }),
  ];

  it('emails a fresh link to whoever holds the turn', () => {
    expect(names(freshLinkFor(team).map((person) => person.name))).toBe('Opened and Emailed');
  });

  it('lists everyone still to sign, including those whose turn has not come', () => {
    expect(names(stillToSign(team).map((person) => person.name))).toBe('Opened, Emailed and Later');
  });
});
