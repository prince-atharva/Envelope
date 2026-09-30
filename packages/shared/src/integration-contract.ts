import { ERROR_CATALOG, type ErrorCode } from './errors';
import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_WEBHOOK_SECRET_OVERLAP_HOURS,
  MAX_EXPIRY_DAYS,
  MAX_EXTERNAL_ID_LENGTH,
  MAX_FIELDS_PER_ENVELOPE,
  MAX_MESSAGE_LENGTH,
  MAX_METADATA_BYTES,
  MAX_METADATA_KEYS,
  MAX_PDF_PAGES,
  MAX_RECIPIENTS_PER_ENVELOPE,
  MAX_UPLOAD_BYTES,
  MAX_VOID_REASON_LENGTH,
  MAX_WEBHOOK_ENDPOINT_ROWS_PER_TENANT,
  MAX_WEBHOOK_ENDPOINTS_PER_TENANT,
  REMINDER_COOLDOWN_HOURS,
} from './limits';
import {
  FIRED_WEBHOOK_EVENT_TYPES,
  type FiredWebhookEventType,
  WEBHOOK_API_VERSION,
  WEBHOOK_DELIVERY_HEADERS,
} from './webhooks';

/**
 * The one description of the integration surface (docs/18 workstream 13, ADR 0021). The in-app
 * guide, the served OpenAPI document and `docs/developers/` all read from here, and tests fail
 * when a controller, the error catalog or a generated markdown table disagrees with it.
 */

/** Every path below is relative to this. */
export const API_BASE_PATH = '/api/v1';

export type OperationCaller = 'server' | 'editor';
export type OperationGroup =
  | 'envelopes'
  | 'drafts'
  | 'files'
  | 'lifecycle'
  | 'templates'
  | 'embedded';
export type ApiKeyAccess = 'read' | 'write';
export type EmbedPermission = 'read' | 'edit' | 'send' | 'upload' | 'close';
export type IdempotencyMode = 'none' | 'optional' | 'required';
export type RateLimitName =
  | 'createAndSend'
  | 'lifecycle'
  | 'certificate'
  | 'embedManage'
  | 'bulkBatch';

export interface OperationContract {
  id: string;
  /** `server` operations are called by a partner's backend; `editor` ones only by the embedded editor. */
  caller: OperationCaller;
  group: OperationGroup;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Relative to API_BASE_PATH; matches the controller route exactly. */
  path: string;
  title: string;
  description: string;
  /** What an API key may do here; null when a key is refused (`API_KEY_NOT_ALLOWED`). */
  apiKey: ApiKeyAccess | null;
  /** The permission an embedded-editor session needs; null when a session is refused. */
  embed: EmbedPermission | null;
  idempotency: IdempotencyMode;
  rateLimit: RateLimitName | null;
  inputs: string[];
  body?: object;
  query?: string;
  /** Sent with `If-Match: "<draftRevision>"`. */
  revision?: boolean;
  response: object | string;
  responseNote: string;
  errorCodes: ErrorCode[];
  errorNote: string;
}

/**
 * The single source for who may call what. `EXAMPLE_*` ids are illustrative; the guides never
 * embed them in a runnable URL (docs/developers uses shell variables instead).
 */
export const EXAMPLE_ENVELOPE_ID = '11111111-1111-4111-8111-111111111111';
export const EXAMPLE_RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const time = '2026-09-27T10:00:00.000Z';
export const recipientExample = {
  name: 'Alex Morgan',
  email: 'alex@example.com',
  role: 'SIGNER',
  routingOrder: 1,
};
export const fieldsExample = {
  fields: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      recipientId: EXAMPLE_RECIPIENT_ID,
      type: 'SIGNATURE',
      pageNumber: 1,
      ratioX: 0.1,
      ratioY: 0.7,
      ratioWidth: 0.3,
      ratioHeight: 0.08,
      required: true,
    },
  ],
};
const recipient = {
  id: EXAMPLE_RECIPIENT_ID,
  ...recipientExample,
  status: 'PENDING',
  colorIndex: 0,
};
const detailExcerpt = {
  id: EXAMPLE_ENVELOPE_ID,
  title: 'Consulting agreement',
  status: 'DRAFT',
  draftRevision: 0,
  pageCount: 1,
  recipients: [],
  fields: [],
  versions: [{ versionNumber: 0, isFinal: false }],
};

