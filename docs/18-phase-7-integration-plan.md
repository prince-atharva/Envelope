# Phase 7: Integrations Plan

| | |
|---|---|
| **Status** | Existing integration work built; embedded editor/SDK extension approved; implementation in progress. Foundation shipped as `v0.7.0` |
| **Version** | 1.1.0 |
| **Last updated** | 27 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 7 deliver across the integration API, management UI and user guide, and how is it built and checked? |

---

# PART 1: In Plain Terms

## What Phase 7 Is

Phase 6 delivered compliance and is complete. Phase 7 delivers the integration capability in
reviewable workstreams recorded together in this plan. The commit history contains earlier labels
such as Phase 6b; those labels remain in Git history, while this document is the maintained Phase 7
record. The released foundation and subsequent management UI work are included alongside the
completed in-page guide. The embedded sender editor below is proposed, not yet available:

```
   BUILT ──────────────► API keys (server-to-server auth) and webhooks (event notifications), so
                          HealthProHub — the first integration partner — can create and send
                          envelopes programmatically, and learn about status changes without
                          polling.
   BUILT ──────────────► Admins and Owners manage API keys and webhook receivers in Settings,
                          including delivery history and retries.
   BUILT ──────────────► Follow the integration guide on the same page, with API examples,
                          webhook verification and troubleshooting.
   PROPOSED ──────────► Embedded sender editor and thin JavaScript SDK for HealthProHub:
                          open an uploaded draft, or upload inside the embedded editor.
   OUT OF SCOPE ───────► Embedded recipient signing, delegation, in-person signing, and
                          self-serve multi-partner onboarding.
   SIGNING UNCHANGED ──► A signer always finishes on Envelope's own hosted web app, reached by the
                          emailed link. This is intentional: every signer sees Envelope's own
                          branding and becomes a visit to Envelope's own site. The API and webhooks
                          cover envelope creation, sending and status only, never the sign step.
```

## What You Can Do at the End of Phase 7

1. **Create an API key** from Settings, once your workspace has at least one. The raw key is shown
   once, at creation; only its hash is ever stored. A key can be marked read-only.
2. **Use the key to create and send envelopes** through the same HTTP API the web app uses:
   `POST /v1/envelopes`, the draft fields and recipients routes, and `POST /v1/envelopes/:id/send`.
   Every envelope a key creates belongs to the workspace as a whole, not to any one person, and
   shows up in the dashboard like any other.
3. **Register a webhook endpoint** and get a signing secret, shown once. Envelope calls it with an
   HMAC-signed `POST` every time something happens: sent, viewed, consented, signed, declined,
   completed, voided, or expired.
4. **See recent delivery attempts** for an endpoint, and **redrive** one that failed, within 7 days.
5. **A key or endpoint you no longer need can be revoked or deactivated**, immediately.
6. **Follow the integration guide** for a complete API-key workflow, searchable endpoint reference,
   webhook receiver example and troubleshooting steps.
7. **Proposed: prepare documents inside HealthProHub** using the existing Envelope upload, PDF
   preview, recipient, field-placement and review/send UI, without building another editor.
8. **Proposed: follow a HealthProHub embedded-editor guide** in Settings → Integrations, covering
   both entry modes, secure backend setup, SDK usage, reopening drafts and webhook updates.

## The Phase 7 Finish Line

- [x] An API key authenticates envelope create, draft edit and send routes; a read-only key is
      refused on any of them that writes.
- [x] Every route not explicitly allow-listed refuses an API key, even though a key's scope is
      nominally "whole tenant" — closed by default.
- [x] A webhook fires for 8 of the 9 documented events, signed exactly as docs/08 specifies, with
      bounded retries and a 7-day redrive window.
- [x] `envelope.delivered` is reserved but never fired, with a written reason (below).
- [x] A webhook endpoint URL must be `https://` and resolve to a public address, checked at
      registration and again at delivery.
- [x] `docs/08` updated; ADR 0015 written.
- [x] Admin and Owner integration management, one-time key/secret screens, endpoint lifecycle,
      delivery history and redrive are implemented.
- [x] Responsive panels and dialog polish preserve keyboard use and role restrictions.
- [x] The in-page guide accurately documents all allowed API operations and webhook handling.
- [x] Verification of the existing integration work is recorded below; it does not cover the proposed extension.
- [ ] Both embedded entry modes support upload/prepare/review/send with the existing UI.
- [ ] Sessions cannot access another envelope, tenant, dashboard, Settings or signing routes.
- [ ] A draft can be saved, closed and reopened with a new authorized session.
- [ ] One upload session creates at most one draft, including concurrent/retried uploads.
- [ ] SDK and direct-iframe examples work without third-party cookies or exposed API keys.
- [ ] Settings → Integrations includes the tested HealthProHub embedded-editor guide.
- [ ] Extension verification passes, including cross-origin browser and credential-leakage tests.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| HealthProHub's actual integration requirements (which routes they call, what their receiver expects) | This phase built a generic mechanism against the documented spec; it has not yet been validated against a real partner integration | Before HealthProHub goes live |
| Approval of the proposed embedded-editor workstream and ADR 0016 | Scope includes both entry modes, one-envelope access and hosted recipient signing | Before implementation |
| HealthProHub deployment origins and backend framework | Configure trusted origins and adapt the backend example; placeholders suffice for this plan and isolated tests | Before partner deployment |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Existing API/webhook integration plus proposed embedded sender editor, thin SDK and HealthProHub guide. Embedded recipient signing, delegation, in-person signing and self-serve multi-partner onboarding remain outside this phase |
| Who is the first partner | HealthProHub, but the mechanism underneath is generic — not hardcoded to one tenant |
| Where an API key's writes land | A per-tenant hidden `isServiceAccount` User, `role: ADMIN` (ADR 0015) — not tied to any one human |
| Webhook secret storage | Encrypted (AES-256-GCM), not hashed — delivery must recover the raw secret to sign each request (ADR 0015) |
| `envelope.delivered` | Reserved in the event-type union, never fired — see "The `envelope.delivered` Gap" below |
| Route allow-listing | Closed by default via `@ApiKeyAllowed()`; only envelope create/upload, draft edits, send, and reads are open to a key this phase |
| Integration UI roles | Admin and Owner can manage integrations; Users remains Owner-only; Members cannot access Settings integration controls |
| One-time credential display | Raw keys and webhook secrets live only in dialog-local state; mutation caches receive safe metadata only; closing clears the value and discards late responses; never put secrets in URLs, storage, telemetry or logs |
| Endpoint event selection | “All available events” uses an empty `subscribedEvents` list; custom selection uses emitted event types; `envelope.delivered` is reserved and not selectable |
| Delivery history | Load on demand; show operational metadata; reveal payload only through explicit disclosure; offer retry only for failed/exhausted rows and let the API enforce the seven-day window |
| Integration page design | Reuse existing Card, Button, DialogShell, HashBlock and Settings navigation patterns; keep sections stacked, long values wrapped, controls keyboard-accessible and touch targets at least 44px |

