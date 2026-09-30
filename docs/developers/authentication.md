# Authentication

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I authenticate, and what can a key do? |

## In Plain Terms

Your server proves who it is with a secret API key that a workspace Admin or Owner creates in
Settings. Envelope stores only a fingerprint of the key, so it can never be shown again: copy it once
into your secret manager. A key can be set to read-only.

## Technical Detail

Send the key as a bearer token on every request:

```
Authorization: Bearer eak_…
```

| | Full-access key | Read-only key |
|---|---|---|
| Create, edit, send, cancel and remind | Yes | No: `403 API_KEY_READ_ONLY` |
| List, read and download | Yes | Yes |
| Issue embedded editor sessions | Yes | No |

### Closed by default

A key can call **only** the operations in the [API reference](reference.md). Any other route,
including everything that manages keys, webhooks, users, compliance settings and deadline extensions,
answers `403 API_KEY_NOT_ALLOWED` even for a full-access key: those need a signed-in person. Signing
routes use the emailed personal links, never a key.

### Managing keys

- Keys and webhook endpoints are managed in **Settings → Integrations** by an Admin or Owner.
- Revoking a key stops it immediately. Rotate by creating a new key, deploying it, then revoking the
  old one.
- A key used with a wrong or revoked value answers `401 API_KEY_INVALID`.
- API keys and webhook signing secrets are different credentials with different jobs; never use one
  in place of the other.
- Embedded editor origins are registered on the specific key that will issue sessions; see
  [Embedded editor](embedded-editor.md).

### Request and response headers

<!-- generated:request-headers -->
| Header | Meaning |
|---|---|
| `Authorization` | Bearer <API key>. Required on every API request; keep the key on your server. |
| `If-Match` | The latest draftRevision, quoted, on every draft edit. A stale value answers 412 DRAFT_REVISION_MISMATCH. |
| `Idempotency-Key` | 8–128 letters, digits, dots, dashes or colons. Required on send; optional on upload and on issuing an editor session. The same key and body within 24 hours replays the first result. |
| `If-None-Match` | An ETag from an earlier response. An unchanged document or file answers 304 with no body. |
<!-- /generated:request-headers -->

<!-- generated:response-headers -->
| Header | Meaning |
|---|---|
| `ETag` | A validator for the document detail and for PDF downloads. |
| `Idempotency-Replayed` | true when the response is a replay of an earlier request with the same key. |
| `Retry-After` | Seconds to wait before retrying a 429 response. |
| `X-RateLimit-Limit` | The tightest limit that applies to the request, requests per window. |
| `X-RateLimit-Remaining` | Requests left in the current window for that limit. |
| `X-RateLimit-Reset` | Seconds until that window resets. |
| `X-Request-Id` | Identifies the request in Envelope’s logs. Quote it when asking for help. |
<!-- /generated:response-headers -->
