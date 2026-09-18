import type { RecipientInfo } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { moveRecipient } from './recipient-order';

function person(id: string, routingOrder: number): RecipientInfo {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role: 'SIGNER',
    status: 'PENDING',
    routingOrder,
    colorIndex: 0,
  };
}

describe('moveRecipient', () => {
  it('swaps two neighbours with two updates', () => {
    const list = [person('a', 1), person('b', 2), person('c', 3)];
    expect(moveRecipient(list, 'b', 'up')).toEqual([
      { recipientId: 'b', routingOrder: 1 },
      { recipientId: 'a', routingOrder: 2 },
    ]);
    expect(moveRecipient(list, 'b', 'down')).toEqual([
      { recipientId: 'c', routingOrder: 2 },
      { recipientId: 'b', routingOrder: 3 },
    ]);
  });

  it('closes gaps left by a removal, and skips anyone already numbered right', () => {
    const list = [person('a', 1), person('b', 3), person('c', 5)];
    // New order a, c, b: c becomes 2, and b is already 3.
    expect(moveRecipient(list, 'c', 'up')).toEqual([{ recipientId: 'c', routingOrder: 2 }]);
    expect(moveRecipient(list, 'a', 'down')).toEqual([
      { recipientId: 'b', routingOrder: 1 },
      { recipientId: 'a', routingOrder: 2 },
      { recipientId: 'c', routingOrder: 3 },
    ]);
  });

  it('separates people who share a number', () => {
    const list = [person('a', 1), person('b', 1)];
    expect(moveRecipient(list, 'b', 'up')).toEqual([{ recipientId: 'a', routingOrder: 2 }]);
  });

  it('does nothing at either end or for an unknown person', () => {
    const list = [person('a', 1), person('b', 2)];
    expect(moveRecipient(list, 'a', 'up')).toEqual([]);
    expect(moveRecipient(list, 'b', 'down')).toEqual([]);
    expect(moveRecipient(list, 'zzz', 'up')).toEqual([]);
  });
});
