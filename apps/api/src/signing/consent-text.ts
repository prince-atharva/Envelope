import { createHash } from 'node:crypto';
import {
  CONSENT_TEXT_IS_DRAFT,
  type PolicySnapshot,
  resolvePolicySnapshot,
} from '@envelope/shared';

export { CONSENT_TEXT_IS_DRAFT };

/**
 * The notice a signer agrees to before signing electronically (docs/07, ADR
 * 0011). The wording itself is part of the envelope's frozen policy snapshot
 * (`packages/shared/src/jurisdiction.ts`) — this module only hashes it, so
 * the browser can detect a change between being shown the notice and
 * agreeing to it (`CONSENT_TEXT_CHANGED`). Reading a live jurisdiction map
 * here, keyed by `Envelope.jurisdictionCode`, is exactly the bug ADR 0011
 * exists to prevent: it would let a later policy edit retroactively change
 * what an already-signed envelope claims a signer agreed to.
 */

export interface ConsentNotice {
  text: string;
  /** SHA-256 of `text`, sent to the browser and checked when the signer agrees. */
  hash: string;
}

export function consentNoticeFor(policySnapshot: unknown): ConsentNotice {
  const snapshot = policySnapshot as Pick<PolicySnapshot, 'consentDisclosureText'> | null;
  // Every envelope has had a frozen snapshot since the Phase 6 migration
  // (which backfilled every pre-existing row); this fallback exists only so
  // a malformed row shows a real notice rather than a blank one.
  const text =
    snapshot?.consentDisclosureText ?? resolvePolicySnapshot(null, 'US').consentDisclosureText;
  return { text, hash: createHash('sha256').update(text, 'utf8').digest('hex') };
}
