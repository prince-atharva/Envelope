import {
  type EnvelopeStatus,
  isOpenEnvelope,
  type RecipientDetail,
  receivesSigningLink,
} from '@envelope/shared';

/** Invited and not finished: the people whose turn it is. */
const AWAITING: readonly string[] = ['SENT', 'DELIVERED', 'VIEWED'];

/** More time can be given while it is open, and after the deadline paused it (ADR 0013). */
export function canExtend(status: EnvelopeStatus): boolean {
  return isOpenEnvelope(status) || status === 'EXPIRED';
}

/**
 * Who an extension emails a fresh link: signers and approvers whose turn it is
 * and who have not finished. The same rule the API applies.
 */
export function freshLinkFor(recipients: RecipientDetail[]): RecipientDetail[] {
  return recipients.filter((r) => receivesSigningLink(r.role) && AWAITING.includes(r.status));
}

/** Signers and approvers who have not signed yet, in routing order. */
export function stillToSign(recipients: RecipientDetail[]): RecipientDetail[] {
  return recipients.filter(
    (r) => receivesSigningLink(r.role) && r.status !== 'SIGNED' && r.status !== 'DECLINED',
  );
}
