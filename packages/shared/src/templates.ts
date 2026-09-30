import { z } from 'zod';
import { emailSchema } from './auth';
import type { FieldType, Ratios } from './coordinates';
import type { RecipientRole } from './draft';
import type { ErrorCode } from './errors';
import {
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_RECIPIENTS_PER_ENVELOPE,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
} from './limits';
import { envelopeMetadataSchema, externalIdSchema } from './partner-reference';

/**
 * Templates and bulk send (docs/20, ADR 0027, ADR 0028). A template is a saved
 * document plus its *roles*: placeholders such as "Patient" that stand for a
 * person to be named later. Creating an envelope from a template, singly or in a
 * batch, gives each role a real name and email.
 */

export const TEMPLATE_ROLE_NAME_MAX_LENGTH = MAX_RECIPIENT_NAME_LENGTH;

export const templateNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(MAX_TEMPLATE_NAME_LENGTH);

const descriptionSchema = z.string().trim().max(MAX_TEMPLATE_DESCRIPTION_LENGTH);
const messageSchema = z.string().trim().max(MAX_MESSAGE_LENGTH);

/** POST /templates: save an existing envelope as a template. */
export const createTemplateSchema = z.strictObject({
  envelopeId: z.uuid(),
  name: templateNameSchema,
  description: descriptionSchema.optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** PATCH /templates/:id. The layout is not editable (ADR 0027): save a new template instead. */
export const updateTemplateSchema = z
  .strictObject({
    name: templateNameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    /** The note that goes out with each invitation unless a request gives its own. */
    defaultMessage: messageSchema.nullable().optional(),
    /** True hides the template from new use; false restores it. */
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { error: 'Change at least one value' });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** Query strings carry `"true"`/`"false"`, which `z.coerce.boolean()` would both read as true. */
const queryFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const listTemplatesQuerySchema = z.strictObject({
  /** Admins only: list archived templates instead of active ones. */
  archived: queryFlag.optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

/**
 * One person to fill one template role. `role` is the *template role's name*
 * ("Patient"), not a recipient role: the role's own kind (signer, approver, ...)
 * and routing order come from the template.
 */
export const templatePersonSchema = z.strictObject({
  role: z.string().trim().min(1).max(TEMPLATE_ROLE_NAME_MAX_LENGTH),
  name: z.string().trim().min(1, 'Enter a name').max(MAX_RECIPIENT_NAME_LENGTH),
  email: emailSchema,
});
export type TemplatePerson = z.infer<typeof templatePersonSchema>;

const templatePeopleSchema = z.array(templatePersonSchema).min(1).max(MAX_RECIPIENTS_PER_ENVELOPE);

/** POST /templates/:id/envelopes */
export const createFromTemplateSchema = z.strictObject({
  recipients: templatePeopleSchema,
  /** Overrides the template's default message for this envelope. */
  message: messageSchema.optional(),
  /** Defaults to the template's name. */
  title: z.string().trim().min(1).max(200).optional(),
  externalId: externalIdSchema.optional(),
  metadata: envelopeMetadataSchema.optional(),
  /** Send as soon as it is created. False (the default) leaves it a draft. */
  send: z.boolean().default(false),
});
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;

export const bulkRowSchema = z.strictObject({
  recipients: templatePeopleSchema,
  externalId: externalIdSchema.optional(),
  metadata: envelopeMetadataSchema.optional(),
});
export type BulkRowInput = z.infer<typeof bulkRowSchema>;

/**
 * POST /templates/:id/bulk. The row count is checked against MAX_BULK_ROWS by the
 * API, not here, so that an oversize batch answers BULK_TOO_LARGE rather than a
 * generic validation error.
 */
export const createBulkBatchSchema = z.strictObject({
  rows: z.array(bulkRowSchema).min(1, 'Add at least one row'),
  message: messageSchema.optional(),
  /** Send each envelope as it is created. False (the default) leaves them drafts. */
  send: z.boolean().default(false),
});
export type CreateBulkBatchInput = z.infer<typeof createBulkBatchSchema>;

export type TemplateRoleProblem =
  | { code: 'MISSING_ROLE'; role: string }
  | { code: 'UNKNOWN_ROLE'; role: string }
  | { code: 'DUPLICATE_ROLE'; role: string }
  | { code: 'DUPLICATE_EMAIL'; email: string };

/**
 * Whether the people given fill the template's roles exactly: one person per
 * role, no role invented, and no email used twice (an envelope lists each
 * person once). Shared so the API, the bulk worker and the browser's CSV
 * preview reject the same rows.
 */
export function checkTemplatePeople(
  roleNames: readonly string[],
  people: readonly Pick<TemplatePerson, 'role' | 'email'>[],
): TemplateRoleProblem[] {
  const problems: TemplateRoleProblem[] = [];
  const known = new Set(roleNames);
  const seenRoles = new Set<string>();
  const seenEmails = new Set<string>();
  for (const person of people) {
    if (!known.has(person.role)) {
      problems.push({ code: 'UNKNOWN_ROLE', role: person.role });
    } else if (seenRoles.has(person.role)) {
      problems.push({ code: 'DUPLICATE_ROLE', role: person.role });
    }
    seenRoles.add(person.role);
    const email = person.email.toLowerCase();
    if (seenEmails.has(email)) problems.push({ code: 'DUPLICATE_EMAIL', email });
    seenEmails.add(email);
  }
  for (const role of roleNames) {
    if (!seenRoles.has(role)) problems.push({ code: 'MISSING_ROLE', role });
  }
  return problems;
}

export interface TemplateRoleInfo {
  id: string;
  name: string;
  role: RecipientRole;
  routingOrder: number;
  colorIndex: number;
}

export interface TemplateFieldInfo extends Ratios {
  id: string;
  templateRoleId: string;
  type: FieldType;
  pageNumber: number;
  required: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  pageCount: number;
  documentCategory: string;
  roleCount: number;
  fieldCount: number;
  archivedAt: string | null;
  createdAt: string;
  createdByName: string;
}

export interface TemplateDetail extends TemplateSummary {
  defaultMessage: string | null;
  sequentialSigning: boolean;
  reminderIntervalDays: number | null;
  roles: TemplateRoleInfo[];
  fields: TemplateFieldInfo[];
}

export interface TemplateListResponse {
  templates: TemplateSummary[];
}

export const BULK_BATCH_STATUSES = ['PROCESSING', 'COMPLETED'] as const;
export type BulkBatchStatus = (typeof BULK_BATCH_STATUSES)[number];
export const BULK_ROW_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type BulkRowStatus = (typeof BULK_ROW_STATUSES)[number];

export interface BulkBatchSummary {
  id: string;
  templateId: string;
  templateName: string;
  status: BulkBatchStatus;
  send: boolean;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  createdAt: string;
  finishedAt: string | null;
}

/** The outcome of one row. Never carries an email: the envelope is where that lives. */
export interface BulkRowResult {
  rowIndex: number;
  status: BulkRowStatus;
  envelopeId: string | null;
  errorCode: ErrorCode | null;
}

export interface BulkBatchDetail extends BulkBatchSummary {
  rows: BulkRowResult[];
}

export interface BulkBatchListResponse {
  batches: BulkBatchSummary[];
}

export interface BulkBatchAccepted {
  batchId: string;
}
