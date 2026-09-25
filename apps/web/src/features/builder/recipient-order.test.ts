import type { RecipientInfo } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { isGroupedWithPrevious, moveRecipient, toggleGroupedWithPrevious } from './recipient-order';

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

// Mixed routing (docs/17 step 11): a tied routingOrder is "signs at the same
// time as the person above". The first person is never grouped.
describe('isGroupedWithPrevious', () => {
  it('is false for the first person, whatever their number', () => {
    expect(isGroupedWithPrevious([person('a', 1)], 'a')).toBe(false);
  });

  it('is true only when the number matches the person directly above', () => {
    const list = [person('a', 1), person('b', 1), person('c', 2)];
    expect(isGroupedWithPrevious(list, 'b')).toBe(true);
    expect(isGroupedWithPrevious(list, 'c')).toBe(false);
  });

  it('is false for an unknown person', () => {
    expect(isGroupedWithPrevious([person('a', 1)], 'zzz')).toBe(false);
  });
});

describe('toggleGroupedWithPrevious', () => {
  it('groups the second person with the first', () => {
    const list = [person('a', 1), person('b', 2)];
    expect(toggleGroupedWithPrevious(list, 'b')).toEqual([{ recipientId: 'b', routingOrder: 1 }]);
  });

  it('ungroups a pair and renumbers everyone after with no gap', () => {
    const list = [person('a', 1), person('b', 1), person('c', 2)];
    expect(toggleGroupedWithPrevious(list, 'b')).toEqual([
      { recipientId: 'b', routingOrder: 2 },
      { recipientId: 'c', routingOrder: 3 },
    ]);
  });

  it('grouping the middle of a three-person sequential order shifts only what follows', () => {
    const list = [person('a', 1), person('b', 2), person('c', 3)];
    expect(toggleGroupedWithPrevious(list, 'b')).toEqual([
      { recipientId: 'b', routingOrder: 1 },
      { recipientId: 'c', routingOrder: 2 },
    ]);
  });

  it('a three-way group ungroups from the middle without disturbing the last pair', () => {
    const list = [person('a', 1), person('b', 1), person('c', 1)];
    // b leaves the group: a stays 1, b becomes 2, and c — still tied to what
    // was b's old number — moves with it, to 2 as well.
    expect(toggleGroupedWithPrevious(list, 'b')).toEqual([
      { recipientId: 'b', routingOrder: 2 },
      { recipientId: 'c', routingOrder: 2 },
    ]);
  });

  it('does nothing for the first person or an unknown one', () => {
    const list = [person('a', 1), person('b', 2)];
    expect(toggleGroupedWithPrevious(list, 'a')).toEqual([]);
    expect(toggleGroupedWithPrevious(list, 'zzz')).toEqual([]);
  });

  it('is its own inverse: toggling twice returns to the original numbers', () => {
    const list = [person('a', 1), person('b', 2), person('c', 3)];
    const grouped = toggleGroupedWithPrevious(list, 'b');
    const afterGrouping = list.map((r) => {
      const change = grouped.find((c) => c.recipientId === r.id);
      return change ? { ...r, routingOrder: change.routingOrder } : r;
    });
    expect(toggleGroupedWithPrevious(afterGrouping, 'b')).toEqual([
      { recipientId: 'b', routingOrder: 2 },
      { recipientId: 'c', routingOrder: 3 },
    ]);
  });
});
