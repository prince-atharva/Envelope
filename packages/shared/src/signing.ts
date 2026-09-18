import { z } from 'zod';
import type { FieldType, Ratios } from './coordinates';
import { canOwnFields, type RecipientRole, type RecipientStatus } from './draft';
import type { EnvelopeStatus } from './envelopes';
import {
  MAX_DECLINE_REASON_LENGTH,
  MAX_EXPIRY_DAYS,
  MAX_FIELDS_PER_ENVELOPE,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS_PER_ENVELOPE,
  MAX_SIGNATURE_IMAGE_BYTES,
  MAX_TEXT_VALUE_LENGTH,
} from './limits';

/**
 * Sending an envelope and signing it (Phase 3, docs/08 "Signing Session").
 *
 * The signing token is the only identity a signer has. It appears in the link
 * path and nowhere else; the server stores only its HMAC (ADR 0009).
 */

/** A signing token as it appears in the link: 32 random bytes, lower-case hex. */
export const SIGNING_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** SHA-256 in lower-case hex, as used for the consent text hash. */
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 hex digest');

// ─── Sending (sender side) ───

export const sendEnvelopeSchema = z.strictObject({
  /** Days until every link on the envelope stops working. Defaults to the server setting. */
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).optional(),
  /** Replaces the envelope's message, if given. Null clears it. */
  message: z.string().trim().max(MAX_MESSAGE_LENGTH).nullable().optional(),
});
export type SendEnvelopeInput = z.infer<typeof sendEnvelopeSchema>;

export interface SendEnvelopeResponse {
  id: string;
  status: EnvelopeStatus;
  sentAt: string;
  expiresAt: string;
  /** Everyone emailed now. In "one after another", only the first group. */
  invited: { id: string; status: RecipientStatus }[];
}

export const remindSchema = z.strictObject({
  /** Defaults to everyone whose turn it is and who has not finished. */
  recipientIds: z.array(z.uuid()).min(1).max(MAX_RECIPIENTS_PER_ENVELOPE).optional(),
});
export type RemindInput = z.infer<typeof remindSchema>;

export type ReminderSkipReason = 'TOO_SOON' | 'NOT_THEIR_TURN' | 'FINISHED';

export interface RemindResponse {
  reminded: string[];
  skipped: { recipientId: string; reason: ReminderSkipReason }[];
}

// ─── Signing (signer side) ───

export const SIGNATURE_KINDS = ['SIGNATURE', 'INITIALS'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const SIGNATURE_METHODS = ['DRAWN', 'TYPED'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** The longest data URL an image of MAX_SIGNATURE_IMAGE_BYTES can produce. */
const MAX_PNG_DATA_URL_LENGTH =
  PNG_DATA_URL_PREFIX.length + Math.ceil(MAX_SIGNATURE_IMAGE_BYTES / 3) * 4;

export const consentSchema = z.strictObject({
  agreed: z.literal(true, { error: 'You must agree to continue' }),
  /** SHA-256 of the notice exactly as it was displayed, so the stored text is the text seen. */
  consentTextHash: sha256HexSchema,
});
export type ConsentInput = z.infer<typeof consentSchema>;

export const adoptSignatureSchema = z.strictObject({
  kind: z.enum(SIGNATURE_KINDS),
  method: z.enum(SIGNATURE_METHODS),
  /** A transparent PNG as a data URL. Never JPEG (docs/06). */
  image: z
    .string()
    .startsWith(PNG_DATA_URL_PREFIX, 'The image must be a PNG')
    .max(MAX_PNG_DATA_URL_LENGTH, 'The image is too large'),
});
export type AdoptSignatureInput = z.infer<typeof adoptSignatureSchema>;

export const submitSigningSchema = z.strictObject({
  /**
   * Values for TEXT_INPUT and CHECKBOX fields (`"true"` or `"false"`).
   * SIGNATURE and INITIALS come from the adopted images, and DATE_SIGNED is
   * set by the server, so any value sent for those is ignored.
   */
  fields: z
    .array(
      z.strictObject({
        id: z.uuid(),
        value: z.string().max(MAX_TEXT_VALUE_LENGTH).optional(),
      }),
    )
    .max(MAX_FIELDS_PER_ENVELOPE),
});
export type SubmitSigningInput = z.infer<typeof submitSigningSchema>;

export const declineSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1, 'Tell the sender why you are declining')
    .max(MAX_DECLINE_REASON_LENGTH),
});
export type DeclineInput = z.infer<typeof declineSchema>;

/** One of the signer's own fields. Nobody else's are ever sent (docs/10). */
export interface SigningField extends Ratios {
  id: string;
  type: FieldType;
  pageNumber: number;
  required: boolean;
}

/** GET /sign/:token. Fields are empty until consent has been given (docs/07). */
export interface SigningSession {
  envelopeTitle: string;
  senderName: string;
  recipientName: string;
  pageCount: number;
  expiresAt: string;
  message: string | null;
  consentRequired: boolean;
  /** The notice to agree to. Null once consent has been given. */
  consentText: string | null;
  /** SHA-256 of `consentText`, to send back with the agreement. */
  consentTextHash: string | null;
  fields: SigningField[];
  /** What has been adopted so far, and how. */
  adopted: Partial<Record<SignatureKind, SignatureMethod>>;
}

export interface AdoptSignatureResponse {
  kind: SignatureKind;
  method: SignatureMethod;
}

export interface SubmitSigningResponse {
  status: 'SIGNED';
  signedAt: string;
  message: string;
}

export interface DeclineResponse {
  status: 'DECLINED';
  declinedAt: string;
}

// ─── Order ───

/**
 * The order a signer is walked through their fields: by page, then from the
 * top of the page down, then left to right (docs/09, "Guided Navigation").
 */
export function orderFieldsForSigning<T extends { pageNumber: number } & Ratios>(
  fields: readonly T[],
): T[] {
  return [...fields].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.ratioY - b.ratioY || a.ratioX - b.ratioX,
  );
}

export interface RoutingRecipient {
  id: string;
  role: RecipientRole;
  status: RecipientStatus;
  routingOrder: number;
}

/** Only people who sign or approve are emailed a link. VIEWER and CC get the finished copy. */
export function receivesSigningLink(role: RecipientRole): boolean {
  return canOwnFields(role);
}

function hasFinished(recipient: RoutingRecipient): boolean {
  return recipient.status === 'SIGNED' || recipient.status === 'DECLINED';
}

/**
 * Everyone whose turn it is now, whether or not they have been emailed yet.
 *
 * - Everyone at once: every signer who has not finished.
 * - One after another: the signers who share the lowest `routingOrder` among
 *   those who have not finished. Equal numbers sign in parallel (docs/05).
 */
export function currentRoutingGroup<T extends RoutingRecipient>(
  recipients: readonly T[],
  sequential: boolean,
): T[] {
  const waiting = recipients.filter((r) => receivesSigningLink(r.role) && !hasFinished(r));
  if (!sequential || waiting.length === 0) return waiting;
  const turn = Math.min(...waiting.map((r) => r.routingOrder));
  return waiting.filter((r) => r.routingOrder === turn);
}

/**
 * Whom to email now: people whose turn it is and who have never been invited.
 * Used at send, and again after each signature to move to the next group.
 */
export function recipientsDueInvitation<T extends RoutingRecipient>(
  recipients: readonly T[],
  sequential: boolean,
): T[] {
  return currentRoutingGroup(recipients, sequential).filter((r) => r.status === 'PENDING');
}