const SERVER_OPERATIONS: readonly OperationContract[] = [
  {
    id: 'upload',
    caller: 'server',
    group: 'envelopes',
    apiKey: 'write',
    embed: null,
    idempotency: 'optional',
    rateLimit: 'createAndSend',
    method: 'POST',
    path: '/envelopes',
    title: 'Upload a PDF',
    description:
      'Create a draft from one PDF. Save the returned id and draftRevision for the next steps.',
    inputs: [
      'Multipart file (required): PDF, up to 25 MiB and 500 pages; encrypted PDFs are rejected.',
      'title (optional): 1–200 characters; defaults to the filename without its extension.',
      'documentCategory (optional): defaults to OTHER. jurisdictionCode (optional): overrides the workspace default. Policy is fixed at creation.',
      'externalId (optional): your own id for this document, 1–200 characters of letters, digits and _ . : @ -. Not unique. Echoed in every webhook and used to filter the list.',
      'metadata (optional): a JSON object as text, up to 10 string values and 2 KB in total. Echoed in every webhook.',
      'Idempotency-Key (optional): 8–128 letters, digits, dots, dashes or colons. Repeating the same key and body within 24 hours returns the envelope the first request created (Idempotency-Replayed: true) instead of a second draft. Without a key, every request creates a new draft.',
    ],
    response: detailExcerpt,
    responseNote:
      '201 · Envelope detail (excerpt). This uploads and creates together; there is no separate upload endpoint.',
    errorCodes: [
      'FILE_REQUIRED',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_FILE_TYPE',
      'DOCUMENT_CATEGORY_BLOCKED',
      'INVALID_PDF',
      'ENCRYPTED_PDF',
      'PAGE_LIMIT_EXCEEDED',
      'MALWARE_DETECTED',
      'IDEMPOTENCY_KEY_MISMATCH',
    ],
    errorNote:
      'Uploads are scanned and validated before use. Reusing an Idempotency-Key with a different body answers IDEMPOTENCY_KEY_MISMATCH.',
  },
  {
    id: 'list',
    caller: 'server',
    group: 'envelopes',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes',
    title: 'List documents',
    description: 'Browse documents across the workspace, including documents created by people.',
    inputs: [
      'view: all (default), attention, waiting, completed, cancelled or drafts.',
      'status: optional envelope status. limit: 1–100 (default 20). cursor: nextCursor from the previous response.',
      'Pass the returned cursor unchanged and URL-encode it. Continue until nextCursor is null.',
      'externalId: only documents created with exactly this id. Recover a document whose creation response you lost.',
    ],
    query: '?view=drafts&limit=20',
    response: { items: [], nextCursor: null },
    responseNote: '200 · Paginated envelope summaries. An empty workspace returns this example.',
    errorCodes: ['VALIDATION_FAILED'],
    errorNote: 'Invalid query parameters are refused.',
  },
  {
    id: 'counts',
    caller: 'server',
    group: 'envelopes',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/counts',
    title: 'Count documents',
    description: 'Get a count for each dashboard view.',
    inputs: ['No request body or query parameters.'],
    response: { all: 0, attention: 0, waiting: 0, completed: 0, cancelled: 0, drafts: 0 },
    responseNote: '200 · Counts by view; views may overlap.',
    errorCodes: [],
    errorNote: 'Authentication and access errors apply to every operation.',
  },
  {
    id: 'detail',
    caller: 'server',
    group: 'envelopes',
    apiKey: 'read',
    embed: 'read',
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/:id',
    title: 'Read a document',
    description:
      'Get status, recipients, fields, versions, policy, draftRevision and the first part of the audit trail.',
    inputs: [
      'id: the envelope UUID returned by upload.',
      'Optional If-None-Match: a previously returned ETag. An unchanged document returns 304 with no body.',
      'Use eventsCursor for remaining audit events. For the completed PDF, find versions[].isFinal and use its versionNumber.',
    ],
    response: detailExcerpt,
    responseNote: '200 · Envelope detail (excerpt); 304 when unchanged.',
    errorCodes: ['NOT_FOUND'],
    errorNote: 'A document that is not in this workspace is NOT_FOUND, never forbidden.',
  },
  {
    id: 'events',
    caller: 'server',
    group: 'envelopes',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/:id/events',
    title: 'Read audit events',
    description:
      'Page through the audit trail, oldest first. These are audit records, not webhook deliveries.',
    inputs: [
      'id: envelope UUID. limit: 1–100 (default 20). cursor: eventsCursor or the previous nextCursor.',
    ],
    query: '?limit=20',
    response: {
      items: [
        {
          sequence: 1,
          action: 'ENVELOPE_CREATED',
          timestamp: time,
          actorUserId: '44444444-4444-4444-8444-444444444444',
          recipientId: null,
          eventHash: 'a'.repeat(64),
        },
      ],
      nextCursor: null,
    },
    responseNote: '200 · Audit records and continuation cursor.',
    errorCodes: ['NOT_FOUND'],
    errorNote: 'Invalid query parameters are refused.',
  },
  {
    id: 'file',
    caller: 'server',
    group: 'files',
    apiKey: 'read',
    embed: 'read',
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/:id/file',
    title: 'Download a PDF',
    description: 'Read the original, an intermediate signed version or the final sealed document.',
    inputs: [
      'version: non-negative integer; defaults to 0 (the original).',
      'For the sealed PDF, use finalVersionNumber from envelope.completed, or the version marked isFinal in document detail.',
      'Optional If-None-Match: the file ETag; unchanged files return 304 without bytes.',
    ],
    query: '?version=0',
    response: 'HTTP 200\nContent-Type: application/pdf\n\n<PDF bytes saved to document.pdf>',
    responseNote: '200 · Binary PDF, not JSON. Version 0 does not include signatures.',
    errorCodes: ['NOT_FOUND', 'ENVELOPE_PURGED'],
    errorNote: 'ENVELOPE_PURGED once retention has removed the file.',
  },
  {
    id: 'document-original',
    caller: 'server',
    group: 'files',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/:id/documents/original',
    title: 'Download the original PDF',
    description: 'The PDF exactly as it was uploaded, with no signatures. Same bytes as version 0.',
    inputs: [
      'Optional If-None-Match: the ETag from an earlier response; unchanged files return 304.',
    ],
    response: 'HTTP 200\nContent-Type: application/pdf\n\n<PDF bytes saved to original.pdf>',
    responseNote: '200 · Binary PDF, not JSON.',
    errorCodes: ['NOT_FOUND', 'ENVELOPE_PURGED'],
    errorNote: 'ENVELOPE_PURGED once retention has removed the file.',
  },
  {
    id: 'document-completed',
    caller: 'server',
    group: 'files',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/envelopes/:id/documents/completed',
    title: 'Download the completed PDF',
    description:
      'The sealed document with every signature and the certificate pages, without needing its version number.',
    inputs: [
      'Available once the envelope is completed (after envelope.completed). Before that the request returns 409.',
      'Optional If-None-Match: the ETag from an earlier response; the sealed file never changes, so 304 is safe to rely on.',
    ],
    response: 'HTTP 200\nContent-Type: application/pdf\n\n<PDF bytes saved to completed.pdf>',
    responseNote:
      '200 · Binary PDF, not JSON. The SHA-256 of these bytes is the envelope’s finalHash.',
    errorCodes: ['CONFLICT', 'NOT_FOUND', 'ENVELOPE_PURGED'],
    errorNote: 'CONFLICT until the envelope is completed.',
  },
  {
    id: 'document-certificate',
    caller: 'server',
    group: 'files',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: 'certificate',
    method: 'GET',
    path: '/envelopes/:id/documents/certificate',
    title: 'Download the certificate pages',
    description:
      'Only the certificate of completion, cut from the sealed PDF when you ask. Nothing extra is stored.',
    inputs: [
      'Available once the envelope is completed; before that the request returns 409.',
      'Limited to 30 requests a minute per workspace. Keep the file rather than asking again; an unchanged one answers If-None-Match with 304.',
    ],
    response: 'HTTP 200\nContent-Type: application/pdf\n\n<PDF bytes saved to certificate.pdf>',
    responseNote:
      '200 · Binary PDF, not JSON. Its pages are the certificate pages of the completed file.',
    errorCodes: ['CONFLICT', 'RATE_LIMITED', 'NOT_FOUND', 'ENVELOPE_PURGED'],
    errorNote:
      'CONFLICT until the envelope is completed. After 30 requests a minute the request is RATE_LIMITED.',
  },
  {
    id: 'update',
    caller: 'server',
    group: 'drafts',
    apiKey: 'write',
    embed: 'edit',
    idempotency: 'none',
    rateLimit: null,
    method: 'PATCH',
    path: '/envelopes/:id',
    title: 'Update a draft',
    revision: true,
    description:
      'Change draft settings before sending. Save draftRevision from each successful edit.',
    inputs: [
      'At least one of: title (1–200 characters), message (up to 2,000 characters; null clears it), sequentialSigning (boolean).',
      'With sequentialSigning true, equal routingOrder values sign together; lower groups go first.',
      'externalId (string or null) and metadata (object or null) replace your reference while the document is a draft; they are fixed once it is sent.',
    ],
    body: { title: 'Consulting agreement', sequentialSigning: true },
    response: { draftRevision: 1 },
    responseNote: '200 · New draft revision.',
    errorCodes: ['ENVELOPE_NOT_DRAFT', 'DRAFT_REVISION_MISMATCH'],
    errorNote: 'A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    id: 'recipient-add',
    caller: 'server',
    group: 'drafts',
    apiKey: 'write',
    embed: 'edit',
    idempotency: 'none',
    rateLimit: null,
    method: 'POST',
    path: '/envelopes/:id/recipients',
    title: 'Add a recipient',
    revision: true,
    description: 'Add someone to the draft; retain recipient.id to assign their fields.',
    inputs: [
      'name (required): 1–200 characters. email (required): valid email address.',
      'role: SIGNER (default), APPROVER, VIEWER or CC. routingOrder: optional integer 1–50, defaults to the end.',
      'Up to 50 recipients. SIGNER needs a required field; APPROVER may approve without fields.',
    ],
    body: recipientExample,
    response: { recipient, draftRevision: 1 },
    responseNote: '201 · Recipient and new revision.',
    errorCodes: ['RECIPIENT_EMAIL_TAKEN', 'ENVELOPE_NOT_DRAFT', 'DRAFT_REVISION_MISMATCH'],
    errorNote: 'A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    id: 'recipient-update',
    caller: 'server',
    group: 'drafts',
    apiKey: 'write',
    embed: 'edit',
    idempotency: 'none',
    rateLimit: null,
    method: 'PATCH',
    path: '/envelopes/:id/recipients/:recipientId',
    title: 'Update a recipient',
    revision: true,
    description:
      'Change a draft recipient. Switching to VIEWER or CC removes fields assigned to them.',
    inputs: [
      'id and recipientId: returned UUIDs. Supply at least one of name, email, role or routingOrder, with the same limits as adding a recipient.',
    ],
    body: { name: 'Alex Taylor' },
    response: { recipient: { ...recipient, name: 'Alex Taylor' }, draftRevision: 2 },
    responseNote: '200 · Recipient and new revision; fieldsRemoved may also be returned.',
    errorCodes: [
      'NOT_FOUND',
      'RECIPIENT_EMAIL_TAKEN',
      'ENVELOPE_NOT_DRAFT',
      'DRAFT_REVISION_MISMATCH',
    ],
    errorNote: 'A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    id: 'recipient-delete',
    caller: 'server',
    group: 'drafts',
    apiKey: 'write',
    embed: 'edit',
    idempotency: 'none',
    rateLimit: null,
    method: 'DELETE',
    path: '/envelopes/:id/recipients/:recipientId',
    title: 'Remove a recipient',
    revision: true,
    description: 'Remove a draft recipient and all of their fields.',
    inputs: ['id and recipientId: returned UUIDs. No request body.'],
    response: { draftRevision: 2 },
    responseNote: '200 · New revision; the response is JSON, not an empty 204.',
    errorCodes: ['NOT_FOUND', 'ENVELOPE_NOT_DRAFT', 'DRAFT_REVISION_MISMATCH'],
    errorNote: 'A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    id: 'fields',
    caller: 'server',
    group: 'drafts',
    apiKey: 'write',
    embed: 'edit',
    idempotency: 'none',
    rateLimit: null,
    method: 'PUT',
    path: '/envelopes/:id/fields',
    title: 'Place signing fields',
    revision: true,
    description: 'Replace the entire layout. Include every field you want to keep.',
    inputs: [
      'fields: up to 1,000 entries. Each needs a new client-generated UUID id, recipientId, type and pageNumber (starting at 1). Keep the same field id on later saves.',
      'type: SIGNATURE, INITIALS, DATE_SIGNED, TEXT_INPUT or CHECKBOX. required defaults to true.',
      'ratioX, ratioY, ratioWidth, ratioHeight: page-relative fractions, not pixels. Origin is top-left. Width and height must be positive and the box must fit inside the page.',
      'Only SIGNER and APPROVER recipients can own fields. Replace the example recipientId with the id returned when adding the recipient.',
    ],
    body: fieldsExample,
    response: { ...fieldsExample, draftRevision: 2 },
    responseNote: '200 · Saved fields and new revision.',
    errorCodes: [
      'INVALID_COORDINATE_SPACE',
      'RATIO_OUT_OF_RANGE',
      'FIELD_EXCEEDS_PAGE',
      'PAGE_OUT_OF_RANGE',
      'DRAFT_REVISION_MISMATCH',
    ],
    errorNote:
      'Pixel coordinates are refused with INVALID_COORDINATE_SPACE. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    id: 'send',
    caller: 'server',
    group: 'lifecycle',
    apiKey: 'write',
    embed: 'send',
    idempotency: 'required',
    rateLimit: 'createAndSend',
    method: 'POST',
    path: '/envelopes/:id/send',
    title: 'Send for signing',
    description:
      'Validate the draft and queue invitations. Signing happens on Envelope through emailed links.',
    inputs: [
      'Optional JSON: expiresInDays (1–90), message (up to 2,000 characters or null), reminderIntervalDays (1–30 or null to disable). Omitted timing values use server defaults.',
      'Idempotency-Key (required): 8–128 letters, digits, dots, dashes or colons; a UUID is ideal. Reuse the same key and body on a network retry within 24 hours. A replay includes Idempotency-Replayed: true.',
      'Sending is asynchronous: a successful response does not mean mail has arrived or signing is complete. Wait for envelope.completed before downloading the sealed version.',
    ],
    body: { expiresInDays: 14, reminderIntervalDays: 3 },
    response: {
      id: EXAMPLE_ENVELOPE_ID,
      status: 'SENT',
      sentAt: time,
      expiresAt: '2026-10-11T10:00:00.000Z',
      invited: [{ id: EXAMPLE_RECIPIENT_ID, status: 'SENT' }],
    },
    responseNote: '200 · Sent envelope and recipients invited now. No signing tokens are returned.',
    errorCodes: [
      'NOT_READY_TO_SEND',
      'ENVELOPE_NOT_DRAFT',
      'IDEMPOTENCY_KEY_REQUIRED',
      'IDEMPOTENCY_KEY_MISMATCH',
      'NOT_FOUND',
    ],
    errorNote:
      'NOT_READY_TO_SEND lists every readiness problem in `errors`. Retry after a network failure with the same Idempotency-Key and body.',
  },
  {
    id: 'void',
    caller: 'server',
    group: 'lifecycle',
    apiKey: 'write',
    embed: null,
    idempotency: 'none',
    rateLimit: 'lifecycle',
    method: 'POST',
    path: '/envelopes/:id/void',
    title: 'Cancel or discard',
    description:
      'Cancel a sent envelope so its links stop working and the people emailed are told why, or discard a draft.',
    inputs: [
      'JSON reason (1–1,000 characters): required for a sent envelope, optional for a draft. It is emailed to recipients and is not stored in the audit trail.',
      'A full-access key only. Fires envelope.voided. Limited to 30 requests a minute per workspace, shared with reminders and deadline changes.',
    ],
    body: { reason: 'Sent to the wrong patient' },
    response: { id: EXAMPLE_ENVELOPE_ID, status: 'VOIDED', voidedAt: time, discarded: false },
    responseNote: '200 · discarded is true when a draft was thrown away and nobody was emailed.',
    errorCodes: ['ENVELOPE_TERMINAL', 'ENVELOPE_ON_LEGAL_HOLD', 'VALIDATION_FAILED', 'NOT_FOUND'],
    errorNote: 'ENVELOPE_TERMINAL when the envelope is already completed, declined or cancelled.',
  },
  {
    id: 'remind',
    caller: 'server',
    group: 'lifecycle',
    apiKey: 'write',
    embed: null,
    idempotency: 'none',
    rateLimit: 'lifecycle',
    method: 'POST',
    path: '/envelopes/:id/remind',
    title: 'Send a reminder',
    description:
      'Email a fresh signing link to the people whose turn it is and who have not finished. The previous link stops working.',
    inputs: [
      'Optional JSON: recipientIds, a list of recipient UUIDs. Omitted, it reminds everyone whose turn it is.',
      'One reminder per person per 24 hours: anyone reminded sooner comes back in skipped with a reason, and if nobody could be reminded the request answers 429 REMINDER_TOO_SOON with Retry-After. A full-access key only; shares the 30 a minute workspace limit with cancel.',
    ],
    body: {},
    response: {
      reminded: [EXAMPLE_RECIPIENT_ID],
      skipped: [{ recipientId: '77777777-7777-4777-8777-777777777777', reason: 'TOO_SOON' }],
    },
    responseNote: '200 · Recipients reminded now, and those skipped with the reason for each.',
    errorCodes: [
      'CONFLICT',
      'ENVELOPE_TERMINAL',
      'ENVELOPE_EXPIRED',
      'REMINDER_TOO_SOON',
      'RATE_LIMITED',
      'NOT_FOUND',
    ],
    errorNote:
      'REMINDER_TOO_SOON (429, with Retry-After) when everyone due was already reminded in the last 24 hours.',
  },
];

