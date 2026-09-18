import { describe, expect, it } from 'vitest';
import { MAX_SIGNATURE_IMAGE_BYTES } from './limits';
import {
  adoptSignatureSchema,
  consentSchema,
  currentRoutingGroup,
  declineSchema,
  nextReminderAt,
  orderFieldsForSigning,
  PNG_DATA_URL_PREFIX,
  type RoutingRecipient,
  recipientsDueInvitation,
  SIGNING_TOKEN_PATTERN,
  submitSigningSchema,
} from './signing';

function person(
  id: string,
  routingOrder: number,
  status: RoutingRecipient['status'] = 'PENDING',
  role: RoutingRecipient['role'] = 'SIGNER',
): RoutingRecipient {
  return { id, routingOrder, status, role };
}

const ids = (list: readonly RoutingRecipient[]) => list.map((r) => r.id);

describe('SIGNING_TOKEN_PATTERN', () => {
  it('accepts 64 lower-case hex characters and nothing else', () => {
    expect(SIGNING_TOKEN_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(SIGNING_TOKEN_PATTERN.test('a'.repeat(63))).toBe(false);
    expect(SIGNING_TOKEN_PATTERN.test('A'.repeat(64))).toBe(false);
    expect(SIGNING_TOKEN_PATTERN.test(`${'a'.repeat(63)}g`)).toBe(false);
  });
});

describe('orderFieldsForSigning', () => {
  it('goes page by page, top to bottom, then left to right', () => {
    const at = (id: string, pageNumber: number, ratioY: number, ratioX = 0.1) => ({
      id,
      pageNumber,
      ratioX,
      ratioY,
      ratioWidth: 0.1,
      ratioHeight: 0.05,
    });
    const ordered = orderFieldsForSigning([
      at('p2-top', 2, 0.1),
      at('p1-bottom', 1, 0.9),
      at('p1-top-right', 1, 0.2, 0.6),
      at('p1-top-left', 1, 0.2, 0.1),
    ]);
    expect(ordered.map((f) => f.id)).toEqual([
      'p1-top-left',
      'p1-top-right',
      'p1-bottom',
      'p2-top',
    ]);
  });
});

describe('routing', () => {
  it('invites every signer at once when the order is not sequential', () => {
    const list = [person('a', 1), person('b', 2), person('c', 3)];
    expect(ids(recipientsDueInvitation(list, false))).toEqual(['a', 'b', 'c']);
  });

  it('invites only the first group when signing one after another', () => {
    const list = [person('a', 2), person('b', 1), person('c', 3)];
    expect(ids(recipientsDueInvitation(list, true))).toEqual(['b']);
  });

  it('treats equal numbers as one group that signs in parallel', () => {
    const list = [person('a', 1), person('b', 1), person('c', 2)];
    expect(ids(recipientsDueInvitation(list, true))).toEqual(['a', 'b']);
  });

  it('moves to the next group only once the whole group has signed', () => {
    const halfway = [person('a', 1, 'SIGNED'), person('b', 1, 'VIEWED'), person('c', 2)];
    expect(ids(currentRoutingGroup(halfway, true))).toEqual(['b']);
    expect(recipientsDueInvitation(halfway, true)).toEqual([]);

    const done = [person('a', 1, 'SIGNED'), person('b', 1, 'SIGNED'), person('c', 2)];
    expect(ids(recipientsDueInvitation(done, true))).toEqual(['c']);
  });

  it('never re-invites someone already emailed', () => {
    const list = [person('a', 1, 'SENT'), person('b', 2)];
    expect(recipientsDueInvitation(list, false).map((r) => r.id)).toEqual(['b']);
    expect(ids(currentRoutingGroup(list, false))).toEqual(['a', 'b']);
  });

  it('skips viewers and copy recipients, who get the finished document instead', () => {
    const list = [person('viewer', 1, 'PENDING', 'VIEWER'), person('cc', 1, 'PENDING', 'CC')];
    expect(recipientsDueInvitation(list, true)).toEqual([]);
    const mixed = [...list, person('signer', 2), person('approver', 2, 'PENDING', 'APPROVER')];
    expect(ids(recipientsDueInvitation(mixed, true))).toEqual(['signer', 'approver']);
  });

  it('is empty once everyone has finished', () => {
    const list = [person('a', 1, 'SIGNED'), person('b', 2, 'SIGNED')];
    expect(currentRoutingGroup(list, true)).toEqual([]);
  });
});

describe('nextReminderAt', () => {
  const at = (iso: string) => new Date(iso);

  it('allows the first reminder at once', () => {
    expect(nextReminderAt({ notifiedAt: at('2026-10-01T09:00:00Z'), lastRemindedAt: null })).toBe(
      0,
    );
    expect(nextReminderAt({ notifiedAt: null, lastRemindedAt: null })).toBe(0);
  });

  it('waits a day after a reminder, and accepts ISO strings from the API', () => {
    expect(
      nextReminderAt({
        notifiedAt: '2026-10-01T09:00:00Z',
        lastRemindedAt: '2026-10-02T09:00:00Z',
      }),
    ).toBe(at('2026-10-03T09:00:00Z').getTime());
  });

  it('lets a reminder that never arrived be retried after ten minutes', () => {
    expect(nextReminderAt({ notifiedAt: null, lastRemindedAt: at('2026-10-02T09:00:00Z') })).toBe(
      at('2026-10-02T09:10:00Z').getTime(),
    );
  });
});

describe('request schemas', () => {
  it('requires an explicit agreement and the hash of the text shown', () => {
    const hash = 'b'.repeat(64);
    expect(consentSchema.safeParse({ agreed: true, consentTextHash: hash }).success).toBe(true);
    expect(consentSchema.safeParse({ agreed: false, consentTextHash: hash }).success).toBe(false);
    expect(consentSchema.safeParse({ agreed: true }).success).toBe(false);
  });

  it('accepts a PNG data URL up to the size cap and rejects JPEG', () => {
    const png = (bytes: number) => PNG_DATA_URL_PREFIX + 'A'.repeat(Math.ceil(bytes / 3) * 4);
    const base = { kind: 'SIGNATURE', method: 'DRAWN' } as const;
    expect(adoptSignatureSchema.safeParse({ ...base, image: png(1000) }).success).toBe(true);
    expect(
      adoptSignatureSchema.safeParse({ ...base, image: png(MAX_SIGNATURE_IMAGE_BYTES) }).success,
    ).toBe(true);
    expect(
      adoptSignatureSchema.safeParse({ ...base, image: png(MAX_SIGNATURE_IMAGE_BYTES + 3) })
        .success,
    ).toBe(false);
    expect(
      adoptSignatureSchema.safeParse({ ...base, image: 'data:image/jpeg;base64,AAAA' }).success,
    ).toBe(false);
  });

  it('requires a reason to decline', () => {
    expect(declineSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(declineSchema.parse({ reason: '  Wrong amount  ' })).toEqual({ reason: 'Wrong amount' });
  });

  it('rejects unknown keys in a submission, such as a recipient id', () => {
    expect(
      submitSigningSchema.safeParse({
        fields: [{ id: '0b7c7a86-5a0e-4a0b-9f3e-2f1d6c0e8a11', value: 'x' }],
        recipientId: '5d1f2e3a-8b4c-4d6e-9a7b-1c2d3e4f5a6b',
      }).success,
    ).toBe(false);
  });
});
