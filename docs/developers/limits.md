# Limits

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How big can things be, and how fast can I call? |

## In Plain Terms

Envelope caps how large a document is, how many people and boxes it can have and how quickly you can
call the API. If you hit a speed limit you are told how long to wait.

## Technical Detail

### Size and count

<!-- generated:limits-table -->
| Limit | Value | Notes |
|---|---|---|
| PDF upload | 25 MiB, 500 pages | Encrypted and malformed PDFs are rejected. |
| Recipients per envelope | 50 | Each email address once. |
| Fields per envelope | 1000 | The whole layout is replaced on every save. |
| Invitation message | 2000 characters | Also applies to the message sent with an envelope. |
| Cancel reason | 1000 characters | Emailed to recipients; not stored in the audit trail. |
| Signing deadline | 14 days by default, up to 90 | Set with expiresInDays when sending. |
| Reminder cooldown | 24 hours per person | A reminder sooner than that is skipped. |
| Bulk batch rows | 500 per batch | One envelope per row. Split a larger list into several batches. |
| Template name | 120 characters | Different from every other active template in the workspace. |
| externalId | 200 characters | Letters, digits and _ . : @ - only. Not unique. |
| metadata | 10 string values, 2 KB in total | Echoed in every webhook; fixed once the envelope is sent. |
| Webhook endpoints | 5 active, 20 saved | Inactive endpoints do not use an active slot; delete one to make room. |
| Webhook secret overlap | 24 hours by default | How long the previous secret keeps verifying after a rotation. |
| Webhook API version | v1 | Additions are backward compatible; a breaking change would ship as v2. |
<!-- /generated:limits-table -->

### Rate limits

Limits are counted per minute and shared across all Envelope servers.

<!-- generated:rate-limits-table -->
| Bucket | Limit | Counted per | Covers |
|---|---|---|---|
| `createAndSend` | 100 per 60 seconds | workspace | Creating an envelope and sending one, counted together. |
| `lifecycle` | 30 per 60 seconds | workspace | Cancelling and reminding, and saving or changing templates, counted together. |
| `certificate` | 30 per 60 seconds | workspace | Downloading certificate pages, which are cut from the sealed PDF on request. |
| `bulkBatch` | 10 per 3600 seconds | workspace | Starting bulk batches. Each batch may hold up to 500 rows. |
| `embedManage` | 30 per 60 seconds | workspace and API key | Issuing and revoking embedded editor sessions, each counted separately. |
<!-- /generated:rate-limits-table -->

A request can be counted by several limits at once (your address, your key, the workspace). Every
response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds)
describing the tightest one; browsers can read them from cross-origin responses. A refusal is
`429 RATE_LIMITED` with `Retry-After`. General requests are also limited per address; keep client
concurrency modest and back off with jitter.