export const EXAMPLE_TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';
const templateRoleExample = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Patient',
  role: 'SIGNER',
  routingOrder: 1,
  colorIndex: 0,
};
export const templateSummaryExample = {
  id: EXAMPLE_TEMPLATE_ID,
  name: 'Intake consent',
  description: null,
  pageCount: 2,
  documentCategory: 'OTHER',
  roleCount: 1,
  fieldCount: 1,
  archivedAt: null,
  createdAt: time,
  createdByName: 'Jordan Lee',
};
export const templateDetailExample = {
  ...templateSummaryExample,
  defaultMessage: null,
  sequentialSigning: false,
  reminderIntervalDays: null,
  roles: [templateRoleExample],
  fields: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      templateRoleId: templateRoleExample.id,
      type: 'SIGNATURE',
      pageNumber: 1,
      ratioX: 0.1,
      ratioY: 0.7,
      ratioWidth: 0.3,
      ratioHeight: 0.08,
      required: true,
    },
  ],
};

export const EXAMPLE_BATCH_ID = '77777777-7777-4777-8777-777777777777';
export const bulkBatchSummaryExample = {
  id: EXAMPLE_BATCH_ID,
  templateId: EXAMPLE_TEMPLATE_ID,
  templateName: 'Intake consent',
  status: 'COMPLETED',
  send: true,
  totalRows: 2,
  succeededRows: 1,
  failedRows: 1,
  createdAt: time,
  finishedAt: time,
};
export const bulkRowsExample = {
  rows: [
    { recipients: [{ role: 'Patient', name: 'Alex Morgan', email: 'alex@example.com' }] },
    { recipients: [{ role: 'Patient', name: 'Sam Lee', email: 'sam@example.com' }] },
  ],
  send: true,
};

