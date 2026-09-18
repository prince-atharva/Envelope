import { createHash } from 'node:crypto';

/**
 * The notice a signer agrees to before signing electronically (docs/07).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ DRAFT PLACEHOLDER. This wording has NOT been reviewed by a lawyer.   │
 * │ Doc 11 is explicit that we must not write this text ourselves. It    │
 * │ stands in until HealthProHub supplies approved wording, and must be  │
 * │ replaced before any real contract is signed.                         │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * The exact text shown is stored with every consent (Recipient.consentText),
 * so replacing it later does not change what earlier signers agreed to.
 *
 * Doc 07 lists what the approved text must cover: the right to a paper copy,
 * how to withdraw consent and what follows, whether consent covers this
 * document only, how to ask for a paper copy and any fee, and the hardware and
 * software needed. The placeholder follows that outline so the screen can be
 * built and tested; it is not advice.
 *
 * Keyed by Envelope.jurisdictionCode. Jurisdiction policy proper is Phase 5
 * (docs/07, ADR 0011 planned); every envelope is "US" until then.
 */
export const CONSENT_TEXT_IS_DRAFT = true;

const DRAFT_US_NOTICE = [
  'DRAFT — not legally reviewed. This placeholder notice will be replaced with approved wording before real use.',
  '',
  'Agreement to sign electronically',
  '',
  'By ticking the box below, you agree to receive this document and to sign it electronically instead of on paper. Your electronic signature will have the same effect as a handwritten one.',
  '',
  'This agreement covers this document only.',
  '',
  'You may ask the sender for a paper copy of this document at any time. There is no charge for a paper copy.',
  '',
  'You may withdraw this agreement at any time before you finish signing by choosing Decline. After you have signed, withdrawing it does not undo your signature.',
  '',
  'To sign, you need a device with an up-to-date web browser and an internet connection, and an email address where you can receive a copy of the signed document.',
].join('\n');

const NOTICES: Record<string, string> = {
  US: DRAFT_US_NOTICE,
};

export interface ConsentNotice {
  text: string;
  /** SHA-256 of `text`, sent to the browser and checked when the signer agrees. */
  hash: string;
}

export function consentNoticeFor(jurisdictionCode: string): ConsentNotice {
  const text = NOTICES[jurisdictionCode] ?? DRAFT_US_NOTICE;
  return { text, hash: createHash('sha256').update(text, 'utf8').digest('hex') };
}
