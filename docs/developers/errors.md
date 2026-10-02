# Errors

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | What does each error mean and what should my code do? |

## In Plain Terms

When a request fails, Envelope answers with a standard error document. Your code should look at the
HTTP status and the `code` field, never at the human-readable text, which can change. Quote the
`requestId` when you ask for help and never include your API key.

## Technical Detail

Errors use `application/problem+json` (RFC 7807):

```json
{
  "type": "about:blank",
  "title": "The draft changed since you loaded it",
  "status": 412,
  "code": "DRAFT_REVISION_MISMATCH",
  "detail": "…",
  "requestId": "…",
  "errors": [{ "path": "fields.0.ratioX", "message": "…" }]
}
```

`errors` appears on `VALIDATION_FAILED` and `NOT_READY_TO_SEND` and lists each problem by path. A
few codes add a `reason`, for example `ENVELOPE_TERMINAL` (`VOIDED` or `DECLINED`).

### What to do by status

| Status | Meaning | Your code |
|---|---|---|
| 400, 422 | The request is wrong | Fix it; do not retry unchanged |
| 401, 403 | Credential missing, revoked or not allowed | Check the key and its access; do not retry unchanged |
| 404, 409, 410, 412 | The document is not in the state you assumed | Read the envelope and reconcile |
| 429 | Too many requests | Wait `Retry-After` seconds, reduce concurrency, back off with jitter |
| 5xx | A problem on Envelope's side | Retry with the same `Idempotency-Key` and body |

### Error codes