const TEMPLATE_OPERATIONS: readonly OperationContract[] = [
  {
    id: 'template-create',
    caller: 'server',
    group: 'templates',
    apiKey: 'write',
    embed: null,
    idempotency: 'none',
    rateLimit: 'lifecycle',
    method: 'POST',
    path: '/templates',
    title: 'Save an envelope as a template',
    description:
      'Turn a prepared envelope into a reusable template: its PDF, its people as named roles, and where they sign. The template keeps its own copy of the PDF.',
    inputs: [
      'envelopeId (required): an envelope in your workspace with at least one person and every signer given a required field. It may be a draft or already sent.',
      'name (required): 1–120 characters, different from every other active template.',
      'description (optional): up to 1,000 characters.',
      'roleNames (optional): an object from recipient id to the role’s name, such as "Patient". A role is named after the person on the envelope unless listed here. Names must differ.',
    ],
    body: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      name: 'Intake consent',
      roleNames: { [EXAMPLE_RECIPIENT_ID]: 'Patient' },
    },
    response: templateDetailExample,
    responseNote: '201 · The template, with its roles and fields.',
    errorCodes: ['NOT_FOUND', 'NOT_READY_TO_SEND', 'TEMPLATE_NAME_TAKEN', 'ENVELOPE_PURGED'],
    errorNote:
      'NOT_READY_TO_SEND lists what the envelope still needs, exactly as the send operation does. Only a full-access key, never a read-only one, can save templates.',
  },
  {
    id: 'template-list',
    caller: 'server',
    group: 'templates',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/templates',
    title: 'List templates',
    description: 'Active templates, newest first. Use an id from here to create envelopes from it.',
    inputs: [
      'archived (optional query): true lists archived templates instead. Defaults to false.',
    ],
    query: 'archived=false',
    response: { templates: [templateSummaryExample] },
    responseNote: '200 · Template summaries, at most 500.',
    errorCodes: [],
    errorNote: 'No operation-specific errors.',
  },
  {
    id: 'template-get',
    caller: 'server',
    group: 'templates',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/templates/:id',
    title: 'Read a template',
    description:
      'One template with its roles and fields. An archived template can still be read, but cannot start new envelopes.',
    inputs: ['id (path): the template id.'],
    response: templateDetailExample,
    responseNote: '200 · The template with its roles and fields.',
    errorCodes: ['TEMPLATE_NOT_FOUND'],
    errorNote: 'TEMPLATE_NOT_FOUND when the id is not in your workspace.',
  },
  {
    id: 'template-envelope',
    caller: 'server',
    group: 'templates',
    apiKey: 'write',
    embed: null,
    idempotency: 'optional',
    rateLimit: 'createAndSend',
    method: 'POST',
    path: '/templates/:id/envelopes',
    title: 'Create an envelope from a template',
    description:
      'Give each role of the template a name and an email, and get a draft (or a sent envelope) with the people, fields and signing order already in place. It is an ordinary envelope from then on.',
    inputs: [
      'recipients (required): one entry per role of the template, each `{ role, name, email }`, where `role` is the template role’s name (for example "Patient"). No role may be missing or repeated, and no email may be used twice.',
      'send (optional): true sends it at once, false (the default) leaves a draft you can still edit.',
      'message (optional): the note in the invitation; defaults to the template’s. title (optional): defaults to the template’s name.',
      'externalId and metadata (optional): as on upload.',
      'Idempotency-Key (optional): as on upload. Repeating the same key and body within 24 hours returns the envelope the first request created (Idempotency-Replayed: true).',
    ],
    body: {
      recipients: [{ role: 'Patient', name: 'Alex Morgan', email: 'alex@example.com' }],
      send: false,
    },
    response: detailExcerpt,
    responseNote:
      '201 · Envelope detail (excerpt). Policy is frozen when this call runs, not when the template was saved.',
    errorCodes: [
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_ARCHIVED',
      'TEMPLATE_ROLE_MISMATCH',
      'DOCUMENT_CATEGORY_BLOCKED',
      'IDEMPOTENCY_KEY_MISMATCH',
    ],
    errorNote:
      'TEMPLATE_ROLE_MISMATCH lists each problem in `errors`. DOCUMENT_CATEGORY_BLOCKED when the workspace’s policy no longer allows the template’s category.',
  },
  {
    id: 'bulk-create',
    caller: 'server',
    group: 'templates',
    apiKey: 'write',
    embed: null,
    idempotency: 'optional',
    rateLimit: 'bulkBatch',
    method: 'POST',
    path: '/templates/:id/bulk',
    title: 'Start a bulk send',
    description:
      'Create one envelope per row from a template. The call answers at once with a batch id; envelopes are created, and sent if you ask, in the background, one row at a time. A row that fails never stops the others.',
    inputs: [
      'rows (required): 1 to 500 entries, each `{ recipients, externalId?, metadata? }`. `recipients` has one `{ role, name, email }` for every role of the template, as when creating one envelope.',
      'send (optional): true sends each envelope as it is created, false (the default) leaves them drafts.',
      'message (optional): the note in every invitation; defaults to the template’s.',
      'A row whose people do not match the template’s roles is accepted and then reported as failed with TEMPLATE_ROLE_MISMATCH; check a batch with the list and read operations.',
      'Idempotency-Key (optional): repeating the same key and body within 24 hours returns the same batch id (Idempotency-Replayed: true) instead of a second batch.',
    ],
    body: bulkRowsExample,
    response: { batchId: EXAMPLE_BATCH_ID },
    responseNote: '202 · The batch is accepted and running; poll it for progress.',
    errorCodes: [
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_ARCHIVED',
      'BULK_TOO_LARGE',
      'IDEMPOTENCY_KEY_MISMATCH',
    ],
    errorNote:
      'BULK_TOO_LARGE above 500 rows. A malformed row (a bad email, a missing name) refuses the whole request with VALIDATION_FAILED and nothing is stored.',
  },
  {
    id: 'bulk-list',
    caller: 'server',
    group: 'templates',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/bulk-batches',
    title: 'List bulk batches',
    description: 'The most recent batches, newest first.',
    inputs: ['No parameters.'],
    response: { batches: [bulkBatchSummaryExample] },
    responseNote: '200 · Up to 100 batch summaries.',
    errorCodes: [],
    errorNote: 'No operation-specific errors.',
  },
  {
    id: 'bulk-get',
    caller: 'server',
    group: 'templates',
    apiKey: 'read',
    embed: null,
    idempotency: 'none',
    rateLimit: null,
    method: 'GET',
    path: '/bulk-batches/:id',
    title: 'Read a bulk batch',
    description:
      'Progress and the outcome of every row: the envelope it created, or the error code it failed with. Rows never carry an email address.',
    inputs: ['id (path): the batchId from starting the batch.'],
    response: {
      ...bulkBatchSummaryExample,
      rows: [
        { rowIndex: 0, status: 'SUCCEEDED', envelopeId: EXAMPLE_ENVELOPE_ID, errorCode: null },
        { rowIndex: 1, status: 'FAILED', envelopeId: null, errorCode: 'TEMPLATE_ROLE_MISMATCH' },
      ],
    },
    responseNote: '200 · `status` is PROCESSING until every row has a result, then COMPLETED.',
    errorCodes: ['BULK_BATCH_NOT_FOUND'],
    errorNote: 'BULK_BATCH_NOT_FOUND when the id is not one of your batches.',
  },
  {
    id: 'template-update',
    caller: 'server',
    group: 'templates',
    apiKey: 'write',
    embed: null,
    idempotency: 'none',
    rateLimit: 'lifecycle',
    method: 'PATCH',
    path: '/templates/:id',
    title: 'Rename, archive or restore a template',
    description:
      'Change a template’s name, description, default message or whether it is archived. The layout cannot be edited: save a new template instead.',
    inputs: [
      'name (optional): 1–120 characters, different from every other active template.',
      'description and defaultMessage (optional): text, or null to clear.',
      'archived (optional): true hides the template from new use, false restores it.',
      'Send at least one of these.',
    ],
    body: { archived: true },
    response: { ...templateDetailExample, archivedAt: time },
    responseNote: '200 · The updated template.',
    errorCodes: ['TEMPLATE_NOT_FOUND', 'TEMPLATE_NAME_TAKEN'],
    errorNote: 'TEMPLATE_NAME_TAKEN when a rename or restore would duplicate an active name.',
  },
];

