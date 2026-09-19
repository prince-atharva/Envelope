import { describe, expect, it } from 'vitest';
import {
  type EnvelopeStatus,
  isOpenEnvelope,
  isTerminalEnvelope,
  OPEN_ENVELOPE_STATUSES,
  TERMINAL_ENVELOPE_STATUSES,
} from './envelopes';

const ALL: EnvelopeStatus[] = [
  'DRAFT',
  'SENT',
  'DELIVERED',
  'PARTIALLY_SIGNED',
  'EXPIRED',
  'COMPLETED',
  'DECLINED',
  'VOIDED',
];

describe('envelope status sets', () => {
  it('knows which statuses are open and which are terminal', () => {
    expect(ALL.filter(isOpenEnvelope)).toEqual([...OPEN_ENVELOPE_STATUSES]);
    expect(ALL.filter(isTerminalEnvelope)).toEqual([...TERMINAL_ENVELOPE_STATUSES]);
  });

  it('never counts a status as both open and terminal, and a draft as neither', () => {
    for (const status of ALL) {
      expect(isOpenEnvelope(status) && isTerminalEnvelope(status)).toBe(false);
    }
    expect(isOpenEnvelope('DRAFT')).toBe(false);
    expect(isTerminalEnvelope('DRAFT')).toBe(false);
  });

  it('treats an expired envelope as paused: neither open nor terminal', () => {
    expect(isOpenEnvelope('EXPIRED')).toBe(false);
    expect(isTerminalEnvelope('EXPIRED')).toBe(false);
  });
});
