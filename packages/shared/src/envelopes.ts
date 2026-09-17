import { z } from 'zod';
import type { FieldInfo, RecipientInfo } from './draft';

export type EnvelopeStatus =
  | 'DRAFT'
  | 'SENT'
  | 'DELIVERED'
  | 'PARTIALLY_SIGNED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'VOIDED';

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
  isFinal: boolean;
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

export interface EnvelopeDetail extends EnvelopeSummary {
  /** SHA-256 of DocumentVersion 0, the document as uploaded (after sanitising). */
  originalHash: string;
  finalHash: string | null;
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
  recipients: RecipientInfo[];
  fields: FieldInfo[];
}

export interface EnvelopeListResponse {
  items: EnvelopeSummary[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}