const EMBEDDED_OPERATIONS: readonly OperationContract[] = [
  {
    id: 'embed-session-issue',
    caller: 'server',
    group: 'embedded',
    apiKey: 'write',
    embed: null,
    idempotency: 'optional',
    rateLimit: 'embedManage',
    method: 'POST',
    path: '/embed/sessions',
    title: 'Issue an embedded editor session',
    description:
      'Authorize one staff member to prepare one document (or upload one) inside the embedded editor. Call it from your backend after authorizing your own user and record.',
    inputs: [
      'mode (required): existing (reopen a draft you uploaded) or upload (staff upload inside the editor).',
      'envelopeId: required for existing, forbidden for upload.',
      'parentOrigin (required): the exact HTTPS origin of the page that will host the iframe. It must be registered on this API key first; loopback HTTP is accepted for local testing only.',
      'externalActorId (required): your own opaque id for the staff member, 1–200 characters. Recorded in the audit trail.',
      'actions (required): [edit] or [edit, send]. Editing is always required.',
      'externalId and metadata (upload mode only, optional): recorded on the draft the upload creates and echoed in every webhook.',
      'Idempotency-Key (optional): a retry after a lost response returns a fresh launchToken for the same session, and the earlier token stops working.',
    ],
    body: {
      mode: 'existing',
      envelopeId: EXAMPLE_ENVELOPE_ID,
      parentOrigin: 'https://app.example.com',
      externalActorId: 'staff:123',
      actions: ['edit', 'send'],
    },
    response: {
      sessionId: '66666666-6666-4666-8666-666666666666',
      launchToken: `eel_${'a'.repeat(64)}`,
      launchExpiresAt: time,
      frameUrl: 'https://envelope.example/api/v1/embed/frame/66666666-6666-4666-8666-666666666666',
    },
    responseNote:
      '201 · The launch token is valid for 60 seconds and redeemable once; keep it in memory. Send it to your browser with Cache-Control: no-store and never log it.',
    errorCodes: [
      'EMBED_ORIGIN_NOT_ALLOWED',
      'API_KEY_READ_ONLY',
      'NOT_FOUND',
      'ENVELOPE_NOT_DRAFT',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'IDEMPOTENCY_KEY_MISMATCH',
    ],
    errorNote:
      'EMBED_ORIGIN_NOT_ALLOWED when parentOrigin is not registered on this key; ENVELOPE_NOT_DRAFT when reopening a document that was already sent.',
  },
  {
    id: 'embed-session-revoke',
    caller: 'server',
    group: 'embedded',
    apiKey: 'write',
    embed: null,
    idempotency: 'none',
    rateLimit: 'embedManage',
    method: 'DELETE',
    path: '/embed/sessions/:id',
    title: 'Revoke an embedded editor session',
    description:
      'End a session immediately, for example when your staff member signs out. Only the API key that issued the session can revoke it.',
    inputs: ['id: the sessionId returned when the session was issued. No request body.'],
    response: 'HTTP 204 No Content',
    responseNote: '204 · No body.',
    errorCodes: ['NOT_FOUND', 'API_KEY_READ_ONLY', 'RATE_LIMITED'],
    errorNote: 'NOT_FOUND if the session belongs to another key or workspace.',
  },
  {
    id: 'embed-close',
    caller: 'editor',
    group: 'embedded',
    apiKey: null,
    embed: 'close',
    idempotency: 'none',
    rateLimit: null,
    method: 'POST',
    path: '/embed/session/close',
    title: 'Close the embedded editor (editor only)',
    description: 'Called by the editor itself with its own session token. Not for partner code.',
    inputs: ['No request body.'],
    response: 'HTTP 204 No Content',
    responseNote: '204 · No body.',
    errorCodes: ['EMBED_SESSION_INVALID', 'EMBED_SESSION_EXPIRED'],
    errorNote: 'An expired or revoked session token is refused.',
  },
  {
    id: 'embed-upload',
    caller: 'editor',
    group: 'embedded',
    apiKey: null,
    embed: 'upload',
    idempotency: 'none',
    rateLimit: null,
    method: 'POST',
    path: '/embed/session/envelope',
    title: 'Upload inside the editor (editor only)',
    description:
      'Called by the editor when staff choose a PDF in an upload-mode session. One session creates at most one draft; a retry returns that draft.',
    inputs: ['Multipart file (required), with the same limits as the upload operation.'],
    response: detailExcerpt,
    responseNote: '201 · The draft this session created.',
    errorCodes: ['EMBED_UPLOAD_BOUND', 'EMBED_SCOPE_DENIED', 'FILE_REQUIRED'],
    errorNote: 'EMBED_UPLOAD_BOUND when this session already produced a draft.',
  },
];