<!-- generated:errors-table -->
| HTTP | Code | Meaning | What to do |
|---|---|---|---|
| 400 | `BAD_REQUEST` | The request could not be understood. | Fix the request and send it again. |
| 400 | `FIELD_EXCEEDS_PAGE` | A field runs off its page. | Reduce its size or move it. |
| 400 | `FILE_REQUIRED` | The upload had no file. | Send the PDF as multipart field `file`. |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | This operation needs an Idempotency-Key header. | Send a fresh UUID. |
| 400 | `INVALID_COORDINATE_SPACE` | A field used pixels or points instead of page-relative ratios. | Send ratioX, ratioY, ratioWidth and ratioHeight between 0 and 1. |
| 400 | `PAGE_OUT_OF_RANGE` | A field names a page the document does not have. | Fix the request and send it again. |
| 400 | `RATIO_OUT_OF_RANGE` | A field ratio is outside 0–1. | Fix the request and send it again. |
| 400 | `VALIDATION_FAILED` | A field is missing or invalid; `errors` lists each one by path. | Fix the request and send it again. |
| 401 | `API_KEY_INVALID` | The bearer token is not a known, active API key. | Check the full key is set and has not been revoked. |
| 401 | `EMBED_SESSION_EXPIRED` | The launch credential or session has expired. | Issue a new session and reopen the saved draft. |
| 401 | `EMBED_SESSION_INVALID` | The embedded session token is unknown or revoked. | Issue a new session. |
| 401 | `UNAUTHENTICATED` | No credential was sent, or it is not one Envelope recognises. | Send `Authorization: Bearer <API key>`. |
| 403 | `API_KEY_NOT_ALLOWED` | This endpoint needs a signed-in person; an API key cannot call it. | Use only the operations in the API reference. |
| 403 | `API_KEY_READ_ONLY` | A read-only key was used on an operation that writes. | Use a full-access key. |
| 403 | `EMBED_ORIGIN_NOT_ALLOWED` | parentOrigin is not registered on the API key that issued the session. | Register the exact origin on that key, then issue a new session. |
| 403 | `EMBED_SCOPE_DENIED` | The session was not granted this action, or another envelope was requested. | Issue a session with the needed actions. |
| 403 | `FORBIDDEN` | The credential is valid but not allowed to do this. | Check the key’s access. |
| 404 | `BULK_BATCH_NOT_FOUND` | The batch id does not exist in your workspace. | Use the `batchId` returned when the batch was accepted. |
| 404 | `NOT_FOUND` | The id does not exist in your workspace, or has been removed. | Check the id and that the key belongs to the workspace that owns the document. |
| 404 | `TEMPLATE_NOT_FOUND` | The template id does not exist in your workspace. | List templates and use an id from the result. |
| 409 | `CONFLICT` | The request is valid but not possible in the document’s current state. | Read the document and act on its status. |
| 409 | `EMBED_LAUNCH_USED` | The launch credential was already redeemed. | Issue a new session; a launch token works once. |
| 409 | `EMBED_UPLOAD_BOUND` | This upload session already created its draft. | Reopen the mapped envelope instead of uploading again. |
| 409 | `ENVELOPE_EXPIRED` | The signing deadline has passed and signing is paused. | A signed-in person can extend the deadline in the web app. |
| 409 | `ENVELOPE_NOT_DRAFT` | Only a draft can be edited or sent. | Read the document; it may already be sent. |
| 409 | `ENVELOPE_ON_LEGAL_HOLD` | A legal hold blocks cancelling, extending or purging. | A signed-in admin must release the hold first. |
| 409 | `ENVELOPE_TERMINAL` | The envelope is completed, declined or cancelled and cannot change. | Start a new envelope if needed. |
| 409 | `RECIPIENT_EMAIL_TAKEN` | That email address is already a recipient. | Update the existing recipient. |
| 409 | `TEMPLATE_ARCHIVED` | The template was archived, so it cannot start new envelopes or batches. | Use an active template, or ask an Admin to restore this one. |
| 409 | `TEMPLATE_NAME_TAKEN` | An active template in your workspace already has this name. | Choose another name, or archive the old template first. |
| 409 | `WEBHOOK_DELIVERY_NOT_REDRIVABLE` | Only a failed delivery inside the 7-day window can be redriven. | Wait for retries to finish, or fix the receiver and send a test event. |
| 409 | `WEBHOOK_ENDPOINT_ACTIVE` | An active endpoint cannot be deleted permanently. | Deactivate it first. |
| 409 | `WEBHOOK_ENDPOINT_LIMIT_REACHED` | The workspace already has the maximum number of active endpoints. | Deactivate one first. |
| 409 | `WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED` | Too many saved endpoints, active or not. | Delete an inactive one first. |
| 410 | `ENVELOPE_PURGED` | Retention removed this envelope’s files (HTTP 410). | Keep the files you need before the retention period ends. |
| 412 | `DRAFT_REVISION_MISMATCH` | The draft changed since you read it (HTTP 412). | Read the latest draft, reconcile and retry with its draftRevision. |
| 413 | `FILE_TOO_LARGE` | The PDF is over the size limit. | Send a smaller file. |
| 413 | `PAYLOAD_TOO_LARGE` | The request body is over the size limit. | Fix the request and send it again. |
| 415 | `UNSUPPORTED_FILE_TYPE` | Only PDF files are accepted. | Send a PDF. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | The content type is not accepted here. | Use multipart for uploads and JSON elsewhere. |
| 422 | `BULK_TOO_LARGE` | A batch has more rows than the limit. | Split it into batches of at most 500 rows. |
| 422 | `DOCUMENT_CATEGORY_BLOCKED` | The jurisdiction policy does not allow electronic signing of this document type. | Choose another category or jurisdiction, or sign outside Envelope. |
| 422 | `ENCRYPTED_PDF` | Password-protected PDFs are not supported. | Remove the password. |
| 422 | `IDEMPOTENCY_KEY_MISMATCH` | That key was already used with a different request body (HTTP 422). | Use a new key for a new request. |
| 422 | `INVALID_PDF` | The file is not a valid PDF. | Re-export the PDF. |
| 422 | `MALWARE_DETECTED` | The file failed the security scan. | Do not retry the same file. |
| 422 | `NOT_READY_TO_SEND` | The draft is not ready; `errors` lists every problem. | Fix each item and send again. |
| 422 | `PAGE_LIMIT_EXCEEDED` | The PDF has too many pages. | Split the document. |
| 422 | `RECIPIENT_HAS_NO_FIELDS` | A signer has no fields to complete. | Place a required field for them. |
| 422 | `TEMPLATE_ROLE_MISMATCH` | The people sent do not match the template’s roles: a role is missing, repeated or unknown, or an email is repeated. | Send exactly one person for each role of the template, each with a different email. |
| 422 | `WEBHOOK_URL_NOT_ALLOWED` | The endpoint URL is not https or not a public address. | Use a public HTTPS URL, with no redirects. |
| 429 | `RATE_LIMITED` | Too many requests. | Wait `Retry-After` seconds, reduce concurrency and back off with jitter. |
| 429 | `REMINDER_TOO_SOON` | Everyone due a reminder already had one in the last 24 hours (HTTP 429). | Wait `Retry-After` seconds. |
| 500 | `INTERNAL_ERROR` | Something failed on Envelope’s side. | Retry with the same Idempotency-Key; quote `requestId` if it persists. |
| 503 | `SERVICE_UNAVAILABLE` | A dependency is temporarily unavailable. | Retry after a short delay. |
<!-- /generated:errors-table -->

<!-- generated:errors-note -->
The catalog holds 81 error codes in total; the table above lists the ones a partner integration can meet.
<!-- /generated:errors-note -->
Codes for signing links, sign-in and invitations belong to the web app and to recipients, not to an
API key, and are not listed.
