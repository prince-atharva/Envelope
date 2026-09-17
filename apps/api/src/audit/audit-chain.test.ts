import { describe, expect, it } from 'vitest';
import { canonicalJson, computeEventHash, type StoredChainEvent, verifyChain } from './audit-chain';

function nth(events: StoredChainEvent[], index: number): StoredChainEvent {
  const event = events[index];
  if (!event) throw new Error(`no event at index ${index}`);
  return event;
}

function buildChain(count: number): StoredChainEvent[] {
  const events: StoredChainEvent[] = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const prevHash = events.at(-1)?.eventHash ?? null;
    const fields = {
      envelopeId: 'e0000000-0000-4000-8000-000000000001',
      sequence,
      action: sequence === 1 ? 'ENVELOPE_CREATED' : 'ENVELOPE_VIEWED',
      timestamp: new Date(Date.UTC(2026, 8, 17, 12, 0, sequence)),
      recipientId: null,
      actorUserId: 'u0000000-0000-4000-8000-000000000001',
      ipAddress: '203.0.113.9',
      userAgent: 'test',
      metadata: { sha256: 'a'.repeat(64), pageCount: 12, nested: { b: 2, a: 1 } },
    };
    events.push({
      id: `event-${sequence}`,
      ...fields,
      prevHash,
      eventHash: computeEventHash(prevHash, fields),
    });
  }
  return events;
}

describe('audit hash chain', () => {
  it('accepts an intact chain, whatever order the rows come back in', () => {
    const chain = buildChain(3);
    expect(verifyChain([nth(chain, 2), nth(chain, 0), nth(chain, 1)])).toEqual({
      valid: true,
      events: 3,
    });
  });

  it('does not depend on the key order of stored metadata (jsonb reorders keys)', () => {
    const chain = buildChain(2);
    const reordered = chain.map((event) => ({
      ...event,
      metadata: { nested: { a: 1, b: 2 }, pageCount: 12, sha256: 'a'.repeat(64) },
    }));
    expect(verifyChain(reordered).valid).toBe(true);
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it('points at the exact event that was altered', () => {
    const chain = buildChain(3);
    chain[1] = { ...nth(chain, 1), ipAddress: '198.51.100.1' };
    expect(verifyChain(chain)).toEqual({
      valid: false,
      events: 3,
      brokenAt: { id: 'event-2', sequence: 2, reason: 'hash mismatch' },
    });
  });

  it('detects a deleted event', () => {
    const chain = buildChain(3);
    expect(verifyChain([nth(chain, 0), nth(chain, 2)])).toMatchObject({
      valid: false,
      brokenAt: { sequence: 3, reason: 'sequence gap' },
    });
  });

  it('detects an event re-linked to the wrong predecessor', () => {
    const chain = buildChain(3);
    const fields = { ...nth(chain, 2), prevHash: nth(chain, 0).eventHash };
    chain[2] = { ...fields, eventHash: computeEventHash(fields.prevHash, fields) };
    expect(verifyChain(chain)).toMatchObject({
      valid: false,
      brokenAt: { sequence: 3, reason: 'prevHash mismatch' },
    });
  });
});