export const INTEGRATION_OPERATIONS: readonly OperationContract[] = [
  ...SERVER_OPERATIONS,
  ...TEMPLATE_OPERATIONS,
  ...EMBEDDED_OPERATIONS,
];

/** What a partner's backend calls: every operation an API key can reach. */
export const API_KEY_OPERATIONS: readonly OperationContract[] = INTEGRATION_OPERATIONS.filter(
  (operation) => operation.apiKey !== null,
);

export function operationById(id: string): OperationContract | undefined {
  return INTEGRATION_OPERATIONS.find((operation) => operation.id === id);
}

/** `POST /envelopes/:id/send`, the form the docs and tests compare against controller routes. */
export function operationRoute(operation: OperationContract): string {
  return `${operation.method} ${operation.path}`;
}

export interface RateLimitContract {
  limit: number;
  windowSeconds: number;
  scope: string;
  covers: string;
}

/** Numbers mirror `LIMITS` in the API; a test compares them. */
export const RATE_LIMITS: Record<RateLimitName, RateLimitContract> = {
  createAndSend: {
    limit: 100,
    windowSeconds: 60,
    scope: 'workspace',
    covers: 'Creating an envelope and sending one, counted together.',
  },
  lifecycle: {
    limit: 30,
    windowSeconds: 60,
    scope: 'workspace',
    covers: 'Cancelling and reminding, and saving or changing templates, counted together.',
  },
  certificate: {
    limit: 30,
    windowSeconds: 60,
    scope: 'workspace',
    covers: 'Downloading certificate pages, which are cut from the sealed PDF on request.',
  },
  bulkBatch: {
    limit: 10,
    windowSeconds: 3600,
    scope: 'workspace',
    covers: 'Starting bulk batches. Each batch may hold up to 500 rows.',
  },
  embedManage: {
    limit: 30,
    windowSeconds: 60,
    scope: 'workspace and API key',
    covers: 'Issuing and revoking embedded editor sessions, each counted separately.',
  },
};

export interface WebhookEventReference {
  description: string;
  data: object;
}

const person = {
  envelopeId: EXAMPLE_ENVELOPE_ID,
  envelopeTitle: 'Consulting agreement',
  recipientId: EXAMPLE_RECIPIENT_ID,
  recipientEmail: 'alex@example.com',
};
export const WEBHOOK_EVENT_REFERENCE: Record<FiredWebhookEventType, WebhookEventReference> = {
  'envelope.sent': {
    description:
      'The envelope was sent and invitations were queued; this does not confirm inbox delivery.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeTitle: 'Consulting agreement',
      envelopeStatus: 'SENT',
      sentAt: time,
      expiresAt: '2026-10-11T10:00:00.000Z',
      recipientCount: 1,
      invitedCount: 1,
    },
  },
  'envelope.viewed': {
    description: 'A recipient opened their link for the first time.',
    data: { ...person, envelopeStatus: 'SENT', viewedAt: time },
  },
  'recipient.consented': {
    description: 'A recipient accepted electronic signing consent.',
    data: { ...person, envelopeStatus: 'SENT', consentGivenAt: time },
  },
  'recipient.signed': {
    description: 'A recipient finished; the sealing worker may still be running.',
    data: {
      ...person,
      envelopeStatus: 'PARTIALLY_SIGNED',
      signedAt: time,
      allSigned: false,
      remainingSigners: 1,
    },
  },
  'recipient.declined': {
    description: 'A recipient declined and the envelope closed.',
    data: {
      ...person,
      declinedAt: time,
      envelopeStatus: 'DECLINED',
    },
  },
  'envelope.completed': {
    description: 'The final PDF is sealed. Use finalVersionNumber to download it.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeTitle: 'Consulting agreement',
      envelopeStatus: 'COMPLETED',
      completedAt: time,
      finalVersionNumber: 2,
      finalHash: 'a'.repeat(64),
    },
  },
  'envelope.voided': {
    description: 'The sender cancelled the envelope or discarded its draft.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeTitle: 'Consulting agreement',
      envelopeStatus: 'VOIDED',
      voidedAt: time,
      fromStatus: 'SENT',
      reason: 'Sent to the wrong patient',
    },
  },
  'envelope.expired': {
    description: 'The deadline passed with unfinished recipients. Signing is paused.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeTitle: 'Consulting agreement',
      envelopeStatus: 'EXPIRED',
      expiredAt: time,
      unsigned: 1,
    },
  },
  'envelope.extended': {
    description: 'The sender gave an expired envelope a new deadline, reopening it.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeTitle: 'Consulting agreement',
      envelopeStatus: 'SENT',
      expiresAt: '2026-11-11T10:00:00.000Z',
      previousExpiresAt: '2026-10-11T10:00:00.000Z',
      reopened: true,
      reinvitedCount: 1,
    },
  },
};
/** What every envelope event also carries: null and null when the partner set none (ADR 0019). */
export const WEBHOOK_REFERENCE_EXAMPLE = {
  externalId: 'visit:1001',
  metadata: { department: 'billing' },
};

/** The full JSON a receiver gets for one event type. */
export function webhookEventPayload(type: FiredWebhookEventType): object {
  return {
    id: 'evt_55555555-5555-4555-8555-555555555555',
    type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: time,
    data: { ...WEBHOOK_EVENT_REFERENCE[type].data, ...WEBHOOK_REFERENCE_EXAMPLE },
  };
}

export interface HeaderContract {
  name: string;
  direction: 'request' | 'response' | 'webhook';
  description: string;
}

export const INTEGRATION_HEADERS: readonly HeaderContract[] = [
  {
    name: 'Authorization',
    direction: 'request',
    description: 'Bearer <API key>. Required on every API request; keep the key on your server.',
  },
  {
    name: 'If-Match',
    direction: 'request',
    description:
      'The latest draftRevision, quoted, on every draft edit. A stale value answers 412 DRAFT_REVISION_MISMATCH.',
  },
  {
    name: 'Idempotency-Key',
    direction: 'request',
    description:
      '8–128 letters, digits, dots, dashes or colons. Required on send; optional on upload and on issuing an editor session. The same key and body within 24 hours replays the first result.',
  },
  {
    name: 'If-None-Match',
    direction: 'request',
    description:
      'An ETag from an earlier response. An unchanged document or file answers 304 with no body.',
  },
  {
    name: 'ETag',
    direction: 'response',
    description: 'A validator for the document detail and for PDF downloads.',
  },
  {
    name: 'Idempotency-Replayed',
    direction: 'response',
    description: 'true when the response is a replay of an earlier request with the same key.',
  },
  {
    name: 'Retry-After',
    direction: 'response',
    description: 'Seconds to wait before retrying a 429 response.',
  },
  {
    name: 'X-RateLimit-Limit',
    direction: 'response',
    description: 'The tightest limit that applies to the request, requests per window.',
  },
  {
    name: 'X-RateLimit-Remaining',
    direction: 'response',
    description: 'Requests left in the current window for that limit.',
  },
  {
    name: 'X-RateLimit-Reset',
    direction: 'response',
    description: 'Seconds until that window resets.',
  },
  {
    name: 'X-Request-Id',
    direction: 'response',
    description: 'Identifies the request in Envelope’s logs. Quote it when asking for help.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.signature,
    direction: 'webhook',
    description:
      'sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">. During a secret rotation it lists one signature per accepted secret, comma-separated.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.signatureTimestamp,
    direction: 'webhook',
    description:
      'Unix seconds when this attempt was signed. Reject anything older than five minutes.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.eventId,
    direction: 'webhook',
    description: 'The event id, the same on every retry and redrive. Deduplicate on this.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.eventType,
    direction: 'webhook',
    description: 'The event type, so you can route before parsing the body.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.deliveryId,
    direction: 'webhook',
    description: 'Identifies this delivery record; it is what the Deliveries screen shows.',
  },
  {
    name: WEBHOOK_DELIVERY_HEADERS.attempt,
    direction: 'webhook',
    description: 'The attempt number, starting at 1 and continuing across manual redrives.',
  },
];

