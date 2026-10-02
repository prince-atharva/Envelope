import type { EnvelopeDetail, RecipientDetail } from '@envelope/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientProgress } from './RecipientProgress';

// The hand-over button asks who is signed in: here, the sender.
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'sender', role: 'MEMBER' },
    logout: async () => undefined,
  }),
}));

function person(id: string, emailProblem: RecipientDetail['emailProblem']): RecipientDetail {
  return {
    id,
    name: `Person ${id}`,
    email: `${id}@example.com`,
    role: 'SIGNER',
    status: 'SENT',
    routingOrder: 1,
    colorIndex: 0,
    invitedAt: null,
    notifiedAt: '2026-10-01T10:00:00.000Z',
    lastRemindedAt: null,
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declinedReason: null,
    copySentAt: null,
    moreTimeRequestedAt: null,
    emailProblem,
    delegatedFromId: null,
    delegatedAt: null,
  };
}

function show(recipients: RecipientDetail[]) {
  const envelope = {
    id: 'e-1',
    status: 'SENT',
    sequentialSigning: false,
    expiresAt: null,
    reminderIntervalDays: null,
    owner: { id: 'sender', fullName: 'Sender' },
    recipients,
    versions: [],
  } as unknown as EnvelopeDetail;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecipientProgress envelope={envelope} />
    </QueryClientProvider>,
  );
}

describe('RecipientProgress and undeliverable email', () => {
  afterEach(cleanup);

  it('says which address could not be reached, and only for that person', () => {
    show([person('a', 'BOUNCED'), person('b', null)]);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Email undeliverable: check this address');
    expect(rows[1]?.textContent).not.toContain('undeliverable');
  });

  it('says so when they reported the email as spam', () => {
    show([person('a', 'COMPLAINED')]);
    expect(screen.getByText('They reported your email as spam')).toBeTruthy();
  });

  it('shows nothing extra when nothing is wrong', () => {
    show([person('a', null)]);
    expect(screen.queryByText(/undeliverable|spam/)).toBeNull();
  });
});

describe('RecipientProgress and hosting in person', () => {
  afterEach(cleanup);

  it('offers the sender a way to hand their device to someone whose turn it is', () => {
    show([person('a', null)]);
    expect(screen.getByRole('button', { name: 'Sign in person with Person a' })).toBeTruthy();
  });

  it('offers nothing for someone who has finished', () => {
    show([{ ...person('a', null), status: 'SIGNED' }]);
    expect(screen.queryByRole('button', { name: /Sign in person/ })).toBeNull();
  });
});
