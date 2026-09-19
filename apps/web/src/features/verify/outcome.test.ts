import type { VerifyResponse } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { describeOutcome } from './outcome';

const chain = [0, 1, 2].map((n) => ({
  versionNumber: n,
  sha256: String(n).repeat(64),
  signedBy: n ? `Signer ${n}` : null,
  isFinal: false,
  createdAt: '2026-09-19T10:00:00Z',
}));

function match(
  versionNumber: number,
  isFinal: boolean,
  status: 'COMPLETED' | 'PARTIALLY_SIGNED' | 'DECLINED' = 'COMPLETED',
): VerifyResponse {
  return {
    verified: true,
    documentHash: 'a'.repeat(64),
    envelopeId: 'e1',
    title: 'Lease',
    status,
    completedAt: null,
    matched: { versionNumber, isFinal },
    signers: [],
    versionChain: [
      ...chain,
      { ...chain[0], versionNumber: 3, signedBy: null, isFinal: true } as (typeof chain)[number],
    ],
    events: [],
  };
}

describe('describeOutcome', () => {
  it('confirms the sealed document', () => {
    expect(describeOutcome(match(3, true))).toMatchObject({
      tone: 'verified',
      title: 'This is the sealed, finished document',
    });
  });

  it('places an in-progress copy in the chain and says what became of it', () => {
    const later = describeOutcome(match(1, false));
    expect(later.tone).toBe('partial');
    expect(later.body).toContain('version 1 of 2');
    expect(later.body).toContain('the sealed document is the one to keep');
    expect(describeOutcome(match(1, false, 'PARTIALLY_SIGNED')).title).toBe(
      'This document is still being signed',
    );
    expect(describeOutcome(match(2, false, 'DECLINED')).body).toContain(
      'no finished document exists',
    );
  });

  it('never calls a file fake, and says both things a mismatch can mean', () => {
    const none = describeOutcome({
      verified: false,
      documentHash: 'b'.repeat(64),
      reason: 'NO_MATCHING_DOCUMENT',
      detail: '',
    });
    expect(none.tone).toBe('unknown');
    expect(none.body).toContain('Either it was not signed with this service');
    expect(none.body).toContain('or it has been changed since it was signed');
    expect(`${none.title} ${none.body}`.toLowerCase()).not.toMatch(/fake|forged|invalid/);
  });

  it('says an unsigned original is only that', () => {
    expect(
      describeOutcome({
        verified: false,
        documentHash: 'c'.repeat(64),
        reason: 'UNSIGNED_ORIGINAL',
        detail: '',
      }).title,
    ).toBe('This is an unsigned original');
  });
});