export interface LimitContract {
  name: string;
  value: string;
  notes: string;
}

export const INTEGRATION_LIMITS: readonly LimitContract[] = [
  {
    name: 'PDF upload',
    value: `${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB, ${MAX_PDF_PAGES} pages`,
    notes: 'Encrypted and malformed PDFs are rejected.',
  },
  {
    name: 'Recipients per envelope',
    value: String(MAX_RECIPIENTS_PER_ENVELOPE),
    notes: 'Each email address once.',
  },
  {
    name: 'Fields per envelope',
    value: String(MAX_FIELDS_PER_ENVELOPE),
    notes: 'The whole layout is replaced on every save.',
  },
  {
    name: 'Invitation message',
    value: `${MAX_MESSAGE_LENGTH} characters`,
    notes: 'Also applies to the message sent with an envelope.',
  },
  {
    name: 'Cancel reason',
    value: `${MAX_VOID_REASON_LENGTH} characters`,
    notes: 'Emailed to recipients; not stored in the audit trail.',
  },
  {
    name: 'Signing deadline',
    value: `${DEFAULT_EXPIRY_DAYS} days by default, up to ${MAX_EXPIRY_DAYS}`,
    notes: 'Set with expiresInDays when sending.',
  },
  {
    name: 'Reminder cooldown',
    value: `${REMINDER_COOLDOWN_HOURS} hours per person`,
    notes: 'A reminder sooner than that is skipped.',
  },
  {
    name: 'externalId',
    value: `${MAX_EXTERNAL_ID_LENGTH} characters`,
    notes: 'Letters, digits and _ . : @ - only. Not unique.',
  },
  {
    name: 'metadata',
    value: `${MAX_METADATA_KEYS} string values, ${MAX_METADATA_BYTES / 1024} KB in total`,
    notes: 'Echoed in every webhook; fixed once the envelope is sent.',
  },
  {
    name: 'Webhook endpoints',
    value: `${MAX_WEBHOOK_ENDPOINTS_PER_TENANT} active, ${MAX_WEBHOOK_ENDPOINT_ROWS_PER_TENANT} saved`,
    notes: 'Inactive endpoints do not use an active slot; delete one to make room.',
  },
  {
    name: 'Webhook secret overlap',
    value: `${DEFAULT_WEBHOOK_SECRET_OVERLAP_HOURS} hours by default`,
    notes: 'How long the previous secret keeps verifying after a rotation.',
  },
  {
    name: 'Webhook API version',
    value: WEBHOOK_API_VERSION,
    notes: 'Additions are backward compatible; a breaking change would ship as v2.',
  },
];

export interface ErrorGuideEntry {
  meaning: string;
  action: string;
}

const badRequest = 'Fix the request and send it again.';

