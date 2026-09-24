import type { EnvelopeStatus } from './envelopes';

/** Verify accepts files up to the upload limit, 25 MB (docs/08). */
export const VERIFY_REQUESTS_PER_MINUTE = 30;

export interface VerifiedSigner {
  name: string;
  /** "j***@example.com": enough to recognise who, not enough to harvest (docs/16 step 14). */
  maskedEmail: string;
  role: 'SIGNER' | 'APPROVER';
  /** ISO time. Null for someone who has not signed (yet). */
  signedAt: string | null;
}

export interface VerifiedVersion {
  versionNumber: number;
  sha256: string;
  /** Who produced it; null for the original and for the sealed file. */
  signedBy: string | null;
  isFinal: boolean;
  createdAt: string;
}

export interface VerifiedEvent {
  sequence: number;
  timestamp: string;
  action: string;
  /** A person's name, or "System". */
  actor: string;
}

/**
 * POST /v1/verify (docs/08, docs/06 "Verification"). The file is hashed in
 * memory; nothing about it is stored.
 */
export type VerifyResponse =
  | {
      verified: true;
      /** SHA-256 of the uploaded file. */
      documentHash: string;
      envelopeId: string;
      title: string;
      status: EnvelopeStatus;
      completedAt: string | null;
      /**
       * Which version the file is: `isFinal` is the sealed, finished document;
       * otherwise a copy made while signing was under way (never version 0).
       */
      matched: { versionNumber: number; isFinal: boolean };
      signers: VerifiedSigner[];
      versionChain: VerifiedVersion[];
      events: VerifiedEvent[];
    }
  | {
      verified: false;
      documentHash: string;
      /**
       * NO_MATCHING_DOCUMENT: nothing sealed or signed here has this
       * fingerprint. UNSIGNED_ORIGINAL: it is a document as uploaded for
       * signing, before anyone signed. Originals are often shared templates, so
       * nothing about any envelope is revealed for them.
       */
      reason: 'NO_MATCHING_DOCUMENT' | 'UNSIGNED_ORIGINAL';
      detail: string;
    };

/**
 * Deliberately says both things it could mean. The system cannot tell them
 * apart, and claiming otherwise would be dishonest exactly where honesty
 * matters most (docs/08).
 */
export const NO_MATCH_DETAIL =
  "This document's fingerprint does not match any document sealed here. Either it was not " +
  'sealed by this platform, or it has been changed since it was sealed.';

export const UNSIGNED_ORIGINAL_DETAIL =
  'This is a document as it was uploaded for signing, before anyone signed it. Verify only ' +
  'confirms documents that carry signatures, so it shows nothing more about it.';
