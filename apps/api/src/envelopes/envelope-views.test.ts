import { describe, expect, it } from 'vitest';
import { progressOf } from './envelope-views';

const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const person = (
  name: string,
  status: 'SENT' | 'VIEWED' | 'SIGNED' | 'DELEGATED' | 'PENDING',
  role: 'SIGNER' | 'CC' = 'SIGNER',
) => ({
  name,
  role,
  status,
  invitedAt: at(1),
  notifiedAt: at(1),
  viewedAt: null,
  signedAt: status === 'SIGNED' ? at(2) : null,
  declinedAt: null,
});

describe('progressOf', () => {
  const envelope = { status: 'PARTIALLY_SIGNED' as const, sentAt: at(0), completedAt: null };

  it('counts who has signed out of the signers, and names who is being waited for', () => {
    const progress = progressOf(envelope, [
      person('Ben', 'SIGNED'),
      person('Sam', 'SENT'),
      person('Copy', 'SENT', 'CC'),
    ]);
    expect(progress).toMatchObject({ signed: 1, total: 2, waitingOn: ['Sam'] });
  });

  it('follows a part to whoever holds it: a delegator is neither signed nor waited for', () => {
    const progress = progressOf(envelope, [
      person('Asha', 'DELEGATED'),
      person('Sam', 'VIEWED'),
      person('Ben', 'SIGNED'),
    ]);
    expect(progress).toMatchObject({ signed: 1, total: 2, waitingOn: ['Sam'] });
  });

  it('is empty for a draft', () => {
    expect(progressOf({ ...envelope, status: 'DRAFT', sentAt: null }, [])).toBeNull();
  });
});