/** Codes a partner can meet, with what to do about them. Every other code is listed below. */
export const INTEGRATION_ERROR_GUIDE: Partial<Record<ErrorCode, ErrorGuideEntry>> = {
  BAD_REQUEST: { meaning: 'The request could not be understood.', action: badRequest },
  VALIDATION_FAILED: {
    meaning: 'A field is missing or invalid; `errors` lists each one by path.',
    action: badRequest,
  },
  UNAUTHENTICATED: {
    meaning: 'No credential was sent, or it is not one Envelope recognises.',
    action: 'Send `Authorization: Bearer <API key>`.',
  },
  FORBIDDEN: {
    meaning: 'The credential is valid but not allowed to do this.',
    action: 'Check the key’s access.',
  },
  NOT_FOUND: {
    meaning: 'The id does not exist in your workspace, or has been removed.',
    action: 'Check the id and that the key belongs to the workspace that owns the document.',
  },
  CONFLICT: {
    meaning: 'The request is valid but not possible in the document’s current state.',
    action: 'Read the document and act on its status.',
  },
  PAYLOAD_TOO_LARGE: { meaning: 'The request body is over the size limit.', action: badRequest },
  UNSUPPORTED_MEDIA_TYPE: {
    meaning: 'The content type is not accepted here.',
    action: 'Use multipart for uploads and JSON elsewhere.',
  },
  RATE_LIMITED: {
    meaning: 'Too many requests.',
    action: 'Wait `Retry-After` seconds, reduce concurrency and back off with jitter.',
  },
  INTERNAL_ERROR: {
    meaning: 'Something failed on Envelope’s side.',
    action: 'Retry with the same Idempotency-Key; quote `requestId` if it persists.',
  },
  SERVICE_UNAVAILABLE: {
    meaning: 'A dependency is temporarily unavailable.',
    action: 'Retry after a short delay.',
  },
  TEMPLATE_NOT_FOUND: {
    meaning: 'The template id does not exist in your workspace.',
    action: 'List templates and use an id from the result.',
  },
  TEMPLATE_ARCHIVED: {
    meaning: 'The template was archived, so it cannot start new envelopes or batches.',
    action: 'Use an active template, or ask an Admin to restore this one.',
  },
  TEMPLATE_NAME_TAKEN: {
    meaning: 'An active template in your workspace already has this name.',
    action: 'Choose another name, or archive the old template first.',
  },
  TEMPLATE_ROLE_MISMATCH: {
    meaning:
      'The people sent do not match the template’s roles: a role is missing, repeated or unknown, or an email is repeated.',
    action: 'Send exactly one person for each role of the template, each with a different email.',
  },
  BULK_TOO_LARGE: {
    meaning: 'A batch has more rows than the limit.',
    action: 'Split it into batches of at most 500 rows.',
  },
  BULK_BATCH_NOT_FOUND: {
    meaning: 'The batch id does not exist in your workspace.',
    action: 'Use the `batchId` returned when the batch was accepted.',
  },
  API_KEY_INVALID: {
    meaning: 'The bearer token is not a known, active API key.',
    action: 'Check the full key is set and has not been revoked.',
  },
  API_KEY_NOT_ALLOWED: {
    meaning: 'This endpoint needs a signed-in person; an API key cannot call it.',
    action: 'Use only the operations in the API reference.',
  },
  API_KEY_READ_ONLY: {
    meaning: 'A read-only key was used on an operation that writes.',
    action: 'Use a full-access key.',
  },
  EMBED_ORIGIN_NOT_ALLOWED: {
    meaning: 'parentOrigin is not registered on the API key that issued the session.',
    action: 'Register the exact origin on that key, then issue a new session.',
  },
  EMBED_SESSION_INVALID: {
    meaning: 'The embedded session token is unknown or revoked.',
    action: 'Issue a new session.',
  },
  EMBED_SESSION_EXPIRED: {
    meaning: 'The launch credential or session has expired.',
    action: 'Issue a new session and reopen the saved draft.',
  },
  EMBED_LAUNCH_USED: {
    meaning: 'The launch credential was already redeemed.',
    action: 'Issue a new session; a launch token works once.',
  },
  EMBED_SCOPE_DENIED: {
    meaning: 'The session was not granted this action, or another envelope was requested.',
    action: 'Issue a session with the needed actions.',
  },
  EMBED_UPLOAD_BOUND: {
    meaning: 'This upload session already created its draft.',
    action: 'Reopen the mapped envelope instead of uploading again.',
  },
  FILE_REQUIRED: {
    meaning: 'The upload had no file.',
    action: 'Send the PDF as multipart field `file`.',
  },
  FILE_TOO_LARGE: { meaning: 'The PDF is over the size limit.', action: 'Send a smaller file.' },
  UNSUPPORTED_FILE_TYPE: { meaning: 'Only PDF files are accepted.', action: 'Send a PDF.' },
  INVALID_PDF: { meaning: 'The file is not a valid PDF.', action: 'Re-export the PDF.' },
  ENCRYPTED_PDF: {
    meaning: 'Password-protected PDFs are not supported.',
    action: 'Remove the password.',
  },
  PAGE_LIMIT_EXCEEDED: { meaning: 'The PDF has too many pages.', action: 'Split the document.' },
  MALWARE_DETECTED: {
    meaning: 'The file failed the security scan.',
    action: 'Do not retry the same file.',
  },
  INVALID_COORDINATE_SPACE: {
    meaning: 'A field used pixels or points instead of page-relative ratios.',
    action: 'Send ratioX, ratioY, ratioWidth and ratioHeight between 0 and 1.',
  },
  RATIO_OUT_OF_RANGE: { meaning: 'A field ratio is outside 0–1.', action: badRequest },
  FIELD_EXCEEDS_PAGE: {
    meaning: 'A field runs off its page.',
    action: 'Reduce its size or move it.',
  },
  PAGE_OUT_OF_RANGE: {
    meaning: 'A field names a page the document does not have.',
    action: badRequest,
  },
  ENVELOPE_NOT_DRAFT: {
    meaning: 'Only a draft can be edited or sent.',
    action: 'Read the document; it may already be sent.',
  },
  ENVELOPE_TERMINAL: {
    meaning: 'The envelope is completed, declined or cancelled and cannot change.',
    action: 'Start a new envelope if needed.',
  },
  ENVELOPE_EXPIRED: {
    meaning: 'The signing deadline has passed and signing is paused.',
    action: 'A signed-in person can extend the deadline in the web app.',
  },
  RECIPIENT_EMAIL_TAKEN: {
    meaning: 'That email address is already a recipient.',
    action: 'Update the existing recipient.',
  },
  DRAFT_REVISION_MISMATCH: {
    meaning: 'The draft changed since you read it (HTTP 412).',
    action: 'Read the latest draft, reconcile and retry with its draftRevision.',
  },
  DOCUMENT_CATEGORY_BLOCKED: {
    meaning: 'The jurisdiction policy does not allow electronic signing of this document type.',
    action: 'Choose another category or jurisdiction, or sign outside Envelope.',
  },
  RECIPIENT_HAS_NO_FIELDS: {
    meaning: 'A signer has no fields to complete.',
    action: 'Place a required field for them.',
  },
  NOT_READY_TO_SEND: {
    meaning: 'The draft is not ready; `errors` lists every problem.',
    action: 'Fix each item and send again.',
  },
  REMINDER_TOO_SOON: {
    meaning: 'Everyone due a reminder already had one in the last 24 hours (HTTP 429).',
    action: 'Wait `Retry-After` seconds.',
  },
  ENVELOPE_ON_LEGAL_HOLD: {
    meaning: 'A legal hold blocks cancelling, extending or purging.',
    action: 'A signed-in admin must release the hold first.',
  },
  ENVELOPE_PURGED: {
    meaning: 'Retention removed this envelope’s files (HTTP 410).',
    action: 'Keep the files you need before the retention period ends.',
  },
  WEBHOOK_URL_NOT_ALLOWED: {
    meaning: 'The endpoint URL is not https or not a public address.',
    action: 'Use a public HTTPS URL, with no redirects.',
  },
  WEBHOOK_ENDPOINT_LIMIT_REACHED: {
    meaning: 'The workspace already has the maximum number of active endpoints.',
    action: 'Deactivate one first.',
  },
  WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED: {
    meaning: 'Too many saved endpoints, active or not.',
    action: 'Delete an inactive one first.',
  },
  WEBHOOK_ENDPOINT_ACTIVE: {
    meaning: 'An active endpoint cannot be deleted permanently.',
    action: 'Deactivate it first.',
  },
  WEBHOOK_DELIVERY_NOT_REDRIVABLE: {
    meaning: 'Only a failed delivery inside the 7-day window can be redriven.',
    action: 'Wait for retries to finish, or fix the receiver and send a test event.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    meaning: 'This operation needs an Idempotency-Key header.',
    action: 'Send a fresh UUID.',
  },
  IDEMPOTENCY_KEY_MISMATCH: {
    meaning: 'That key was already used with a different request body (HTTP 422).',
    action: 'Use a new key for a new request.',
  },
};

/**
 * Codes that belong to the web app or to a recipient's signing link, never to an API key or an
 * embedded session. Listing them here is what forces a decision about every new code
 * (integration-contract.test.ts).
 */
export const NON_INTEGRATION_ERROR_CODES: readonly ErrorCode[] = [
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'EMAIL_ALREADY_REGISTERED',
  'FORBIDDEN_ROLE',
  'LAST_OWNER',
  'INVITE_TOKEN_INVALID',
  'INVITE_TOKEN_EXPIRED',
  'PASSWORD_RESET_TOKEN_INVALID',
  'PASSWORD_RESET_TOKEN_EXPIRED',
  'CURRENT_PASSWORD_INCORRECT',
  'TWO_FACTOR_CODE_INVALID',
  'TWO_FACTOR_CHALLENGE_INVALID',
  'TWO_FACTOR_REQUIRED',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_NOT_ENABLED',
  'REQUIRED_FIELDS_INCOMPLETE',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_ALREADY_USED',
  'CONSENT_REQUIRED',
  'CONSENT_TEXT_CHANGED',
  'INVALID_SIGNATURE_IMAGE',
  'DOWNLOAD_LINK_EXPIRED',
  'DOWNLOAD_RENEW_TOO_SOON',
];

export interface ErrorGuideRow extends ErrorGuideEntry {
  code: ErrorCode;
  status: number;
  title: string;
}

/** The guide as rows, ordered by status then code, for tables. */
export function errorGuideRows(): ErrorGuideRow[] {
  return (Object.keys(INTEGRATION_ERROR_GUIDE) as ErrorCode[])
    .map((code) => ({
      code,
      status: ERROR_CATALOG[code].status,
      title: ERROR_CATALOG[code].title,
      ...(INTEGRATION_ERROR_GUIDE[code] as ErrorGuideEntry),
    }))
    .sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
}

/** The events a receiver can be sent, in documented order. */
export const DOCUMENTED_WEBHOOK_EVENTS: readonly FiredWebhookEventType[] =
  FIRED_WEBHOOK_EVENT_TYPES;