## ADRs Written in This Phase

- [ADR 0015](adr/0015-api-keys-and-webhook-secrets-use-different-storage.md) — API keys and webhook
  secrets use different storage

- [ADR 0016](adr/0016-scope-embedded-editor-sessions-to-one-envelope.md) — proposed embedded sender authentication and iframe boundary

## Phase 7 Workstreams and Commit Record

This is the single maintained plan for Phase 7. The earlier separate slice plans have been merged
here and removed. The foundation commits and `v0.7.0` release remain unchanged; subsequent implementation
commits below group the work by Phase 7 workstream after the authorized soft reset.

| # | Workstream | Status | Commit evidence |
|---|---|---|---|
| 1 | API-key and webhook foundation | ✅ Released in `v0.7.0` | `bb12153` contracts/schema; `2c0b709` API keys; `39e1132` endpoint security; `515cc6a` delivery pipeline; `d00df8d` lifecycle events; `4353f01` purge and docs; release `609b5e2` |
| 2 | Settings integration management | ✅ Built | `42fec3b` |
| 3 | Responsive visual polish | ✅ Built | `bc4b198` |
| 4 | In-page integration guide and API/webhook reference | ✅ Built | `4f05424` |
| 5 | Existing integration verification and documentation | ✅ Verified | Historical verification record below |
| 6 | Embedded sender editor, SDK and HealthProHub guide | Approved; implementation in progress | Steps 6.1–6.6 below; no implementation commits |
| 7 | Release | Planned, separate authorization required | No product version bump or tag until an authorized Phase 7 release |

### Workstream 2: Settings Integration Management

Admins and Owners manage API keys and webhook endpoints from Settings. The UI creates and revokes
keys, shows a new key once, creates and edits endpoints, shows a signing secret once, and supports
delivery inspection and redrive. Existing role restrictions, API contracts, one-time credential
handling and server-side validation remain authoritative. The replacement commit is recorded in the table above.

### Workstream 2 Acceptance and Implementation

- [x] Admins and Owners can open Settings → Integrations; Members are redirected away; Settings → Users remains Owner-only.
- [x] API-key creation supports full or read-only access, displays the raw value once with copy support, refreshes the list and keeps credentials out of URLs, logs, caches and browser storage. Revocation is confirmed and revoked metadata remains visible.
- [x] Webhook creation validates through the shared schema and server URL guard, displays its signing secret once, and supports all fired events or a selected subset. Endpoints can be edited, deactivated and reactivated; inactive endpoints retain delivery history.
- [x] Delivery history reports status, attempt count, HTTP status and last error. Event data stays behind a disclosure. Retry is offered only for failed or exhausted deliveries; API remains authoritative for eligibility.
- [x] Browser coverage exercises role access, creation, one-time values, mutations, empty states, event selection, delivery details and retry against the isolated real stack.

Implementation details: the web client uses typed methods and per-resource query keys for the existing
API-key/webhook routes. Presentation helpers centralize event/status labels and retry visibility.
Settings navigation is available to Admins and Owners, with Users restricted to Owners. One-time
values remain only in dialog-local state and clear when their dialog closes. Mutation responses
contain safe metadata only; responses arriving after close or unmount cannot restore a secret.

Deliberate limits: no secret rotation, hard deletion of revoked/inactive records, delivery pagination,
"send test webhook" action, or partner setup wizard. Delivery history uses the API's newest 50 rows.

### Workstream 3: Responsive Visual Polish

Integration settings use the application's shared panels and dialog patterns, preserve accessible
controls, and handle long names and endpoint URLs on desktop, tablet and phone. The changes are
limited to the integration page and its relevant browser/gallery coverage. The replacement commit is recorded in the table above.

### Workstream 3 Acceptance and Implementation

- [x] Key and endpoint sections use shared card surfaces with clear record hierarchy, explicit text statuses and consistent spacing.
- [x] Long labels, URLs and event selections wrap without page overflow at 375px, 768px and 1440px.
- [x] Keyboard focus is visible, touch targets are at least 44px, dialogs dismiss and restore focus, and destructive actions retain confirmation.
- [x] Gallery coverage includes populated panels, long values, forms, inactive states, one-time credentials (masked), and delivery history on desktop, tablet and phone.

The polish changes stay within the integration page and its gallery/browser coverage; no global
design tokens or unrelated pages were restyled. Existing UI components and reduced-motion behavior
remain in use.

### Workstream 4: In-Page Integration Guide

The guide lives in Settings → Integrations beside connection management. It includes a quick start,
searchable reference for all 12 API-key-enabled operations, copyable cURL examples with placeholders,
webhook setup and verification guidance, and troubleshooting. Documented examples must match the
implemented controllers, shared schemas, response mappers and actual webhook emitters. Session-only
routes and the reserved `envelope.delivered` event are called out clearly.

The webhook receiver example verifies the raw request body and timestamped HMAC before parsing JSON,
uses a secret from the environment, rejects malformed or stale signatures, and explains durable
deduplication. The guide must describe actual acknowledgement and retry behavior without claiming an
unverified attempt count or delivery guarantee. Credentials must not enter examples, persistent
browser storage, URLs, analytics or logs.

