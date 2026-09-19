import {
  type EnvelopeDetail,
  type EnvelopeStatus,
  isOpenEnvelope,
  type RecipientDetail,
  receivesSigningLink,
} from '@envelope/shared';

/**
 * What the sender can do to stop an envelope: throw away a draft nobody has
 * seen, or cancel one that was sent (open or paused as expired). Nothing once
 * it is finished.
 */
export function cancelModeFor(status: EnvelopeStatus): 'discard' | 'cancel' | null {
  if (status === 'DRAFT') return 'discard';
  if (isOpenEnvelope(status) || status === 'EXPIRED') return 'cancel';
  return null;
}

/**
 * Who gets the cancellation email: signers and approvers the mail server has
 * already accepted an email for. The same rule the worker applies.
 */
export function toldOfCancellation(recipients: RecipientDetail[]): RecipientDetail[] {
  return recipients.filter((r) => receivesSigningLink(r.role) && r.notifiedAt !== null);
}

/** A discarded draft was never sent; a cancelled envelope was. */
export function wasDiscarded(envelope: Pick<EnvelopeDetail, 'status' | 'sentAt'>): boolean {
  return envelope.status === 'VOIDED' && envelope.sentAt === null;
}
