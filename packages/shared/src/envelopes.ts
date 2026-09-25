import { z } from 'zod';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from './document-categories';
import type { FieldInfo, RecipientInfo } from './draft';
import { MAX_LEGAL_HOLD_REASON_LENGTH } from './limits';

export const ENVELOPE_STATUSES = [
  'DRAFT',
  'SENT',
  'DELIVERED',
  'PARTIALLY_SIGNED',
  'EXPIRED',
  'COMPLETED',
  'DECLINED',
  'VOIDED',
] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

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
  /** What kind of document this is, checked against the resolved jurisdiction policy (docs/07). */
  documentCategory: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
  /** Overrides the tenant's default jurisdiction for this envelope only (docs/07). */
  jurisdictionCode: z.string().trim().min(2).max(10).optional(),
});
export type CreateEnvelopeInput = z.infer<typeof createEnvelopeSchema>;

/**
 * The dashboard's tabs (docs/16 step 14). Needs attention is ranked by what
 * to chase first; every other view is newest first.
 */
export const ENVELOPE_VIEWS = [
  'attention',
  'waiting',
  'completed',
  'cancelled',
  'drafts',
  'all',
] as const;
export type EnvelopeView = (typeof ENVELOPE_VIEWS)[number];

export const listEnvelopesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(400).optional(),
  view: z.enum(ENVELOPE_VIEWS).default('all'),
  /** Only this status, within the view (docs/08). */
  status: z.enum(ENVELOPE_STATUSES).optional(),
});
export type ListEnvelopesQuery = z.infer<typeof listEnvelopesQuerySchema>;

/**
 * Why a document is in Needs attention, in the order they are listed:
 * paused by its deadline; someone emailed two days ago has not opened it; an
 * email was not accepted by the mail server; the deadline is close; someone
 * declined recently.
 */
export const ATTENTION_REASONS = [
  'EXPIRED',
  'NOT_OPENED',
  'EMAIL_NOT_DELIVERED',
  'EXPIRING_SOON',
  'DECLINED',
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** How far a sent document has got. Signers and approvers only. */
export interface EnvelopeProgress {
  signed: number;
  total: number;
  /** Whose turn it is and who has not finished yet. */
  waitingOn: string[];
  /** The earliest invitation still not opened. */
  oldestUnviewedSince: string | null;
  /** The latest thing anyone did: opened, signed, declined, was emailed. */
  lastActivityAt: string | null;
}

export interface EnvelopeSummary {
  id: string;
  title: string;
  status: EnvelopeStatus;
  originalFilename: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  /** When the signing links stop working. Null for a draft. */
  expiresAt: string | null;
  /** Null for a draft. */
  progress: EnvelopeProgress | null;
  /** Only in Needs attention: why it is there, and since when. */
  attention?: { reason: AttentionReason; since: string };
  /** Set once someone places a legal hold; overrides every retention sweep (docs/17 step 7). */
  legalHoldAt: string | null;
}

/** GET /envelopes/counts: every tab's count, in one query. */
export type EnvelopeCounts = Record<EnvelopeView, number>;

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
  /** When they last asked for more time from an expired link (docs/16 step 8). */
  moreTimeRequestedAt: string | null;
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
  /**
   * The oldest AUDIT_EVENTS_IN_DETAIL events, oldest first — not every event.
   * Compare its length against `auditEventCount` (the true total) to know
   * whether there is more; page through the rest with GET
   * /envelopes/:id/events (100M-row scale follow-up API pass, docs/16 step
   * 14: an envelope can carry far more history than a detail view should
   * fetch every 15s poll, e.g. from many reminders or a long dispute).
   */
  auditTrail: AuditEventInfo[];
  /** How many audit events this envelope has in total. */
  auditEventCount: number;
  /**
   * Pass to GET /envelopes/:id/events as `cursor` to page through the rest.
   * Null once `auditTrail` already carries everything.
   */
  eventsCursor: string | null;
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
  /** Automatic reminders every this many days, with an "expires soon" email. Null is off. */
  reminderIntervalDays: number | null;
  /** When the expiry sweep last paused it. Kept after an extension, as history. */
  expiredAt: string | null;
  /** When it was cancelled or discarded, by whom and why. Null unless VOIDED. */
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: { id: string; fullName: string } | null;
  recipients: RecipientDetail[];
  fields: FieldInfo[];
  /** What kind of document this is, checked at creation against the frozen policy (docs/07). */
  documentCategory: DocumentCategory;
  /** The jurisdiction the frozen policy was resolved for. */
  jurisdictionCode: string;
  /** Which revision of the jurisdiction policy reference data produced the frozen snapshot. */
  policyVersion: number | null;
  legalHoldAt: string | null;
  legalHoldReason: string | null;
  legalHoldBy: { id: string; fullName: string } | null;
  /** When retention would otherwise remove this envelope's files, absent a hold (docs/17 step 8). */
  retentionDueAt: string | null;
  /** Set once the retention sweeper has removed this envelope's storage objects. */
  purgedAt: string | null;
}

export const legalHoldSchema = z.strictObject({
  reason: z.string().trim().min(1).max(MAX_LEGAL_HOLD_REASON_LENGTH),
});
export type LegalHoldInput = z.infer<typeof legalHoldSchema>;

export interface LegalHoldResponse {
  id: string;
  legalHoldAt: string | null;
  legalHoldReason: string | null;
}

export const AUDIT_EXPORT_FORMATS = ['json', 'csv'] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

export interface EnvelopeListResponse {
  items: EnvelopeSummary[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

/** GET /envelopes/:id/events: the rest of the audit trail past what the detail carries. */
export const listEnvelopeEventsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type ListEnvelopeEventsQuery = z.infer<typeof listEnvelopeEventsQuerySchema>;

export interface EnvelopeEventsResponse {
  /** Oldest first, continuing from the cursor (or from the start with none). */
  items: AuditEventInfo[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}
