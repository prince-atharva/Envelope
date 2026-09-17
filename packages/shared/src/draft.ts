import { z } from 'zod';
import { emailSchema } from './auth';
import { type FieldType, type Ratios, validateRatios } from './coordinates';
import {
  MAX_FIELDS_PER_ENVELOPE,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_RECIPIENTS_PER_ENVELOPE,
} from './limits';

/**
 * Preparing a draft: who signs, where they sign, and the envelope's settings.
 * Sending, tokens and the signer portal are Phase 3.
 */

export type RecipientRole = 'SIGNER' | 'APPROVER' | 'VIEWER' | 'CC';
export type RecipientStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'VIEWED' | 'SIGNED' | 'DECLINED';

export const RECIPIENT_ROLES = ['SIGNER', 'APPROVER', 'VIEWER', 'CC'] as const;
export const FIELD_TYPES = [
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'TEXT_INPUT',
  'CHECKBOX',
] as const;

/** Roles that do something to the document, and so may own fields. */
export const ROLES_WITH_FIELDS: readonly RecipientRole[] = ['SIGNER', 'APPROVER'];

export function canOwnFields(role: RecipientRole): boolean {
  return ROLES_WITH_FIELDS.includes(role);
}

const nameSchema = z.string().trim().min(1, 'Enter a name').max(MAX_RECIPIENT_NAME_LENGTH);
const routingOrderSchema = z.number().int().min(1).max(MAX_RECIPIENTS_PER_ENVELOPE);

export const addRecipientSchema = z.strictObject({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(RECIPIENT_ROLES).default('SIGNER'),
  /** Equal values sign in parallel. Defaults to the end of the list. */
  routingOrder: routingOrderSchema.optional(),
});
export type AddRecipientInput = z.infer<typeof addRecipientSchema>;

export const updateRecipientSchema = z
  .strictObject({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    role: z.enum(RECIPIENT_ROLES).optional(),
    routingOrder: routingOrderSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { error: 'Change at least one value' });
export type UpdateRecipientInput = z.infer<typeof updateRecipientSchema>;

export const updateEnvelopeSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    /** The note that goes out with the invitation. Null clears it. */
    message: z.string().trim().max(MAX_MESSAGE_LENGTH).nullable().optional(),
    sequentialSigning: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { error: 'Change at least one value' });
export type UpdateEnvelopeInput = z.infer<typeof updateEnvelopeSchema>;

/**
 * One field in a saved layout.
 *
 * The id comes from the client (`crypto.randomUUID()`), so a field keeps its
 * identity across autosaves and the builder never has to remap ids mid-drag.
 *
 * `strictObject` matters here: a client that sends pixel coordinates (`x`, `y`,
 * `width`, `height`) is rejected rather than quietly ignored. The API checks for
 * those keys first, so that mistake gets INVALID_COORDINATE_SPACE instead of a
 * generic validation error (docs/08).
 */
export const fieldInputSchema = z.strictObject({
  id: z.uuid(),
  recipientId: z.uuid(),
  type: z.enum(FIELD_TYPES),
  pageNumber: z.number().int().min(1),
  ratioX: z.number(),
  ratioY: z.number(),
  ratioWidth: z.number(),
  ratioHeight: z.number(),
  required: z.boolean().default(true),
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

/** PUT /envelopes/:id/fields replaces the whole layout, so this is all of it. */
export const saveFieldsSchema = z.strictObject({
  fields: z.array(fieldInputSchema).max(MAX_FIELDS_PER_ENVELOPE),
});
export type SaveFieldsInput = z.infer<typeof saveFieldsSchema>;

/** Keys that mean the client is sending pixels or points instead of ratios. */
export const PIXEL_COORDINATE_KEYS = ['x', 'y', 'width', 'height', 'left', 'top'] as const;

export interface RecipientInfo {
  id: string;
  name: string;
  email: string;
  role: RecipientRole;
  status: RecipientStatus;
  routingOrder: number;
  /** Index into the builder's colour palette. Fixed when the person is added. */
  colorIndex: number;
}

export interface FieldInfo extends Ratios {
  id: string;
  recipientId: string;
  type: FieldType;
  pageNumber: number;
  required: boolean;
}

/** What a draft mutation returns, so the client can keep its If-Match value. */
export interface DraftRevisionResponse {
  draftRevision: number;
}

export interface RecipientResponse extends DraftRevisionResponse {
  recipient: RecipientInfo;
  /** Fields removed because the new role cannot own any. */
  fieldsRemoved?: number;
}

export interface SaveFieldsResponse extends DraftRevisionResponse {
  fields: FieldInfo[];
}

export type ReadinessIssue =
  | { code: 'NO_RECIPIENTS'; message: string }
  | { code: 'RECIPIENT_HAS_NO_FIELDS'; message: string; recipientId: string }
  | { code: 'INVALID_FIELD'; message: string; fieldId: string };

/**
 * Everything that stops a draft being sent.
 *
 * The review screen shows these now; the Phase 3 send endpoint will refuse on
 * the same list, so the button and the server can never disagree.
 *
 * Only SIGNER and APPROVER need fields (docs/08). A CC or VIEWER recipient
 * receives the document without marking it.
 */
export function checkReadyToSend(draft: {
  recipients: readonly RecipientInfo[];
  fields: readonly FieldInfo[];
}): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  if (draft.recipients.length === 0) {
    issues.push({ code: 'NO_RECIPIENTS', message: 'Add at least one person.' });
  }

  for (const recipient of draft.recipients) {
    if (!canOwnFields(recipient.role)) continue;
    const hasRequiredField = draft.fields.some((f) => f.recipientId === recipient.id && f.required);
    if (!hasRequiredField) {
      issues.push({
        code: 'RECIPIENT_HAS_NO_FIELDS',
        recipientId: recipient.id,
        message: `${recipient.name} has no required field to complete.`,
      });
    }
  }

  for (const field of draft.fields) {
    if (validateRatios(field) !== null) {
      issues.push({
        code: 'INVALID_FIELD',
        fieldId: field.id,
        message: `A field on page ${field.pageNumber} is outside the page.`,
      });
    }
  }

  return issues;
}