**Guide acceptance checks:**

- [x] The workflow carries returned IDs and revisions through upload, draft preparation, recipients,
      fields and send; it distinguishes original and completed PDFs and explains hosted email-link
      signing and asynchronous completion.
- [x] All 12 allow-listed operations show method, path, access, inputs, relevant headers, responses
      and useful errors, consistent with implementation.
- [x] Webhook material covers all eight emitted events, signature headers, raw-body verification,
      event-ID deduplication, 2xx acknowledgement, delivery inspection and seven-day redrive.
- [x] Search, navigation, disclosure and copying work with keyboard at 375, 768 and 1440 pixels.
- [x] Existing role, key, endpoint, one-time-secret and delivery lifecycle behavior remains covered.

**Guide tests:** focused tests validate examples against shared schemas and known signature cases;
component tests cover search, navigation, copy outcomes and disclosures; browser tests cover the
real isolated stack, role floor, guide discovery and keyboard/responsive behavior. Gallery captures
must mask credentials. Current implementation files include `IntegrationGuide.tsx`,
`integration-reference.ts`, `webhook-receiver-example.ts`, their focused tests, and the integration
page and browser/gallery specs.

## Foundation Implementation

### Step 1: Shared Contracts, Schema, Config

`packages/shared/src/api-keys.ts` and `webhooks.ts` — `createApiKeySchema`, `ApiKeySummary`,
`CreateApiKeyResponse`; `WEBHOOK_EVENT_TYPES` (the 9 documented types, `envelope.delivered`
included but never fired — see below), `createWebhookEndpointSchema` (shape only; the https and
public-address rules live entirely server-side, in `webhook-url-guard.ts`, so there is exactly one
place enforcing them), `WebhookEndpointSummary`, `WebhookDeliverySummary`, `WebhookEventPayload`.
`errors.ts` gained `API_KEY_INVALID`, `API_KEY_NOT_ALLOWED`, `API_KEY_READ_ONLY`,
`WEBHOOK_URL_NOT_ALLOWED`, `WEBHOOK_ENDPOINT_LIMIT_REACHED`, `WEBHOOK_DELIVERY_NOT_REDRIVABLE`.

One migration, `20260925133247_api_keys_and_webhooks`: `ApiKey`, `WebhookEndpoint`,
`WebhookDelivery`, and `User.isServiceAccount`. New env vars: `API_KEY_HASH_SECRET`,
`WEBHOOK_SECRET_ENC_KEY` (a 32-byte AES-256 key, distinct in kind from every HMAC secret elsewhere),
`WEBHOOK_ALLOW_INSECURE_LOCAL_URLS` (test-only, refused in production) and
`WEBHOOK_RETRY_SCHEDULE_MS` (overridable so the e2e suite runs retries in milliseconds, the same
reason `EMAIL_RETRY_BASE_DELAY_MS` exists).

### Step 2: API Keys

`apps/api/src/api-keys/api-key.service.ts` — raw key `eak_` + 32 random bytes, HMAC-hashed like a
refresh token (`auth/session.service.ts`), never stored raw. `serviceAccountUserId()` lazily
provisions the tenant's one hidden `User` (`isServiceAccount: true`, `role: ADMIN`, an unusable
random password like an unaccepted invitation), reused by every key the tenant creates; a concurrent
first-creation race is resolved by the `User.email` unique constraint, same pattern as
`UsersService.invite()`'s `isUniqueViolation()` handling.

`apps/api/src/auth/api-key.guard.ts` — verifies the key, populates `req.user` with the exact
`AuthenticatedUser` shape JWT auth uses (`role: 'ADMIN'`, plus `apiKeyId`), so `ownership.ts`
(which only special-cases `MEMBER`) needs no change: a key already reads and writes the whole
tenant. `apps/api/src/auth/jwt-auth.guard.ts` branches on the bearer token's `eak_` prefix and
delegates here, rather than competing as a second global guard. `@ApiKeyAllowed({ write })`
(`auth/api-key.decorator.ts`) opts a route in; unmarked routes refuse a key outright
(`API_KEY_NOT_ALLOWED`), even though "whole tenant" sounds broad — deliberately narrower than the
key's nominal scope. Allow-listed this phase: `EnvelopesController` (create, counts, list, detail,
events, file), `DraftsController` (all routes), `SendingController`'s `send` only (not `remind`).

### Step 3: Webhook Subscription Management

