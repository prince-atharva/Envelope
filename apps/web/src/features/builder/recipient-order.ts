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

/**
 * Whether this person signs at the same time as the person immediately
 * above them: their turn is a tied `routingOrder`, the same number, not a
 * later one (docs/17 step 11, REC-03 "equal values sign in parallel"). The
 * first person in the list is never grouped — there is nobody above them.
 */
export function isGroupedWithPrevious(
  recipients: readonly RecipientInfo[],
  recipientId: string,
): boolean {
  const index = recipients.findIndex((recipient) => recipient.id === recipientId);
  if (index <= 0) return false;
  return recipients[index]?.routingOrder === recipients[index - 1]?.routingOrder;
}

/**
 * Groups a recipient with the person above them so they sign at the same
 * time, or ungroups them back to their own turn — mixed routing inside a
 * sequential envelope (docs/17 step 11). The API and the routing core
 * (`currentRoutingGroup` in signing.ts) already accept a tied
 * `routingOrder`; this only had to become reachable from the builder.
 *
 * The whole sequence is recomputed in one pass rather than only touching the
 * one person toggled, because ungrouping (or grouping) shifts everyone
 * after them: numbers stay 1, 2, 3… with no gaps, and a run of equal numbers
 * is always contiguous.
 */
export function toggleGroupedWithPrevious(
  recipients: readonly RecipientInfo[],
  recipientId: string,
): RoutingOrderChange[] {
  const index = recipients.findIndex((recipient) => recipient.id === recipientId);
  if (index <= 0) return [];
  const flipping = !isGroupedWithPrevious(recipients, recipientId);

  let order = 0;
  const next = recipients.map((recipient, i) => {
    if (i === 0) {
      order = 1;
      return order;
    }
    const groupedWithPrevious =
      i === index ? flipping : recipient.routingOrder === recipients[i - 1]?.routingOrder;
    if (!groupedWithPrevious) order += 1;
    return order;
  });

  return recipients.flatMap((recipient, i) => {
    const routingOrder = next[i] ?? recipient.routingOrder;
    return recipient.routingOrder === routingOrder
      ? []
      : [{ recipientId: recipient.id, routingOrder }];
  });
}
