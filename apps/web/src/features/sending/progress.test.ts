import type { RecipientDetail } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { progressOf, reminderState, summariseSend } from './progress';

function person(id: string, overrides: Partial<RecipientDetail> = {}): RecipientDetail {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role: 'SIGNER',
    status: 'PENDING',
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
    ...overrides,
  };
}

const NOW = new Date('2026-10-01T12:00:00Z').getTime();
const open = { status: 'SENT' as const, sequentialSigning: false, versions: [] };

describe('summariseSend', () => {
  const team = [
    person('a', { routingOrder: 1 }),
    person('b', { routingOrder: 2 }),
    person('c', { routingOrder: 3, role: 'CC' }),
  ];

  it('emails every signer now when not in order', () => {
    const summary = summariseSend(team, false);
    expect(summary.now.map((r) => r.id)).toEqual(['a', 'b']);
    expect(summary.later).toEqual([]);
    expect(summary.copies.map((r) => r.id)).toEqual(['c']);
  });

  it('emails the first person now and the rest later when in order', () => {
    const summary = summariseSend(team, true);
    expect(summary.now.map((r) => r.id)).toEqual(['a']);
    expect(summary.later.map((r) => r.id)).toEqual(['b']);
  });
});

describe('progressOf', () => {
  it('reads each stage in plain words', () => {
    expect(progressOf(person('a'), 'SENT').label).toBe('Waiting for their turn');
    expect(progressOf(person('a', { status: 'SENT' }), 'SENT').label).toBe('Sending email…');
    expect(
      progressOf(person('a', { status: 'SENT', notifiedAt: '2026-10-01T09:00:00Z' }), 'SENT'),
    ).toEqual({ label: 'Email sent', tone: 'active', at: '2026-10-01T09:00:00Z' });
    expect(progressOf(person('a', { status: 'VIEWED' }), 'SENT').label).toBe('Opened');
    expect(progressOf(person('a', { status: 'SIGNED' }), 'SENT').label).toBe('Signed');
    expect(progressOf(person('a', { status: 'SIGNED', role: 'APPROVER' }), 'SENT').label).toBe(
      'Approved',
    );
    expect(progressOf(person('a', { status: 'DECLINED' }), 'DECLINED').tone).toBe('stopped');
    expect(progressOf(person('a', { role: 'CC' }), 'SENT').label).toBe('Gets the finished copy');
    expect(progressOf(person('a'), 'DECLINED').label).toBe('Not reached');
    expect(
      progressOf(person('a', { role: 'CC', copySentAt: '2026-10-02T09:00:00Z' }), 'COMPLETED'),
    ).toEqual({ label: 'Finished copy sent', tone: 'done', at: '2026-10-02T09:00:00Z' });
  });
});

describe('reminderState', () => {
  it('allows a reminder for someone waiting on their turn', () => {
    const waiting = person('a', { status: 'SENT', notifiedAt: '2026-10-01T09:00:00Z' });
    expect(reminderState(waiting, [waiting], open, NOW)).toEqual({ can: true });
  });

  it('offers no reminder once the deadline has passed or the envelope is paused', () => {
    const waiting = person('a', { status: 'SENT', notifiedAt: '2026-10-01T09:00:00Z' });
    const overdue = { ...open, expiresAt: '2026-10-01T09:30:00Z' };
    expect(reminderState(waiting, [waiting], overdue, NOW)).toEqual({
      can: false,
      reason: 'closed',
    });
    const paused = { ...open, status: 'EXPIRED' as const };
    expect(reminderState(waiting, [waiting], paused, NOW)).toEqual({
      can: false,
      reason: 'closed',
    });
  });

  it('waits a day after the last reminder', () => {
    const reminded = person('a', {
      status: 'VIEWED',
      notifiedAt: '2026-10-01T09:00:00Z',
      lastRemindedAt: '2026-10-01T10:00:00Z',
    });
    expect(reminderState(reminded, [reminded], open, NOW)).toEqual({
      can: false,
      reason: 'too-soon',
      availableAt: new Date('2026-10-02T10:00:00Z').getTime(),
    });
  });

  it('refuses people who are finished, not yet due, or on a closed envelope', () => {
    const first = person('a', { status: 'SENT', routingOrder: 1 });
    const second = person('b', { routingOrder: 2 });
    const inOrder = { status: 'SENT' as const, sequentialSigning: true, versions: [] };
    expect(reminderState(second, [first, second], inOrder, NOW)).toEqual({
      can: false,
      reason: 'not-their-turn',
    });
    const signed = person('c', { status: 'SIGNED' });
    expect(reminderState(signed, [signed], open, NOW)).toEqual({ can: false, reason: 'finished' });
    expect(reminderState(first, [first], { ...open, status: 'DECLINED' }, NOW)).toEqual({
      can: false,
      reason: 'closed',
    });
  });

  it('keeps the turn with a signature until it is stamped, as the server does', () => {
    const first = person('a', { status: 'SIGNED', routingOrder: 1 });
    const second = person('b', { status: 'PENDING', routingOrder: 2 });
    const unstamped = {
      status: 'PARTIALLY_SIGNED' as const,
      sequentialSigning: true,
      versions: [],
    };
    expect(reminderState(second, [first, second], unstamped, NOW)).toEqual({
      can: false,
      reason: 'not-their-turn',
    });
    // Once it is stamped, the second person is invited, and can be reminded.
    const invited = { ...second, status: 'SENT' as const, notifiedAt: '2026-09-29T09:00:00Z' };
    const stamped = {
      ...unstamped,
      versions: [{ createdByRecipientId: null }, { createdByRecipientId: 'a' }],
    };
    expect(reminderState(invited, [first, invited], stamped, NOW)).toEqual({ can: true });
    // Invited already, but the version before them not recorded yet: still not their turn.
    expect(reminderState(invited, [first, invited], unstamped, NOW)).toEqual({
      can: false,
      reason: 'not-their-turn',
    });
  });
});
