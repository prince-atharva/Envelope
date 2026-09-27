import type { WebhookEventType } from '@envelope/shared';

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
export interface EndpointReference {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  description: string;
  inputs: string[];
  body?: object;
  query?: string;
  revision?: boolean;
  response: object | string;
  responseNote: string;
  errors: string;
}

export const ENDPOINTS: readonly EndpointReference[] = [
  {
    id: 'upload',
    method: 'POST',
    path: '/envelopes',
    title: 'Upload a PDF',
    description:
      'Create a draft from one PDF. Save the returned id and draftRevision for the next steps.',
    inputs: [
      'Multipart file (required): PDF, up to 25 MiB and 500 pages; encrypted PDFs are rejected.',
      'title (optional): 1–200 characters; defaults to the filename without its extension.',
      'documentCategory (optional): defaults to OTHER. jurisdictionCode (optional): overrides the workspace default. Policy is fixed at creation.',
    ],
    response: detailExcerpt,
    responseNote:
      '201 · Envelope detail (excerpt). This uploads and creates together; there is no separate upload endpoint.',
    errors:
      'FILE_REQUIRED, FILE_TOO_LARGE, UNSUPPORTED_FILE_TYPE, DOCUMENT_CATEGORY_BLOCKED. Uploads are scanned and validated before use.',
  },
  {
    id: 'list',
    method: 'GET',
    path: '/envelopes',
    title: 'List documents',
    description: 'Browse documents across the workspace, including documents created by people.',
    inputs: [
      'view: all (default), attention, waiting, completed, cancelled or drafts.',
      'status: optional envelope status. limit: 1–100 (default 20). cursor: nextCursor from the previous response.',
      'Pass the returned cursor unchanged and URL-encode it. Continue until nextCursor is null.',
    ],
    query: '?view=drafts&limit=20',
    response: { items: [], nextCursor: null },
    responseNote: '200 · Paginated envelope summaries. An empty workspace returns this example.',
    errors: 'VALIDATION_FAILED for invalid query parameters.',
  },
  {
    id: 'counts',
    method: 'GET',
    path: '/envelopes/counts',
    title: 'Count documents',
    description: 'Get a count for each dashboard view.',
    inputs: ['No request body or query parameters.'],
    response: { all: 0, attention: 0, waiting: 0, completed: 0, cancelled: 0, drafts: 0 },
    responseNote: '200 · Counts by view; views may overlap.',
    errors: 'Authentication and access errors apply to every endpoint.',
  },
  {
    id: 'detail',
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
    errors: 'NOT_FOUND if the document is unavailable in this workspace.',
  },
  {
    id: 'events',
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
    errors: 'NOT_FOUND; invalid query parameters return validation errors.',
  },
  {
    id: 'file',
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
    errors: 'NOT_FOUND or ENVELOPE_PURGED when the requested file is unavailable.',
  },
  {
    id: 'update',
    method: 'PATCH',
    path: '/envelopes/:id',
    title: 'Update a draft',
    revision: true,
    description:
      'Change draft settings before sending. Save draftRevision from each successful edit.',
    inputs: [
      'At least one of: title (1–200 characters), message (up to 2,000 characters; null clears it), sequentialSigning (boolean).',
      'With sequentialSigning true, equal routingOrder values sign together; lower groups go first.',
    ],
    body: { title: 'Consulting agreement', sequentialSigning: true },
    response: { draftRevision: 1 },
    responseNote: '200 · New draft revision.',
    errors: 'ENVELOPE_NOT_DRAFT; DRAFT_REVISION_MISMATCH (412) if another edit changed the draft.',
  },
  {
    id: 'recipient-add',
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
    errors: 'RECIPIENT_EMAIL_TAKEN, ENVELOPE_NOT_DRAFT; stale revisions return 412.',
  },
  {
    id: 'recipient-update',
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
    errors: 'NOT_FOUND, RECIPIENT_EMAIL_TAKEN, ENVELOPE_NOT_DRAFT; stale revisions return 412.',
  },
  {
    id: 'recipient-delete',
    method: 'DELETE',
    path: '/envelopes/:id/recipients/:recipientId',
    title: 'Remove a recipient',
    revision: true,
    description: 'Remove a draft recipient and all of their fields.',
    inputs: ['id and recipientId: returned UUIDs. No request body.'],
    response: { draftRevision: 2 },
    responseNote: '200 · New revision; the response is JSON, not an empty 204.',
    errors: 'NOT_FOUND, ENVELOPE_NOT_DRAFT; stale revisions return 412.',
  },
  {
    id: 'fields',
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
    errors:
      'INVALID_COORDINATE_SPACE, RATIO_OUT_OF_RANGE, FIELD_EXCEEDS_PAGE, PAGE_OUT_OF_RANGE; stale revisions return 412.',
  },
  {
    id: 'send',
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
    errors:
      'NOT_READY_TO_SEND includes readiness issues; ENVELOPE_NOT_DRAFT; conflicting idempotency reuse is rejected.',
  },
];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function apiBaseUrl(origin: string): string {
  return `${new URL(origin).origin}/api/v1`;
}
export function requestExample(endpoint: EndpointReference, base: string): string {
  const path = endpoint.path
    .replace(':id', EXAMPLE_ENVELOPE_ID)
    .replace(':recipientId', EXAMPLE_RECIPIENT_ID);
  const lines = [
    `curl --request ${endpoint.method} ${shellQuote(`${base}${path}${endpoint.query ?? ''}`)}`,
    '  --header "Authorization: Bearer $ENVELOPE_API_KEY"',
  ];
  if (endpoint.revision) lines.push('  --header "If-Match: \\"$DRAFT_REVISION\\""');
  if (endpoint.id === 'upload')
    lines.push(
      "  --form 'file=@agreement.pdf'",
      "  --form 'title=Consulting agreement'",
      "  --form 'documentCategory=OTHER'",
    );
  if (endpoint.id === 'send') lines.push('  --header "Idempotency-Key: $SEND_IDEMPOTENCY_KEY"');
  if (endpoint.body)
    lines.push(
      "  --header 'Content-Type: application/json'",
      `  --data ${shellQuote(JSON.stringify(endpoint.body, null, 2))}`,
    );
  if (endpoint.id === 'file') lines.push("  --output 'document.pdf'");
  return lines.join(' \\\n');
}

