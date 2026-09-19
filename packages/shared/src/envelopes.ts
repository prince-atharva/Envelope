import { z } from 'zod';
import type { FieldInfo, RecipientInfo } from './draft';

export type EnvelopeStatus =
  | 'DRAFT'
  | 'SENT'
  | 'DELIVERED'
  | 'PARTIALLY_SIGNED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'VOIDED';

/**
 * Sent and not finished: signers can act, reminders go out and signatures are
 * stamped (docs/03). The one definition every check uses.
 */
export const OPEN_ENVELOPE_STATUSES = [
  'SENT',
  'DELIVERED',
  'PARTIALLY_SIGNED',
] as const satisfies readonly EnvelopeStatus[];
export type OpenEnvelopeStatus = (typeof OPEN_ENVELOPE_STATUSES)[number];

/**
 * Nothing can change any more (docs/01, "The Envelope"). EXPIRED is neither
 * open nor terminal: nobody can sign, but the sender can extend it (ADR 0013).
 */
export const TERMINAL_ENVELOPE_STATUSES = [
  'COMPLETED',
  'DECLINED',
  'VOIDED',
] as const satisfies readonly EnvelopeStatus[];

export function isOpenEnvelope(status: string): status is OpenEnvelopeStatus {
  return (OPEN_ENVELOPE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalEnvelope(status: string): boolean {
  return (TERMINAL_ENVELOPE_STATUSES as readonly string[]).includes(status);
}

/** Multipart text fields sent with the PDF on POST /envelopes. */
export const createEnvelopeSchema = z.strictObject({
  /** Defaults to the file name without its extension. */
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateEnvelopeInput = z.infer<typeof createEnvelopeSchema>;

export const listEnvelopesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type ListEnvelopesQuery = z.infer<typeof listEnvelopesQuerySchema>;

export interface EnvelopeSummary {
  id: string;
  title: string;
  status: EnvelopeStatus;
  originalFilename: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionInfo {
  versionNumber: number;
  sha256: string;
  pageCount: number;
  sizeBytes: number;
  /** The sealed, finished document: the certificate appended, the file locked. */
  isFinal: boolean;
  /** Whose signature made this version. Null for the original and the sealed file. */
  createdByRecipientId: string | null;
  createdAt: string;
}

export interface AuditEventInfo {
  sequence: number;
  action: string;
  timestamp: string;
  actorUserId: string | null;
  recipientId: string | null;
  eventHash: string;
}

/**
 * A recipient as their sender sees them, with how far they have got.
 * Times are ISO strings, or null until the step happens.
 */
export interface RecipientDetail extends RecipientInfo {
  /** Their turn began: at send, or when the group before them finished. */
  invitedAt: string | null;
  /** The mail server last accepted an invitation or reminder for them. */
  notifiedAt: string | null;
  lastRemindedAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  /** Shown to the sender only. */
  declinedReason: string | null;
  /** When the finished document was emailed to them (docs/15 step 6). */
  copySentAt: string | null;
}

export interface EnvelopeDetail extends EnvelopeSummary {
  /** SHA-256 of DocumentVersion 0, the document as uploaded (after sanitising). */
  originalHash: string;
  /** SHA-256 of the sealed, finished document. Not printed in it (docs/06, Correction 3). */
  finalHash: string | null;
  /** When the envelope was sealed. */
  completedAt: string | null;
  /** When the sender was emailed the finished document, unless they got it as a recipient. */
  senderCopySentAt: string | null;
  owner: { id: string; fullName: string };
  versions: DocumentVersionInfo[];
  auditTrail: AuditEventInfo[];
  /** The note that goes out with the invitation. */
  message: string | null;
  /** True when people are asked to sign one after another, in routing order. */
  sequentialSigning: boolean;
  /**
   * Increments on every draft change. The builder sends it back as `If-Match`,
   * so two open tabs cannot silently overwrite each other's work.
   */
  draftRevision: number;
  /** When it was sent. Null for a draft. */
  sentAt: string | null;
  /** When every signing link stops working. Null for a draft. */
  expiresAt: string | null;
  recipients: RecipientDetail[];
  fields: FieldInfo[];
}

export interface EnvelopeListResponse {
  items: EnvelopeSummary[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}
