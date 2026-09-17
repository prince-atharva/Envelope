import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return current;
  });
}

export interface ChainedEventFields {
  envelopeId: string;
  sequence: number;
  action: string;
  timestamp: Date;
  recipientId: string | null;
  actorUserId: string | null;
  ipAddress: string;
  userAgent: string;
  metadata: unknown;
}

/**
 * eventHash = SHA-256(prevHash | action | timestamp | payload), per docs/05
 * ("Audit Hash Chain"). Changing any field of any event breaks every hash after it.
 */
export function computeEventHash(prevHash: string | null, event: ChainedEventFields): string {
  const payload = canonicalJson({
    envelopeId: event.envelopeId,
    sequence: event.sequence,
    recipientId: event.recipientId,
    actorUserId: event.actorUserId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    metadata: event.metadata ?? null,
  });
  return createHash('sha256')
    .update([prevHash ?? '', event.action, event.timestamp.toISOString(), payload].join('|'))
    .digest('hex');
}

export interface StoredChainEvent extends ChainedEventFields {
  id: string;
  prevHash: string | null;
  eventHash: string;
}

export type ChainVerification =
  | { valid: true; events: number }
  | { valid: false; events: number; brokenAt: { id: string; sequence: number; reason: string } };

/** Walks an envelope's events in sequence order and checks every link and hash. */
export function verifyChain(events: StoredChainEvent[]): ChainVerification {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let previous: StoredChainEvent | undefined;
  for (const event of ordered) {
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    const broken = (reason: string): ChainVerification => ({
      valid: false,
      events: ordered.length,
      brokenAt: { id: event.id, sequence: event.sequence, reason },
    });
    if (event.sequence !== expectedSequence) return broken('sequence gap');
    if (event.prevHash !== (previous?.eventHash ?? null)) return broken('prevHash mismatch');
    if (computeEventHash(event.prevHash, event) !== event.eventHash) return broken('hash mismatch');
    previous = event;
  }
  return { valid: true, events: ordered.length };
}