const person = { envelopeId: EXAMPLE_ENVELOPE_ID, recipientId: EXAMPLE_RECIPIENT_ID };
export const WEBHOOK_EXAMPLES: Partial<
  Record<WebhookEventType, { description: string; data: object }>
> = {
  'envelope.sent': {
    description:
      'The envelope was sent and invitations were queued; this does not confirm inbox delivery.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeStatus: 'SENT',
      sentAt: time,
      expiresAt: '2026-10-11T10:00:00.000Z',
      recipientCount: 1,
      invitedCount: 1,
    },
  },
  'envelope.viewed': {
    description: 'A recipient opened their link for the first time.',
    data: { ...person, viewedAt: time },
  },
  'recipient.consented': {
    description: 'A recipient accepted electronic signing consent.',
    data: { ...person, recipientEmail: 'alex@example.com', consentGivenAt: time },
  },
  'recipient.signed': {
    description: 'A recipient finished; the sealing worker may still be running.',
    data: {
      ...person,
      recipientEmail: 'alex@example.com',
      signedAt: time,
      envelopeStatus: 'PARTIALLY_SIGNED',
    },
  },
  'recipient.declined': {
    description: 'A recipient declined and the envelope closed.',
    data: {
      ...person,
      recipientEmail: 'alex@example.com',
      declinedAt: time,
      envelopeStatus: 'DECLINED',
    },
  },
  'envelope.completed': {
    description: 'The final PDF is sealed. Use finalVersionNumber to download it.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
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
      envelopeStatus: 'VOIDED',
      voidedAt: time,
      fromStatus: 'SENT',
    },
  },
  'envelope.expired': {
    description: 'The deadline passed with unfinished recipients. Signing is paused.',
    data: {
      envelopeId: EXAMPLE_ENVELOPE_ID,
      envelopeStatus: 'EXPIRED',
      expiredAt: time,
      unsigned: 1,
    },
  },
};
export function webhookExample(type: WebhookEventType): string {
  return JSON.stringify(
    {
      id: 'evt_55555555-5555-4555-8555-555555555555',
      type,
      createdAt: time,
      data: WEBHOOK_EXAMPLES[type]?.data,
    },
    null,
    2,
  );
}
