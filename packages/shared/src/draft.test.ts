import { describe, expect, it } from 'vitest';
import { checkReadyToSend, type FieldInfo, type RecipientInfo } from './draft';

function person(id: string, role: RecipientInfo['role'] = 'SIGNER'): RecipientInfo {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role,
    status: 'PENDING',
    routingOrder: 1,
    colorIndex: 0,
  };
}

function field(recipientId: string, overrides: Partial<FieldInfo> = {}): FieldInfo {
  return {
    id: `${recipientId}-field`,
    recipientId,
    type: 'SIGNATURE',
    pageNumber: 1,
    required: true,
    ratioX: 0.1,
    ratioY: 0.1,
    ratioWidth: 0.2,
    ratioHeight: 0.05,
    ...overrides,
  };
}

const codes = (draft: Parameters<typeof checkReadyToSend>[0]) =>
  checkReadyToSend(draft).map((issue) => issue.code);

describe('checkReadyToSend', () => {
  it('is ready when every signer has a required field', () => {
    expect(
      checkReadyToSend({
        recipients: [person('a'), person('b', 'APPROVER'), person('c', 'CC')],
        fields: [field('a'), field('b')],
      }),
    ).toEqual([]);
  });

  it('needs somebody on it, and somebody who signs or approves', () => {
    expect(codes({ recipients: [], fields: [] })).toEqual(['NO_RECIPIENTS']);
    expect(codes({ recipients: [person('v', 'VIEWER'), person('c', 'CC')], fields: [] })).toEqual([
      'NO_SIGNERS',
    ]);
  });

  it('names each signer without a required field', () => {
    const issues = checkReadyToSend({
      recipients: [person('a'), person('b')],
      fields: [field('a'), field('b', { required: false })],
    });
    expect(issues).toEqual([
      expect.objectContaining({ code: 'RECIPIENT_HAS_NO_FIELDS', recipientId: 'b' }),
    ]);
  });

  it('flags a field outside the page', () => {
    expect(codes({ recipients: [person('a')], fields: [field('a', { ratioX: 0.95 })] })).toEqual([
      'INVALID_FIELD',
    ]);
  });
});
