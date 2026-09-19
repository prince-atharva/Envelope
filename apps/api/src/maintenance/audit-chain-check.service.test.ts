import { describe, expect, it } from 'vitest';
import { computeEventHash, type StoredChainEvent } from '../audit/audit-chain';
import { checkEnvelope } from './audit-chain-check.service';

/** A valid chain of the given actions. */
function chain(...actions: string[]): StoredChainEvent[] {
  const events: StoredChainEvent[] = [];
  for (const [index, action] of actions.entries()) {
    const prevHash = events.at(-1)?.eventHash ?? null;
    const fields = {
      envelopeId: 'env-1',
      sequence: index + 1,
      action,
      timestamp: new Date(Date.UTC(2026, 8, 19, 12, index)),
      recipientId: null,
      actorUserId: null,
      ipAddress: 'system',
      userAgent: 'test',
      metadata: null,
    };
    events.push({
      ...fields,
      id: `ev-${index + 1}`,
      prevHash,
      eventHash: computeEventHash(prevHash, fields),
    });
  }
  return events;
}

describe('checkEnvelope', () => {
  it('passes an intact chain whose status has its event', () => {
    const events = chain('ENVELOPE_CREATED', 'ENVELOPE_SENT', 'ENVELOPE_VOIDED');
    expect(checkEnvelope({ id: 'env-1', status: 'VOIDED' }, events)).toBeNull();
    expect(checkEnvelope({ id: 'env-1', status: 'DRAFT' }, [])).toBeNull();
  });

  it('names the first altered event', () => {
    const events = chain('ENVELOPE_CREATED', 'ENVELOPE_SENT', 'EMAIL_SENT');
    const second = events[1];
    if (second) second.ipAddress = '203.0.113.9';
    expect(checkEnvelope({ id: 'env-1', status: 'SENT' }, events)).toEqual({
      envelopeId: 'env-1',
      reason: 'hash mismatch',
      sequence: 2,
    });
  });

  it('catches a status whose event was cut from the end of a valid chain', () => {
    const events = chain('ENVELOPE_CREATED', 'ENVELOPE_SENT');
    for (const [status, action] of [
      ['COMPLETED', 'ENVELOPE_COMPLETED'],
      ['EXPIRED', 'ENVELOPE_EXPIRED'],
      ['DECLINED', 'RECIPIENT_DECLINED'],
    ]) {
      expect(checkEnvelope({ id: 'env-1', status: status ?? '' }, events)?.reason).toBe(
        `missing ${action}`,
      );
    }
  });
});