`apps/api/src/webhooks/webhook-secret-cipher.ts` — AES-256-GCM, IV + auth tag + ciphertext,
base64. `webhook-url-guard.ts` — `assertWebhookUrlShape()` (https, not localhost, not a literal
private/loopback/link-local/multicast/metadata address) and `assertWebhookUrlIsSafe()` (the same,
plus a DNS lookup checked against the same ranges — called again at delivery time, since DNS can
rebind between registration and send). Replaces the invariant `docs/10` used to state ("no
user-supplied URLs are fetched anywhere") with this control, recorded in ADR 0015.

`webhooks.service.ts` / `webhooks.controller.ts` — `POST/GET/PATCH /v1/webhooks`, capped at 5
endpoints per tenant. `DELETE /v1/webhooks/:id` **deactivates** rather than deletes
(`WebhookDelivery.webhookEndpointId` is a `RESTRICT` foreign key, so a hard delete would fail once
any delivery has been attempted) — the same idiom `ApiKeyService.revoke()` already uses.
`GET /v1/webhooks/:id/deliveries` lists recent attempts, including the event's `data` payload, for
debugging. `POST /v1/webhooks/:id/redrive` — **`:id` here is a delivery id, not an endpoint id**,
per docs/08's literal route; called out explicitly since every sibling route under `/webhooks/:id`
takes an endpoint id instead.

### Step 4: Delivery Pipeline

`WEBHOOK_DELIVERY_QUEUE` (`queue/queue.module.ts`), 6 attempts, a custom named backoff
(`webhook-delivery-schedule`) rather than BullMQ's built-in exponential, since the documented
schedule (10s, 1m, 5m, 30m, 2h, 12h; `queue/webhook-retry-schedule.ts`) isn't one. `WebhookQueueService`
(`webhook-queue.service.ts`, importable from both the API and the worker like `MailProducerModule`)
fans out one `WebhookDelivery` row and one deterministic-`jobId` job per active, subscribed
endpoint, sharing one `eventId` across the fan-out. `WebhookDeliveryProcessor`
(`webhook-delivery.processor.ts`, worker only) loads the delivery fresh from Postgres — the queue
job carries only its id, never the payload, the same reason `mail/mail.types.ts`'s jobs carry only
ids — re-checks the URL, decrypts the secret, signs with `HMAC_SHA256(secret,
"{timestamp}.{raw_body}")` (`webhook-signature.ts`), and `POST`s with a 5-second timeout and
`redirect: 'manual'` (a receiver is verified once; a redirect would fetch a second, unchecked URL).
On final exhaustion the delivery is marked `EXHAUSTED` and an alert is raised, mirroring
`mail/email.processor.ts`'s `onFailed` split between "will retry" and "failed permanently".
`WebhookQueueService.redrive()` resets a delivery to `PENDING` and re-enqueues under a fresh jobId
(the original `delivery-${id}` job may still exist in Redis, kept for `removeOnFail`'s window).

### Step 5: Wiring the 8 Real Hook Points

One `webhooks.enqueue(tenantId, type, data)` call after each transition's transaction commits,
never inside it (matching the existing precedent in `sending.service.ts`'s invitation enqueue):

| Event | Where |
|---|---|
| `envelope.sent` | `sending/sending.service.ts#send()` |
| `envelope.viewed` | `signing/signing.service.ts#markFirstView()` |
| `recipient.consented` | `signing/signing.service.ts#consent()` |
| `recipient.signed` | `signing/signing.service.ts#submit()` |
| `recipient.declined` | `signing/signing.service.ts#decline()` |
| `envelope.completed` | `sealing/sealing.service.ts#sealFinal()` (worker process) |
| `envelope.voided` | `lifecycle/cancel.service.ts#void()` |
| `envelope.expired` | `maintenance/expiry-sweep.service.ts#run()`/`expire()` (worker process) |

`token-guardian.service.ts`'s `RECIPIENT_FIELDS` projection gained `email`, previously omitted, so
handlers could put `recipientEmail` on a payload without a second query — docs/08's own
`recipient.signed` example names it explicitly.

### Step 6: The 7-Day Purge

`maintenance/webhook-delivery-purge.service.ts`, registered in `MaintenanceScheduler` /
`MaintenanceProcessor` exactly like every other scheduled job (`WEBHOOK_DELIVERY_PURGE_CRON`,
default `30 3 * * *`). Deletes every `WebhookDelivery` row past 7 days, regardless of status: unlike
`AuditTrail` (ADR 0004), a delivery row is operational, not evidence, so there is no reason to keep
a successful delivery's row any longer than a failed one's.

## In-Page Guide Implementation Detail

### Step 1: Accurate Integration Reference and Examples

Add typed reference content and example helpers under `apps/web/src/features/integrations/`.
Read the full controller methods, shared schemas and response mappers before composing examples.
Cover these operations (paths relative to `/api/v1`):

| Method | Path | Key access |
|---|---|---|
| POST | `/envelopes` | Full; multipart PDF upload and metadata |
| GET | `/envelopes/counts` | Read-only or full |
| GET | `/envelopes` | Read-only or full |
| GET | `/envelopes/:id` | Read-only or full |
| GET | `/envelopes/:id/events` | Read-only or full |
| GET | `/envelopes/:id/file` | Read-only or full; PDF response |
| PATCH | `/envelopes/:id` | Full |
| POST | `/envelopes/:id/recipients` | Full |
| PATCH | `/envelopes/:id/recipients/:recipientId` | Full |
| DELETE | `/envelopes/:id/recipients/:recipientId` | Full |
| PUT | `/envelopes/:id/fields` | Full |
| POST | `/envelopes/:id/send` | Full |

Explain actual revision/concurrency and idempotency headers where implemented, normalized field
coordinates, routing, upload limits, list/event pagination and document version selection. The
workflow MUST carry returned identifiers and revisions between steps and distinguish the original
PDF from the completed version. Include hosted email-link signing and asynchronous completion.
Do not copy older spec examples where an As built note changes the contract.

Explain session-only API-key/webhook management, reminders, cancellation and compliance actions,
and signer-token routes, without advertising them as API-key capabilities.

Use `FIRED_WEBHOOK_EVENT_TYPES`, existing labels and payloads from actual emission sites for all
event examples. Explain HTTPS/public-address receiver requirements, subscription selection, raw
JSON body, `X-Signature-Timestamp`, `X-Signature`, HMAC-SHA256, constant-time comparison, a five-minute
timestamp tolerance, deduplication on event id, prompt 2xx acknowledgement within five seconds,
failed delivery inspection and seven-day redrive. Distinguish acknowledgement from an API response
and from delivery metadata displayed in Settings. Do not imply stored receiver response bodies exist.

The receiver example MUST reject malformed signatures/timestamps, verify before parsing JSON,
use a secret from the server environment and explain durable event deduplication. Describe retry
behavior without promising an unverified attempt count or total duration: check queue configuration
and its tests first; raise any spec/code conflict before writing precise scheduling claims.

**Tests:** focused tests validate request examples against shared schemas, event coverage, placeholder
handling and safe base-URL substitution. Execute the published verification example against known
signatures, altered bodies, stale timestamps and malformed headers. Reuse existing API-key e2e
coverage to check route access; extend it only where a claimed contract is not already covered.

#### Step 2: Guide UI, Quick Start and Endpoint Discovery

Compose an `IntegrationGuide` from small components under the integration feature directory and
wire it into `apps/web/src/pages/SettingsIntegrationsPage.tsx`. Reuse
`apps/web/src/components/ui/Tabs.tsx`, `Card.tsx`, `Button.tsx` and existing labels. Keep connection
management the default view with a prominent guide entry point. Provide quick-start, reference,
webhook and troubleshooting navigation, endpoint search, method/access badges and copy feedback.
Long code lines scroll within their own region; essential explanatory text wraps on phones.

Troubleshooting covers actual errors from `packages/shared/src/errors.ts`, invalid/revoked keys,
read-only writes, session-only routes, stale drafts, validation, rate limits and webhook failures.
Do not present anticipated or unimplemented response headers as available.

**Tests:** component tests for search/no matches, section navigation, copy success/failure and
accessible disclosures. Existing integration lifecycle tests MUST continue to pass. No new
application state transitions or server logs are introduced.

#### Step 3: Browser Finish Line, Visual Review and Documentation

Extend `apps/web/e2e/integrations.spec.ts` to exercise discovery of the guide, quick-start sequence,
endpoint details, webhook examples, copying placeholders and keyboard navigation on the real isolated
stack. Confirm role restrictions and existing creation, revocation and retry flows still work.
Extend `apps/web/e2e/gallery/gallery.spec.ts` for the guide, expanded endpoint and webhook examples;
inspect desktop, tablet and phone captures, with credentials masked wherever management is shown.

Mark completed steps and finish-line items, record actual verification results and add the feature
to `CHANGELOG.md` under `[Unreleased]`. Release/version/tag work remains a separate authorized task.

**Tests:** full required checks below plus responsive assertions and visual inspection.

### Guide Deliberate Simplifications

- The completed guide workstream introduced no new permissions, SDK or endpoints. The proposed
  workstream 6 adds embedded sender preparation; recipient signing remains hosted.
- No live API console, credential persistence or requests to user webhook destinations from the guide.
- No new OpenAPI generation pipeline; this page documents the existing implemented contracts.
- No invented receiver response body or delivery-confirmation event.

### Workstream 4 Verification Requirements

Follow phase-build and convention-review procedures; snapshot each step before starting the next.
After all steps, run lint, typecheck, unit tests, API e2e using Node 22.19.0 and desktop Chrome browser
e2e. Run the UI gallery and inspect 375/768/1440px output. Use the repository PATH prefixes and
isolated services; no tests read `.env`, send real mail or use the development database/server.
Report the known shared jurisdiction typecheck issue if reproduced and check other packages
individually. Investigate any failure before calling it a flake. Verify rebuilt snapshots independently
and commit one per plan step after final checks. Planning validation is document and link review only.


## The `envelope.delivered` Gap

No mail-provider delivery-confirmation hook exists anywhere in the codebase, and the platform sends
mail over Gmail SMTP, which confirms only that a message was handed to a mail server at send time —
never that it reached an inbox. Firing `envelope.delivered` on SMTP-accept would assert something
the system does not actually know, the same standard already applied to `/verify`'s wording
(docs/08: "the system genuinely cannot distinguish... and claiming otherwise would be dishonest
exactly where honesty matters most"). This phase keeps `envelope.delivered` reserved in
`WEBHOOK_EVENT_TYPES` — so integration code can already switch on it without erroring later — but
never wires or fires it. `envelope.sent` and `envelope.viewed` are the practical signals a partner
should use instead. If a future phase replaces Gmail SMTP with a provider that has native delivery
webhooks (SES, Postmark), that provider's inbound webhook becomes a real hook point and
`envelope.delivered` starts firing, with no breaking change to the event contract.

## Deliberate Simplifications

- **No self-serve multi-partner onboarding UI.** The mechanism is generic (any tenant can create
  keys and endpoints), but nothing in this phase is partner-specific beyond HealthProHub being the
  first tenant to use it.
- **`remind` is not allow-listed for an API key**, only `send`. Reminders are a lower-value,
  lower-urgency integration surface; adding it later is a one-line change to
  `sending.controller.ts`.
- **Webhook endpoints are capped at 5 per tenant** and deliveries listing has no cursor pagination
  (a plain `limit`, default 50, max 100) — reasonable for a debugging view at this phase's scale,
  revisited if a tenant's volume outgrows it.
- **No secret-rotation endpoint** for a webhook endpoint (only full deactivate-and-recreate). A
  `POST /v1/webhooks/:id/rotate-secret` is a natural follow-up, not built here.

## A Pre-Existing Race This Phase's Tests Surfaced

Writing `webhook-events.e2e.test.ts` — several distinct envelope actions back to back, with no
artificial pacing between them — occasionally hit a genuine Postgres deadlock, unrelated to
webhooks themselves: `sending.service.ts#send()` returns once `ENVELOPE_SENT` is recorded, but the
mail worker sends the actual invitation, and records its own `EMAIL_SENT` audit event, *afterwards*
and *asynchronously*. Both that write and a second action on the same envelope (voiding it,
expiring it) go through `AuditService.record()`'s advisory-lock-then-insert path
(`audit/audit.service.ts`) for the same envelope row; two independent transactions racing there can
deadlock at the database level (Postgres error `40P01`), which `record()` surfaces as a 500. This
was always possible — it just needed two audit-writing transactions for one envelope close enough
together in time, which existing tests apparently never did. The fix here is in the test, not the
application: wait for the invitation email to actually be sent (`linkFor`, which resolves only
after the worker's audit write completes) before performing a second action on the same envelope.
Any future test that fires several rapid actions on one envelope should do the same. A general fix
(retrying the whole transaction on a detected deadlock, at every `audit.record()` call site) is a
reasonable follow-up but is out of this phase's scope, since the codepath is a pre-existing one this
phase did not introduce.

## Previously Recorded Workstream Verification

The original implementation records reported the following results at their respective points in
the work. These results are retained for history and do not replace verification of the final Phase 7
tree:

- Workstream 2: browser coverage for role floors, key and endpoint management, delivery inspection
  and redrive was recorded in the original management finish-line snapshot; that plan did not record full-suite result counts.
- Workstream 3: lint, API/web package typechecks, 415 unit tests, 234 API e2e tests, 31 desktop
  Chrome tests and 21 gallery scenarios were reported. The default concurrent unit run timed out in
  the existing long-certificate test; serial execution passed. A 44px copy target adjustment was
  followed by focused browser/gallery reruns.
- Workstream 4: its working plan records 424 unit tests, 234 API e2e tests, 32 desktop Chrome tests,
  and independent snapshots with 420/424 tests. The known shared jurisdiction strict-undefined
  errors and the concurrent certificate-test timeout were also reported. These claims have not been
  independently rerun during this consolidation.

## Verification

Before closing Phase 7, run the checks required by AGENTS.md on the final tree, including isolated
API and desktop browser e2e because the web app changed, then inspect the UI gallery. Record commands,
results, pre-existing failures and the commits that own fixes. Earlier slice results do not establish
that a later final tree passed.

Foundation unit coverage includes `webhook-url-guard.test.ts`,
`webhook-secret-cipher.test.ts` and `webhook-signature.test.ts`.

- e2e: `api-keys.e2e.test.ts` (issuance, scope, revocation, read-only enforcement, role floor),
  `webhooks.e2e.test.ts` (CRUD, URL rejection, endpoint cap, deactivation), `webhook-delivery.e2e.test.ts`
  (a real local HTTP receiver: signature verification, retry-then-success, exhaustion, redrive,
  unsubscribed events never delivered), `webhook-events.e2e.test.ts` (all 8 real hook points fire
  through an actual envelope lifecycle, with the right payload), `webhook-delivery-purge.e2e.test.ts`.
- Manual: register a local receiver, send a real envelope through the dev stack, confirm signature
  verification passes and events arrive in order as the envelope moves through its lifecycle.

## Existing Integration Verification — 27 September 2026

These results predate the embedded-editor proposal and MUST NOT be treated as its verification.

- Final `pnpm lint` passed. API and web package typechecks passed. Root `pnpm typecheck`
  reproduces the documented pre-existing strict-undefined errors in
  `packages/shared/src/jurisdiction.test.ts`; that file was not changed.
- Final `pnpm test` passed all 428 unit tests: 97 shared, 167 API and 164 web. The default
  concurrent run passed without the earlier certificate-test timeout.
- API e2e on Node 22.19.0 passed all 234 tests in 34 files.
- The complete desktop Chrome browser run passed all 32 tests. After the first credential-cache
  correction, all five integration browser scenarios passed again. Final gallery runs exercised
  the completed credential-lifecycle correction across all three widths.
- All six integration gallery scenarios passed (management and guide on desktop, tablet and
  mobile). Visual review inspected management panels and API/quick-start guide layouts.
- Convention review found and resolved raw secrets retained in TanStack's mutation cache and a
  deferred/offline submission race. Mutation caches now hold summaries only; four regression tests
  prove clearing, late-response rejection, same-turn cancellation and offline cancellation.
- Management and polish snapshots independently passed web typecheck, lint and their existing
  unit suites. The final four lifecycle regressions and typechecks passed on both snapshots.
- No package version or release tag changed. The consolidated Phase 7 release remains pending.


## Workstream 6: Embedded Sender Editor and HealthProHub SDK (Proposed)

### In Plain Terms

HealthProHub staff stay in HealthProHub while Envelope supplies the document editor in a framed
panel. The SDK is a small helper that opens that panel and reports UI events; it does not contain
another PDF renderer or replace HealthProHub's backend. A signer still follows an emailed link to
Envelope. This work is planned only; no SDK package or embedded session API exists today.

```
Existing document:
HealthProHub backend -> upload PDF API -> save envelopeId -> request editor session
                                                                    |
New document:                                                       v
HealthProHub backend -> request upload session -> embedded upload -> existing editor
                                                                    |
                                             recipients -> fields -> review -> send
                                                                    |
                                             emailed link -> hosted signer -> seal
                                                                    |
HealthProHub record <--------- verified webhooks + completed PDF -----+
```

Both modes MUST be delivered. Existing-draft mode comes first. Upload mode adds the existing upload
screen before the same editor. Sessions grant access to one document only, never an envelope list.
Staff can edit metadata, recipients, routing and fields while DRAFT. Sending uses the existing
confirmation screen and ends editing. This does not promise PDF text editing, replacing an uploaded
PDF, reminders, cancellation, compliance controls, account management or embedded signing.

HealthProHub MUST authenticate staff and authorize the business record before its backend issues a
session. HealthProHub stores the record-to-envelope mapping in its own database, verifies webhooks,
deduplicates event IDs, reconciles status through the API, and selects the completed PDF version
explicitly. Browser callbacks are UI notifications, never authoritative completion evidence.

### Technical Detail: Proposed Contract

All routes below use `/api/v1`. Proposed defaults and names become final only on plan approval.
No external runtime dependency is required; reuse Node crypto, Nest, Prisma, zod and the existing UI.

| Decision | Proposed contract |
|---|---|
| Entry modes | `existing` requires an authorized same-tenant DRAFT `envelopeId`; `upload` starts unbound and atomically binds to its first successfully created envelope |
| Actions | Required subset of `edit`, `send`; `edit` required for both modes; `send` optional and enforced server-side |
| Issuer | Full API key only; tenant/acting user derived from the key, never supplied by the browser |
| Parent identity | Required opaque `externalActorId` supplied by the trusted backend; no patient names or medical details; attribution is partner-asserted, not an Envelope human login |
| Origins | ADMIN/OWNER configures exact HTTPS parent origins per tenant in Settings; no wildcards, paths, credentials or `null`; HTTP loopback allowed only in isolated non-production tests |
| Lifetime | Launch credential: 60 seconds and one redemption. Editor bearer: 30 minutes absolute, no refresh; reopening requires backend authorization and a fresh session |
| Storage | HMAC hashes only for both credentials, with distinct prefixes and a dedicated `EMBED_SESSION_HASH_SECRET`; browser bearer lives only in iframe memory |
| Revocation | Every authorized request checks session expiry/revocation, issuer key revocation and current allowed origin; origin removal and key revocation block subsequent requests |
| Isolation | Dedicated embedded principal and closed route allow-list; never convert the scoped credential into an unrestricted ADMIN session |
| Publication | Workspace package `@envelope/embed` with ESM build and TypeScript declarations; registry publication/CDN hosting requires separate authorization |

Proposed endpoints:

| Method/path | Authorization and purpose | Limits |
|---|---|---|
| `GET /embed/origins` | JWT ADMIN/OWNER; list own tenant's configured parent origins | Existing authenticated read limit |
| `PUT /embed/origins` | JWT ADMIN/OWNER; replace exact-origin list, max 10 entries | 10/min per tenant |
| `POST /embed/sessions` | Full API key; `{mode, envelopeId?, parentOrigin, externalActorId, actions}`; returns `{sessionId, launchToken, launchExpiresAt, frameUrl}` once | 30/min per key and tenant |
| `POST /embed/sessions/exchange` | Dedicated launch-token validation, not normal JWT auth; body `{launchToken}`; atomic redemption returns `{accessToken, expiresAt, envelopeId?, mode, actions}` | 10/min per session plus 60/min per IP |
| `DELETE /embed/sessions/:id` | Issuing API key in same tenant; revoke idempotently, 204 | 30/min per key and tenant |
| `POST /embed/session/close` | Embedded bearer only; revoke current session, 204 | 10/min per session |
| `POST /embed/session/envelope` | Embedded upload-mode bearer only; existing multipart upload validation; atomically bind one created draft; return existing result on safe retry | Existing upload limits plus one successful draft per session |

`frameUrl` contains only a public session identifier, never a credential. Serve its HTML from a
route capable of setting session-specific `Content-Security-Policy: frame-ancestors <parentOrigin>`
headers, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Invalid sessions receive
a non-frameable error. Build/deployment MUST route this HTML through the trusted header handler;
a static Vite fallback or a meta tag is insufficient. Keep frame denial on all normal sender and
signer HTML. API CORS and HTML frame permissions are separate controls.

The parent SDK creates the frame, waits for its ready handshake, then transfers the launch token
using `postMessage` to the exact Envelope origin. Both sides validate `event.origin`,
`event.source`, protocol version and session/channel identifier. The iframe compares the sender
with its server-provided parent origin before redemption; messages use bounded shared schemas.
The exchange HTTP Origin is the iframe origin, not proof of the parent origin. Use CSP plus the
message handshake for browser framing, and treat launch credentials as secrets. No credential in
URLs, local/session storage, cookies, analytics, query/mutation caches, errors or logs. The SDK
must release launch-token references after handoff and clean up listeners on destruction.

Embedded bearer routes: detail and original PDF for the bound envelope; draft metadata,
recipient create/update/delete and field replacement when `edit` is granted; send only when `send`
is granted. Reuse existing services, `TenantPrismaService`, normalized coordinates, revision checks,
`checkReadyToSend` and send idempotency. Deny list/counts/events, arbitrary upload, other envelopes,
Settings, auth/refresh, API-key/webhook management, lifecycle/compliance and signer endpoints.
After sending, only a minimal sent confirmation/close is available in the editor; draft writes fail.
Use an explicit authorization context throughout; hiding navigation does not enforce this boundary.

New errors in the shared catalog: `EMBED_ORIGIN_NOT_ALLOWED` (403),
`EMBED_SESSION_INVALID` (401), `EMBED_SESSION_EXPIRED` (401),
`EMBED_LAUNCH_USED` (409), `EMBED_SCOPE_DENIED` (403), `EMBED_UPLOAD_BOUND` (409).
Use existing validation, stale-draft, non-DRAFT and rate-limit errors where applicable. Avoid
cross-tenant existence disclosures. All responses use the existing RFC 7807 conventions.

### Schema, Configuration and Accountability

One additive migration MUST introduce:

- `EmbedOrigin`: `id`, `tenantId`, `origin`, `createdByUserId`, `createdAt`;
  unique `(tenantId, origin)`, tenant index and restricted tenant/user foreign keys.
- `EmbedSession`: `id`, `tenantId`, `apiKeyId`, `actingUserId`, nullable `envelopeId`,
  `parentOrigin`, `externalActorId`, `mode`, `actions`, unique `launchTokenHash`, nullable unique
  `accessTokenHash`, `launchExpiresAt`, `redeemedAt`, `expiresAt`, `revokedAt`, `createdAt`;
  indexes `(tenantId, envelopeId)`, `apiKeyId`, `expiresAt`; restricted foreign keys.
  Upload binding and one-time exchange use conditional transactional writes/row locking.
  Hashes are never returned in summaries.

Reuse the API key service-account ownership model (ADR 0015). Envelope audit events MUST retain the
existing actor and include `embedSessionId` and the opaque partner actor reference in event metadata
inside the same audited transaction, without changing the hash-chain format or old rows. Session
issuance, redemption, close/revocation, upload binding and origin changes require structured logs
with IDs and outcomes only; no credentials, hashes, PDF contents, recipient details or actor reference
in logs. Review `logging/redact.ts` and browser logging as part of this step.

Add `EMBED_SESSION_HASH_SECRET` with uniqueness/production guards and
`EMBED_SESSION_PURGE_CRON` (default `45 3 * * *`) to configuration, `.env.example`, API test env and
browser stack. Purge operational session rows seven days after expiry; preserve audit metadata.
Reuse maintenance scheduler/processor patterns. No development database or real email in tests.

### SDK and UI Contract

Proposed `createEnvelopeEditor({container, frameUrl, launchToken, onEvent})` mounts one editor and
returns `requestClose()` and `destroy()`. This is a planned API, not an installable example yet.
`requestClose()` asks the UI to save or confirm discarding pending edits; `destroy()` immediately
removes listeners/frame and makes no save guarantee. Both clear SDK-held secrets. On normal close,
revoke the session; HealthProHub SHOULD revoke it server-side when its own page/session ends.
Expiry is the fallback when a browser disappears. No parent-supplied redirect URL is accepted.

Versioned events: `ready`, `draft.created`, `draft.saved`, `envelope.sent`, `close`, `error`,
`session.expired`. Include only session/envelope IDs, revision where relevant, and safe error codes.
A save event MUST follow server persistence; a send event MUST follow a successful send response.
A lost callback is recovered by HealthProHub reading the envelope; it MUST NOT trigger another
upload/send blindly. Upload retry binding MUST recover the same envelope after a lost response.
Expiry/conflicts must preserve visible unsaved state long enough to explain recovery; never silently
claim a save or persist document state in browser storage. A refresh requires a fresh backend session.

Reuse `NewEnvelopePage.tsx`, `PreparePage.tsx`, `ReviewPage.tsx`, `features/builder/`,
`components/pdf/PdfViewer.tsx` and `features/sending/SendDialog.tsx`. Extract reusable editor content
and inject its API transport; keep the normal sender login/refresh client in `lib/api.ts` separate
from the embedded in-memory bearer client. Use a session-local QueryClient and clear queries,
mutation state, PDF object URLs and credentials on teardown. Do not bootstrap `SenderApp` login,
dashboard or Settings in the embedded route. Preserve standalone behavior and accessible labels.

### Implementation Steps (One Commit per Step)

| Step | Deliverable and reuse | Required tests | Status |
|---|---|---|---|
| 6.1 | Shared zod contracts/errors, schema migration, secret config and typed protocol; update docs/08 and docs/05 with As built notes only after implementation | Schema/contract and config tests, migration review, secret separation | Proposed |
| 6.2 | Origin/session controllers, atomic exchange/upload binding, embedded guard and scoped service calls; reuse auth patterns, tenant services, audit and maintenance purge | API e2e for tenant/route/action isolation, revoked keys/origins, concurrent exchange/upload, lost upload response, expiry, purge and redaction | Proposed |
| 6.3 | Dynamic embed HTML/header serving and dedicated UI transport; reuse upload/prepare/review components and autosave, retain normal sender routes | Component tests for permissions, dirty close, conflicts, expiry and teardown; standalone editor regressions; header/API tests | Proposed |
| 6.4 | Dependency-light `packages/embed` SDK, build/typecheck/workspace wiring and plain JS/TypeScript usage examples; document direct iframe handshake too | Protocol tests: wrong origin/window/session/version, duplicate messages, timeout, cleanup and multiple frames | Proposed |
| 6.5 | Settings origin management and HealthProHub guide section in the existing Integration guide | ADMIN/OWNER vs MEMBER tests, example/schema checks, copy/accessibility and browser guide navigation | Proposed |
| 6.6 | Isolated HealthProHub-like host harness, cross-origin end-to-end flows, gallery, docs/changelog finish line and step commit references | Full required verification plus embedded security, cookie-independent operation and visual checks below | Proposed |

### Settings → Integrations: HealthProHub Guide Acceptance

The existing `IntegrationGuide.tsx` and `integration-reference.ts` MUST gain a discoverable
**HealthProHub / Embedded editor** section. Keep management and current API/webhook guidance usable.
The new section MUST include:

1. A capability/status table distinguishing headless API, embedded preparation and hosted signing;
   never describe a planned feature as available before it is shipped.
2. Both complete flows: API upload then open draft, and upload within the iframe. Explain reopening
   the same draft and persisting its business-record mapping.
3. Backend session issuance with permission checks and environment-held API keys; frontend SDK mount,
   close/cleanup and callbacks; a direct-iframe example with the identical secure handshake.
4. Exact origin setup, lifetime/revocation, edit versus send access, and prohibited token placement.
5. Webhook verification/deduplication, authoritative status reconciliation and final PDF selection;
   explain that `envelope.sent` in the browser does not mean signed or completed.
6. Troubleshooting for framing headers, wrong origin, replayed/expired session, stale draft,
   blocked cookies, revoked key, upload retry and unsaved changes; link to existing API reference.
7. Copyable placeholder examples tested against implemented contracts, no real credentials and no
   invented published package version or install command before an artifact is available.

HealthProHub application changes are outside this repository. Deliver a working local host example
and integration contract here; actual partner rollout needs its repository and deployment origins.

### Verification and Deliberate Simplifications

Use the phase-build snapshots and verification procedure. Run lint, root/package typechecks, unit
suite, API e2e under Node 22.19.0 and desktop Chrome e2e once after all steps, then fixes as required.
Include the SDK in root checks. Run the cross-origin host harness using distinct loopback origins,
isolated databases/Redis/mail/storage and real services; never connect it to production HealthProHub.
Verify both modes through upload, recipients, field persistence, send, hosted signing and completed
webhook/PDF retrieval. Test concurrent sessions, same-tenant wrong-envelope access, cross-tenant IDs,
read-only keys, unrelated authenticated sessions, hidden-route access and new-session reopening.
Inspect effective HTML headers, credential redaction, request URLs and browser storage. Test with
third-party cookies blocked in Chromium and an available WebKit project; add an isolated WebKit
project if absent. Capture embedded/editor and guide views at 375/768/1440px and inspect keyboard,
focus, overflow, field dragging and close behavior. Report browser-engine coverage honestly; a
WebKit run alone does not certify every production Safari environment.

No embedded recipient signing, broad SSO, partner envelope browser, native React editor package,
white-label theming, external CDN/package publication or automatic HealthProHub deployment. No new
release or tag is implied by adding this workstream. Plan approval is required before product code.

### Approval

The user approved this workstream on 27 September 2026 with “continue”. ADR 0016 is accepted;
steps 6.1–6.6 are authorized for implementation. Proposed contract terminology below records
the planning origin; implementation evidence and final checks will be appended as work completes.

### Planning Validation

Documentation-only change: review status/scope consistency, referenced local paths, proposed API
and schema completeness, ADR/index links and `git diff --check`. Historical test results above remain
historical; no product checks are claimed for this proposal.
