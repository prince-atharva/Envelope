import { z } from 'zod';
import { DOCUMENT_CATEGORIES } from './document-categories';
import { ENVELOPE_STATUSES, ENVELOPE_VIEWS } from './envelopes';
import { ERROR_CATALOG } from './errors';

/**
 * Response bodies of the documented operations, as zod schemas (docs/18 workstream 13, ADR 0021).
 * They feed the served OpenAPI document, and openapi.e2e.test.ts parses real responses with them,
 * so a schema that stops matching the API fails a test instead of misleading a partner.
 *
 * Every object is loose: the API may add fields without a version bump (ADR 0018), so a partner
 * (and this check) must tolerate fields it does not know.
 */
const isoTime = z
  .string()
  .meta({ description: 'UTC ISO 8601 timestamp', example: '2026-09-27T10:00:00.000Z' });
const nullableTime = isoTime.nullable();
const id = z.uuid();
const person = z.looseObject({ id, fullName: z.string() });

export const problemDetailsSchema = z
  .looseObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(Object.keys(ERROR_CATALOG) as [keyof typeof ERROR_CATALOG]),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional().meta({ description: 'Matches the X-Request-Id header.' }),
    errors: z
      .array(z.looseObject({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Per-field problems, on VALIDATION_FAILED and NOT_READY_TO_SEND.' }),
    reason: z.string().optional(),
  })
  .meta({ id: 'Problem', description: 'RFC 7807 problem details (application/problem+json).' });

export const recipientInfoSchema = z
  .looseObject({
    id,
    name: z.string(),
    email: z.string(),
    role: z.enum(['SIGNER', 'APPROVER', 'VIEWER', 'CC']),
    status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'VIEWED', 'SIGNED', 'DECLINED']),
    routingOrder: z.number().int(),
    colorIndex: z.number().int(),
  })
  .meta({ id: 'Recipient' });

export const recipientDetailSchema = recipientInfoSchema
  .extend({
    invitedAt: nullableTime,
    notifiedAt: nullableTime,
    lastRemindedAt: nullableTime,
    viewedAt: nullableTime,
    signedAt: nullableTime,
    declinedAt: nullableTime,
    declinedReason: z.string().nullable(),
    copySentAt: nullableTime,
    moreTimeRequestedAt: nullableTime,
  })
  .meta({ id: 'RecipientDetail' });

export const fieldInfoSchema = z
  .looseObject({
    id,
    recipientId: id,
    type: z.enum(['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT_INPUT', 'CHECKBOX']),
    pageNumber: z.number().int(),
    ratioX: z.number(),
    ratioY: z.number(),
    ratioWidth: z.number(),
    ratioHeight: z.number(),
    required: z.boolean(),
  })
  .meta({ id: 'Field' });

const progressSchema = z.looseObject({
  signed: z.number().int(),
  total: z.number().int(),
  waitingOn: z.array(z.string()),
  oldestUnviewedSince: nullableTime,
  lastActivityAt: nullableTime,
});

const summaryShape = {
  id,
  title: z.string(),
  status: z.enum(ENVELOPE_STATUSES),
  originalFilename: z.string(),
  pageCount: z.number().int(),
  createdAt: isoTime,
  updatedAt: isoTime,
  expiresAt: nullableTime,
  progress: progressSchema.nullable(),
  attention: z.looseObject({ reason: z.string(), since: isoTime }).optional(),
  legalHoldAt: nullableTime,
  externalId: z.string().nullable(),
};
export const envelopeSummarySchema = z.looseObject(summaryShape).meta({ id: 'EnvelopeSummary' });

