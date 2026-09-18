import type { RecipientInfo } from '@envelope/shared';

export interface RoutingOrderChange {
  recipientId: string;
  routingOrder: number;
}

/**
 * The `routingOrder` updates that move one person a place up or down.
 *
 * The list is renumbered 1, 2, 3… rather than swapping two values, because the
 * stored numbers can have gaps after a removal, or ties if the order was ever
 * set by hand, and a swap of equal numbers would change nothing. Only the
 * people whose number actually changes are returned, so a plain move between
 * neighbours is two requests.
 */
export function moveRecipient(
  recipients: readonly RecipientInfo[],
  recipientId: string,
  direction: 'up' | 'down',
): RoutingOrderChange[] {
  const from = recipients.findIndex((recipient) => recipient.id === recipientId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= recipients.length) return [];

  const reordered = [...recipients];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return [];
  reordered.splice(to, 0, moved);

  return reordered.flatMap((recipient, index) =>
    recipient.routingOrder === index + 1
      ? []
      : [{ recipientId: recipient.id, routingOrder: index + 1 }],
  );
}