export const envelopeListSchema = z
  .looseObject({
    items: z.array(envelopeSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as `cursor`; null on the last page.' }),
  })
  .meta({ id: 'EnvelopeList' });

export const envelopeCountsSchema = z
  .looseObject(Object.fromEntries(ENVELOPE_VIEWS.map((view) => [view, z.number().int()])))
  .meta({ id: 'EnvelopeCounts' });

const versionSchema = z.looseObject({
  versionNumber: z.number().int(),
  sha256: z.string(),
  pageCount: z.number().int(),
  sizeBytes: z.number().int(),
  isFinal: z.boolean(),
  createdByRecipientId: z.string().nullable(),
  createdAt: isoTime,
});

export const auditEventSchema = z
  .looseObject({
    sequence: z.number().int(),
    action: z.string(),
    timestamp: isoTime,
    actorUserId: z.string().nullable(),
    recipientId: z.string().nullable(),
    eventHash: z.string(),
  })
  .meta({ id: 'AuditEvent' });

export const envelopeDetailSchema = z
  .looseObject({
    ...summaryShape,
    metadata: z.record(z.string(), z.string()).nullable(),
    originalHash: z.string(),
    finalHash: z.string().nullable(),
    completedAt: nullableTime,
    senderCopySentAt: nullableTime,
    owner: person,
    versions: z.array(versionSchema),
    auditTrail: z.array(auditEventSchema),
    auditEventCount: z.number().int(),
    eventsCursor: z.string().nullable(),
    message: z.string().nullable(),
    sequentialSigning: z.boolean(),
    draftRevision: z
      .number()
      .int()
      .meta({ description: 'Send back as If-Match on the next draft edit.' }),
    sentAt: nullableTime,
    reminderIntervalDays: z.number().int().nullable(),
    expiredAt: nullableTime,
    voidedAt: nullableTime,
    voidReason: z.string().nullable(),
    voidedBy: person.nullable(),
    recipients: z.array(recipientDetailSchema),
    fields: z.array(fieldInfoSchema),
    documentCategory: z.enum(DOCUMENT_CATEGORIES),
    jurisdictionCode: z.string(),
    policyVersion: z.number().int().nullable(),
    legalHoldReason: z.string().nullable(),
    legalHoldBy: person.nullable(),
    retentionDueAt: nullableTime,
    purgedAt: nullableTime,
  })
  .meta({ id: 'EnvelopeDetail' });

export const envelopeEventsSchema = z
  .looseObject({ items: z.array(auditEventSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'EnvelopeEvents' });

export const draftRevisionSchema = z
  .looseObject({ draftRevision: z.number().int() })
  .meta({ id: 'DraftRevision' });
export const recipientResponseSchema = z
  .looseObject({
    recipient: recipientInfoSchema,
    draftRevision: z.number().int(),
    fieldsRemoved: z.number().int().optional(),
  })
  .meta({ id: 'RecipientResult' });
export const saveFieldsResponseSchema = z
  .looseObject({ fields: z.array(fieldInfoSchema), draftRevision: z.number().int() })
  .meta({ id: 'FieldsResult' });

export const sendResponseSchema = z
  .looseObject({
    id,
    status: z.literal('SENT'),
    sentAt: isoTime,
    expiresAt: isoTime,
    invited: z.array(z.looseObject({ id, status: z.string() })),
  })
  .meta({ id: 'SendResult' });
export const voidResponseSchema = z
  .looseObject({
    id,
    status: z.literal('VOIDED'),
    voidedAt: isoTime,
    discarded: z.boolean(),
  })
  .meta({ id: 'VoidResult' });
export const remindResponseSchema = z
  .looseObject({
    reminded: z.array(id),
    skipped: z.array(
      z.looseObject({
        recipientId: id,
        reason: z.enum(['FINISHED', 'NOT_THEIR_TURN', 'TOO_SOON']),
      }),
    ),
  })
  .meta({ id: 'RemindResult' });

export const embedSessionIssueSchema = z
  .looseObject({
    sessionId: id,
    launchToken: z.string().regex(/^eel_[a-f0-9]{64}$/),
    launchExpiresAt: isoTime,
    frameUrl: z.url(),
  })
  .meta({ id: 'EmbedSession' });

export const templateRoleSchema = z
  .looseObject({
    id,
    name: z.string(),
    role: z.enum(['SIGNER', 'APPROVER', 'VIEWER', 'CC']),
    routingOrder: z.number().int(),
    colorIndex: z.number().int(),
  })
  .meta({ id: 'TemplateRole' });

export const templateFieldSchema = z
  .looseObject({
    id,
    templateRoleId: id,
    type: z.enum(['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT_INPUT', 'CHECKBOX']),
    pageNumber: z.number().int(),
    ratioX: z.number(),
    ratioY: z.number(),
    ratioWidth: z.number(),
    ratioHeight: z.number(),
    required: z.boolean(),
  })
  .meta({ id: 'TemplateField' });

const templateSummaryShape = {
  id,
  name: z.string(),
  description: z.string().nullable(),
  pageCount: z.number().int(),
  documentCategory: z.string(),
  roleCount: z.number().int(),
  fieldCount: z.number().int(),
  archivedAt: nullableTime,
  createdAt: isoTime,
  createdByName: z.string(),
};
export const templateSummarySchema = z
  .looseObject(templateSummaryShape)
  .meta({ id: 'TemplateSummary' });

export const templateDetailSchema = z
  .looseObject({
    ...templateSummaryShape,
    defaultMessage: z.string().nullable(),
    sequentialSigning: z.boolean(),
    reminderIntervalDays: z.number().int().nullable(),
    roles: z.array(templateRoleSchema),
    fields: z.array(templateFieldSchema),
  })
  .meta({ id: 'TemplateDetail' });

export const templateListSchema = z
  .looseObject({ templates: z.array(templateSummarySchema) })
  .meta({ id: 'TemplateList' });

export type OperationResponse =
  | { status: number; kind: 'json'; schema: z.ZodType }
  | { status: number; kind: 'pdf' }
  | { status: number; kind: 'none' };

/** The success response of each documented operation, by operation id. */
export const OPERATION_RESPONSES: Record<string, OperationResponse> = {
  upload: { status: 201, kind: 'json', schema: envelopeDetailSchema },
  list: { status: 200, kind: 'json', schema: envelopeListSchema },
  counts: { status: 200, kind: 'json', schema: envelopeCountsSchema },
  detail: { status: 200, kind: 'json', schema: envelopeDetailSchema },
  events: { status: 200, kind: 'json', schema: envelopeEventsSchema },
  file: { status: 200, kind: 'pdf' },
  'document-original': { status: 200, kind: 'pdf' },
  'document-completed': { status: 200, kind: 'pdf' },
  'document-certificate': { status: 200, kind: 'pdf' },
  update: { status: 200, kind: 'json', schema: draftRevisionSchema },
  'recipient-add': { status: 201, kind: 'json', schema: recipientResponseSchema },
  'recipient-update': { status: 200, kind: 'json', schema: recipientResponseSchema },
  'recipient-delete': { status: 200, kind: 'json', schema: draftRevisionSchema },
  fields: { status: 200, kind: 'json', schema: saveFieldsResponseSchema },
  send: { status: 200, kind: 'json', schema: sendResponseSchema },
  void: { status: 200, kind: 'json', schema: voidResponseSchema },
  remind: { status: 200, kind: 'json', schema: remindResponseSchema },
  'template-create': { status: 201, kind: 'json', schema: templateDetailSchema },
  'template-list': { status: 200, kind: 'json', schema: templateListSchema },
  'template-get': { status: 200, kind: 'json', schema: templateDetailSchema },
  'template-update': { status: 200, kind: 'json', schema: templateDetailSchema },
  'embed-session-issue': { status: 201, kind: 'json', schema: embedSessionIssueSchema },
  'embed-session-revoke': { status: 204, kind: 'none' },
  'embed-close': { status: 204, kind: 'none' },
  'embed-upload': { status: 201, kind: 'json', schema: envelopeDetailSchema },
};
