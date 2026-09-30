# Phase 7: Integrations Plan

| | |
|---|---|
| **Status** | Built through workstream 11 (API-key lifecycle, downloads and limits). Foundation shipped as `v0.7.0`. Workstreams 12–13 remain planned; release remains workstream 14 |
| **Version** | 1.4.0 |
| **Last updated** | 29 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 7 deliver across the integration API, management UI and user guide, and how is it built and checked? |

---

# PART 1: In Plain Terms

## What Phase 7 Is

Phase 6 delivered compliance and is complete. Phase 7 delivers the integration capability in
reviewable workstreams recorded together in this plan. The commit history contains earlier labels
such as Phase 6b; those labels remain in Git history, while this document is the maintained Phase 7
record. The released foundation and subsequent management UI work are included alongside the
completed in-page guide. The embedded sender editor below is built. Any tenant can integrate its application; HealthProHub is the worked example:

```
   BUILT ──────────────► API keys (server-to-server auth) and webhooks (event notifications), so
                          HealthProHub — the first integration partner — can create and send
                          envelopes programmatically, and learn about status changes without
                          polling.
   BUILT ──────────────► Admins and Owners manage API keys and webhook receivers in Settings,
                          including delivery history and retries.
   BUILT ──────────────► Follow the integration guide on the same page, with API examples,
                          webhook verification and troubleshooting.
   BUILT ─────────────► Embedded sender editor and thin JavaScript SDK for HealthProHub:
                          open an uploaded draft, or upload inside the embedded editor.
   OUT OF SCOPE ───────► Embedded recipient signing, delegation, in-person signing, and
                          self-serve multi-partner onboarding.
   SIGNING UNCHANGED ──► A signer always finishes on Envelope's own hosted web app, reached by the
                          emailed link. This is intentional: every signer sees Envelope's own
                          branding and becomes a visit to Envelope's own site. The API and webhooks
                          cover envelope creation, sending and status only, never the sign step.
```

## What You Can Do at the End of Phase 7

1. **Create an API key** from Settings. The raw key is shown once, at creation; only its hash is
   ever stored. A key can be marked read-only.
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
7. **Available: prepare documents inside HealthProHub** using the existing Envelope upload, PDF
   preview, recipient, field-placement and review/send UI, without building another editor.
8. **Available: follow a HealthProHub embedded-editor guide** in Settings → Integrations, covering
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
- [x] Verification of the existing integration work is recorded below; embedded verification is recorded separately below.
- [x] Both embedded entry modes support upload/prepare/review/send with the existing UI.
- [x] Sessions cannot access another envelope, tenant, dashboard, Settings or signing routes.
- [x] A draft can be saved, closed and reopened with a new authorized session.
- [x] One upload session creates at most one draft, including concurrent/retried uploads.
- [x] SDK and direct-iframe examples work without third-party cookies or exposed API keys.
- [x] Settings → Integrations includes the tested generic embedded-editor guide with a HealthProHub example.
- [x] Extension verification passes, including cross-origin browser and credential-leakage tests.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| HealthProHub's actual integration requirements (which routes they call, what their receiver expects) | This phase built a generic mechanism against the documented spec; it has not yet been validated against a real partner integration | Before HealthProHub goes live |
| HealthProHub deployment origins and backend framework | Register the exact origins on their API key and adapt the backend example; placeholders suffice for this plan and isolated tests | Before partner deployment |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Existing API/webhook integration plus embedded sender editor, thin SDK and HealthProHub guide. Embedded recipient signing, delegation, in-person signing and self-serve multi-partner onboarding remain outside this phase |
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

- [ADR 0016](adr/0016-scope-embedded-editor-sessions-to-one-envelope.md) — accepted embedded sender authentication and iframe boundary

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
| 6 | Embedded sender editor, SDK and HealthProHub guide | ✅ Built and verified | Steps 6.1–6.6 below |
| 7 | Per-key embedded origins, plus a member ownership-scope fix | ✅ Built | Steps 7.0–7.4; ADR 0017 |
| 8 | Webhook reliability and event contract v1 | ✅ Built | Steps 8.1–8.5; ADR 0018 |
| 9 | Webhook endpoint lifecycle tooling | ✅ Built | Steps 9.1–9.6; ADR 0018 |
| 10 | Partner references and safe retries | ✅ Built | Steps 10.1–10.5; ADR 0019 |
| 11 | API-key lifecycle, downloads and limits | ✅ Built | Steps 11.1–11.5 |
| 12 | Hosted SDK and runnable partner example | Accepted; planned | Steps 12.1–12.3; ADR 0020 |
| 13 | One integration contract, OpenAPI and developer guide | Accepted; planned | Steps 13.1–13.4; ADR 0021 |
| 14 | Release | Planned, separate authorization required | No product version bump or tag until an authorized Phase 7 release |

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

- The completed guide workstream introduced no new permissions, SDK or endpoints. Workstream 6
  adds embedded sender preparation; recipient signing remains hosted.
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

> **As built (workstream 11, step 11.1).** The application race described here is fixed: every
> audit-writing mail-worker transaction now locks the envelope row first, as cancel does, and
> `audit-concurrency.e2e.test.ts` proves it. The text below is the original record; the rule to
> wait on `linkFor` before a second action on the same envelope still applies to tests.

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


<a id="workstream-6-embedded-sender-editor-and-healthprohub-sdk-proposed"></a>

## Workstream 6: Embedded Sender Editor and SDK (Built)

### In Plain Terms

HealthProHub staff stay in HealthProHub while Envelope supplies the document editor in a framed
panel. The SDK is a small helper that opens that panel and reports UI events; it does not contain
another PDF renderer or replace HealthProHub's backend. A signer still follows an emailed link to
Envelope. This work is built: the `@envelope/embed` SDK package and the embedded session API both
exist today.

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

### Technical Detail: Implemented Contract

All routes below use `/api/v1`. These contracts are implemented and verified.
No external runtime dependency is required; reuse Node crypto, Nest, Prisma, zod and the existing UI.

| Decision | Implemented contract |
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

Implemented endpoints:

| Method/path | Authorization and purpose | Limits |
|---|---|---|
| `GET /embed/origins` | JWT ADMIN/OWNER; list own tenant's configured parent origins | Existing authenticated read limit |
| `PUT /embed/origins` | JWT ADMIN/OWNER; replace exact-origin list, max 10 entries | 10/min per tenant |
| `POST /embed/sessions` | Full API key; `{mode, envelopeId?, parentOrigin, externalActorId, actions}`; returns `{sessionId, launchToken, launchExpiresAt, frameUrl}` once | 30/min per key and tenant |
| `POST /embed/sessions/exchange` | Dedicated launch-token validation, not normal JWT auth; body `{sessionId, launchToken}`; atomic redemption returns `{accessToken, expiresAt, envelopeId?, mode, actions}` | 10/min per session plus 60/min per IP |
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

The SDK `createEnvelopeEditor({container, frameUrl, launchToken, onEvent})` mounts one editor and
returns `requestClose()` and `destroy()`. This API is built and installable from the workspace
(`packages/embed`); workstream 12 makes it installable outside this monorepo as a hosted script.
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
| 6.1 | Shared zod contracts/errors, schema migration, secret config and typed protocol; update docs/08 and docs/05 with As built notes only after implementation | Schema/contract and config tests, migration review, secret separation | ✅ Built |
| 6.2 | Origin/session controllers, atomic exchange/upload binding, embedded guard and scoped service calls; reuse auth patterns, tenant services, audit and maintenance purge | API e2e for tenant/route/action isolation, revoked keys/origins, concurrent exchange/upload, lost upload response, expiry, purge and redaction | ✅ Built |
| 6.3 | Dynamic embed HTML/header serving and dedicated UI transport; reuse upload/prepare/review components and autosave, retain normal sender routes | Component tests for permissions, dirty close, conflicts, expiry and teardown; standalone editor regressions; header/API tests | ✅ Built |
| 6.4 | Dependency-light `packages/embed` SDK, build/typecheck/workspace wiring and plain JS/TypeScript usage examples; document direct iframe handshake too | Protocol tests: wrong origin/window/session/version, duplicate messages, timeout, cleanup and multiple frames | ✅ Built |
| 6.5 | Settings origin management and HealthProHub guide section in the existing Integration guide | ADMIN/OWNER vs MEMBER tests, example/schema checks, copy/accessibility and browser guide navigation | ✅ Built |
| 6.6 | Isolated HealthProHub-like host harness, cross-origin end-to-end flows, gallery, docs/changelog finish line and step commit references | Full required verification plus embedded security, cookie-independent operation and visual checks below | ✅ Built |

### Settings → Integrations: HealthProHub Guide Acceptance

The existing `IntegrationGuide.tsx` and `integration-reference.ts` MUST gain a discoverable
**Embedded editor** section, available to every tenant with HealthProHub as a worked example. Keep management and current API/webhook guidance usable.
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
release or tag was implied by this workstream; release remains a separate authorized workstream 14.

### Approval

The user approved this workstream on 27 September 2026 with “continue”. ADR 0016 is accepted;
steps 6.1–6.6 were authorized for implementation and are now built and verified (below).

### Planning Validation (Historical)

Before implementation, this workstream's plan was reviewed as a documentation-only change: status/scope
consistency, referenced local paths, proposed API and schema completeness, ADR/index links and
`git diff --check`. That review predates code and is retained for history; it does not stand in for
the product verification recorded below.

### Embedded editor build progress (28 September 2026)

Steps 6.1–6.6 are implemented and verified; commit records follow.
The convention review identified session/token binding and close-during-launch races. Redemption
now requires the iframe session ID; a mismatched token is rejected without consuming it. Closed
frames cannot activate a late bearer and revoke a successful late exchange. Upload/send closure
is blocked until the operation settles. Origin input rejects noncanonical hosts and ports.

The Settings guide includes both entry modes, backend issuance, SDK and direct iframe examples,
origin management, hosted signing, verified webhooks and recovery. The local host harness uses
real isolated services and never calls the HealthProHub production application.

### Embedded Verification — 28 September 2026

- Convention review: final focused review passed; session/token binding, closure races and
  canonical-origin findings were fixed, with regression coverage.
- Final lint passed. API, web and SDK typechecks and shared production build passed. Root
  typecheck still reports only the eight known strict-undefined errors in shared/jurisdiction.test.ts.
- Unit verification passed sequentially: 445 tests (shared 100, API 168, web 173, SDK 4).
  The initial concurrent run timed out two existing PDF certificate tests and one guide test
  under load; unchanged tests passed in isolation/sequential runs. No timeout was increased.
- API e2e under Node 22.19.0: 241/242 passed initially; the new purge test incorrectly used
  get() for scoped PinoLogger. After resolve() correction, all eight embedded API tests passed.
- Full desktop browser suite: 32 existing scenarios passed. Both new scenarios initially used
  a helper requiring a checkbox absent from this signature-only draft. The corrected workflows
  passed in cookie-blocked Chromium and WebKit: four complete flows, through signed webhook and
  final PDF download. The direct iframe snippet has schema/example checks, not a separate full
  browser lifecycle run.
- Full gallery: 27 existing scenarios passed; three new scenarios had an incorrect upload
  heading locator. After correction, all six embedded/editor-guide scenarios passed at
  375/768/1440px. Chromium full-page capture omitted cross-origin iframe pixels; viewport
  captures corrected this and all three embedded capture scenarios passed again. Tablet
  capture was visually inspected. Existing field-builder keyboard/placement regressions passed.
- Every step snapshot passed independent lint, API/web/SDK typechecks where present, shared
  production build and unit suites. The known shared test-file typecheck failure was excluded
  from those package checks and remains reported above.
- The isolated browser stack logged ERR_HTTP_HEADERS_SENT on the unchanged original file
  endpoint's manually-ended 304 branch. Download bytes and functional checks passed. This
  pre-existing branch remains unchanged; resolving it is outside this integration slice.
- The additive migration was applied to the development database after the user reported a
  missing EmbedOrigin table. No reset or data deletion was performed.
- No release, tag, push, registry publication or HealthProHub application deployment occurred.

| Step | Commit |
|---|---|
| 6.1 | 31c9e68 |
| 6.2 | 8f68270 |
| 6.3 | 77d190b |
| 6.4 | ecaa5de |
| 6.5 | 49b57eb |
| 6.6 | 1b88ca7 |

## Workstream 7: Per-Key Embedded Origins (Accepted)

### In Plain Terms

Any tenant can integrate its own application; HealthProHub is a worked example. The existing
implementation already enforces tenant isolation. This extension improves setup and separates
each integration's iframe permissions. It does not add a HealthProHub allow-list.

Step 7.0 is a standalone, unrelated security fix folded into this workstream because it was found
while auditing the same controller family: `GET /envelopes/:id/events` and `GET /envelopes/:id/file`
never applied the same per-owner scope that `GET /envelopes/:id` already does, so a MEMBER could read
another MEMBER's audit events and document bytes by id. It ships first, on its own commit.

```
Admin/Owner creates key
       |
       +-- Backend only ------> no origins; existing server API works
       |
       +-- Embedded editor ---> full key + exact application origins
                                 |
                                 +--> backend authorizes staff/record
                                 +--> issues one-envelope session
                                 +--> frontend opens SDK/iframe
```

The Create API key dialog MUST offer optional embedded-editor setup. A read-only key cannot
launch a writable editor. Existing full keys MAY gain origins later through an Edit embedded
origins action. The separate workspace origin panel is removed after cutover. Raw keys are
shown once and remain on the integration server. Origins are public permission metadata.

Finish line:
- [x] A MEMBER cannot read another MEMBER's envelope events or document bytes by id (step 7.0).
- [x] Every tenant can configure its own integration; HealthProHub appears only as an example.
- [x] Create a full key and its optional origins in one atomic request/dialog.
- [x] Backend-only and read-only key creation remain compatible with existing clients.
- [x] Two keys in one tenant cannot launch or continue sessions for each other's origins.
- [x] ADMIN/OWNER can edit origins on active full keys; MEMBER/key/embed credentials cannot.
- [x] Removing an origin/revoking a key invalidates affected sessions, with recovery guidance.
- [x] Migration preserves existing permissions/data; docs, examples and responsive UI agree.

Deployment origins remain per-tenant configuration, not values supplied to this repository's tests.

### Technical Detail and Decisions

ADR 0017 supersedes only ADR 0016's tenant-wide origin management. Its other session, HMAC,
signing and iframe boundaries remain accepted. No accepted ADR is rewritten.

| Question | Decision |
|---|---|
| Origin owner | API key within its tenant; never a global partner registry |
| Headless keys | Optional empty list preserves existing API access; cannot issue editor sessions |
| Read-only keys | Origin list must be empty; shared zod rejects contradictory creation |
| Origin changes | Human ADMIN/OWNER JWT only; no raw-key rotation required |
| Existing grants | Backfill legacy tenant origins onto active full keys; review/narrow afterward |
| Legacy setup | `EmbedOrigin` table kept only as a migration rollback path; its `GET`/`PUT /embed/origins` routes are removed outright — they shipped in this same unreleased phase and have no external caller, so there is nothing to keep compatible |

#### Schema and Migration

Add `ApiKeyEmbedOrigin`: UUID id, tenantId, apiKeyId, canonical origin, createdByUserId and
createdAt. Add ApiKey/Tenant/User inverse relations, unique `(apiKeyId, origin)`, tenant/key lookup
indexes, and restricted foreign keys. Extend key creation to write key, acting user and origins
in one transaction. Do not edit migration 20260927090000_embedded_editor: it has already been
applied to local databases. Add a reviewed SQL migration and backfill with tenant-matching joins.
Keep legacy EmbedOrigin rows for rollback; authorization stops reading them after cutover.

#### Buildable Contract Sequencing

Step 7.1 introduces the new origin-aware schemas/DTOs alongside existing exports, without
wiring them into current controllers or changing existing required caller fields. Step 7.2
switches the API service/controller to those contracts; step 7.3 switches the management UI.
Each snapshot MUST build and pass its tests independently; do not introduce required summary
fields or defaulted input fields before their callers/projections are updated in the owning step.

#### Public API Contract

- `POST /api/v1/api-keys`: existing ADMIN/OWNER JWT route and lifecycle rate limit; add optional
  `embedOrigins: string[] = []`, max ten canonical HTTPS origins. Read-only + nonempty returns
  `400 VALIDATION_FAILED`. Return origins in ApiKeySummary without changing the one-time rawKey.
- `GET /api/v1/api-keys` and revoke response include `embedOrigins`; include relations in one
  query, avoiding one lookup per key. Origins are safe metadata, never key credentials.
- `PUT /api/v1/api-keys/:id/embed-origins`: human ADMIN/OWNER JWT, ten changes/min per tenant,
  UUID validation, strict `{origins}` schema, max ten. Return ApiKeySummary. Tenant-mismatched ID
  is 404 NOT_FOUND; read-only is 403 API_KEY_READ_ONLY; a revoked key is **409 CONFLICT** — not a
  401, because the web client treats any 401 as its own session expiring and silently refreshes
  (`apps/web/src/lib/api.ts`), which would misreport whose credential actually expired.
- `POST /embed/sessions`: existing full-key issuance, same rate limits; approved parent origin
  MUST belong to that key and tenant. Empty/unmatched reuses the existing **403
  EMBED_ORIGIN_NOT_ALLOWED** (ADR 0016) rather than a new code.
- Session exchange still requires `{sessionId, launchToken}`. Bearer authentication, frame HTML
  and upload transaction re-check origin against the issuing key. Removal affects live sessions.
- `GET`/`PUT /embed/origins` are **removed**, not deprecated: they were built in this same
  unreleased phase and have no external caller. No new error code is introduced for them.
- No new error code is required for this workstream; it reuses NOT_FOUND, API_KEY_READ_ONLY,
  CONFLICT and EMBED_ORIGIN_NOT_ALLOWED. Management remains closed to API keys and embedded
  bearers; generic server API authentication does not use Origin.

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 7.0 | `fix(api)`: apply `ownerScopeOf` to `GET :id/events` and `GET :id/file`, before the ETag/304 check | Extend `roles.e2e.test.ts`: a MEMBER gets 404 on another MEMBER's events/file, including with `If-None-Match`; ADMIN and API keys unaffected | ✅ Built |
| 7.1 | Shared key-create/summary contracts, errors, additive model/migration/backfill; reuse embedOriginSchema and existing key schemas | Defaults/invalid origins/read-only contracts; SQL review and migrated grants | ✅ Built |
| 7.2 | Atomic key/origin creation, scoped origin edit, session/upload authorization and removal of the tenant-wide `/embed/origins` routes; reuse ApiKeyService, EmbedSessionService, transaction locks and structured logs | Real API e2e for tenant/role/key isolation, concurrency, removal, revoke, empty lists | ✅ Built |
| 7.3 | Create-key origin controls, per-key display/edit dialog; remove separate panel; generic Embedded editor guide and examples | Component/copy tests, keyboard/focus, responsive origin lists and one-time secret cleanup | ✅ Built |
| 7.4 | Two integration-key host flows, migration/regression security tests, gallery, docs/05/08/10/index/changelog and commit evidence | Full mandatory verification, cookie-blocked Chromium/WebKit and independent snapshot checks | ✅ Built |

Creating and changing origin permissions MUST log tenant/key IDs and count only, without keys,
launch tokens, actor IDs or request payloads. Reuse the current rate-limit, AppException, zod,
TenantPrismaService/explicit tenant filters, audit and logging rules. Session actions/envelope
scope, HMAC secret, purge and hosted signer flow do not change.

The guide MUST distinguish already implemented tenant integration from this setup refinement while
it is still being built (step 7.3 ships it once the API side is live, not before). Explain creating
headless vs embedded keys, exact-origin matching, editing/removal,
backend staff/record authorization, SDK memory-only handshake, webhook reconciliation and final
PDF retrieval. Show a generic application example and optionally a HealthProHub worked example.
Production normal HTML keeps deny-frame headers; only the scoped dynamic iframe HTML allows its
parent. Origin fields are not CORS settings or substitutes for backend authentication.

No broad OAuth/partner onboarding wizard, per-envelope full API keys, theming, browser API-key
use, embedded signing, external package publication or release/tag/push is included.

**Approval status:** ADR 0017 is accepted; workstream 7 is built and verified (below).

| Step | Commit |
|---|---|
| 7.0 | 478731d |
| 7.1 | 8ab2379 |
| 7.2 | a26693a |
| 7.3 | 7d0cde7 |
| 7.4 | 52fa083 |

### Workstream 7 Verification — 28 September 2026

- `pnpm --filter @envelope/api typecheck`, `pnpm --filter @envelope/shared typecheck` and
  `pnpm --filter @envelope/web typecheck` passed. Root `pnpm typecheck` reproduces only the
  known pre-existing `shared/jurisdiction.test.ts` strict-undefined errors.
- `npx biome check` passed on every file this workstream touched.
- Migration `20260928070021_api_key_embed_origins` was reviewed by hand; its backfill was
  exercised against the existing development database (1 pre-existing `EmbedOrigin` row, 0
  eligible active full keys — 0 rows backfilled, as expected). `prisma migrate diff
  --from-migrations ... --exit-code` reports no drift.
- API e2e: `roles.e2e.test.ts` (9 tests, including the new step 7.0 scope regression),
  `api-keys.e2e.test.ts` (7 tests) and `embed.e2e.test.ts` (9 tests, including the new
  two-key-isolation and read-only/origin-rejection cases) all passed on Node 22.19.0.
  Reproducing the bug this step fixed first: `embed.e2e.test.ts`'s upload-binding transaction
  had a second, independent origin re-check against the old tenant-wide `EmbedOrigin` table
  (`envelopes.service.ts`, the upload-binding transaction) that step 7.2 initially missed —
  caught by the existing "binds concurrent/retried uploads" test failing with
  `EMBED_SCOPE_DENIED` once the tenant-wide table stopped being populated; fixed in the same
  step's snapshot before committing.
- Browser e2e (desktop Chrome): the full existing `embed.spec.ts` (2 tests) and
  `integrations.spec.ts` suites (5 existing + 1 new test covering per-key origin creation,
  validation-by-line, independent second-key origins, and the add-vs-remove confirmation
  behavior) passed.
- UI gallery: `integration settings` and `HealthProHub embedded editor` scenarios passed on
  desktop, tablet and mobile.
- Convention review: reviewed the diff for tenancy (all origin reads/writes filter by
  `apiKeyId`/`tenantId`), logging (only counts and ids logged, never origins' full URLs in a
  way that would be unusual — origins are already public permission metadata, matching the
  existing tenant-wide log line's precedent), and queue/audit ordering (none of this
  workstream's writes touch queues or the audit trail). No findings.

## Workstream 8: Webhook Reliability and Event Contract v1 (Accepted)

### In Plain Terms

A partner's receiver should be able to trust the schedule and headers this system documents, and
every webhook should carry enough data to update the partner's own record without a follow-up API
call. Two bugs are fixed here: the `recipient.signed` event always claimed the envelope was only
partially signed, even when that signature was the last one needed, and the documented 12-hour
retry never actually ran because the queue was configured for one fewer attempt than the schedule
has entries.

Finish line:
- [ ] `recipient.signed` reports the envelope's real status, including when it is now fully signed.
- [ ] The documented 10s/1m/5m/30m/2h/12h schedule delivers 7 total attempts, and the 12h delay runs.
- [ ] Every fired event includes `apiVersion` and the envelope's title; each event's own commonly
      needed fields (status, recipient email, reason) are present without a follow-up API call.
- [ ] `envelope.extended` fires when an expired envelope is reopened.
- [ ] Every delivery request carries an event-id, event-type, delivery-id, attempt-number header and
      a versioned `User-Agent`, so a receiver can log and deduplicate without parsing the body first.
- [ ] Admins can browse and retry deliveries with filters and paging, not only per-endpoint.

### Technical Detail and Decisions

ADR 0018 governs this and workstream 9: all changes to the webhook contract are additive so that an
existing receiver, written against the `v0.7.0` contract, keeps working without changes.

| Question | Decision |
|---|---|
| Versioning | Add `apiVersion: 'v1'` to every payload; existing consumers ignore unknown fields by convention (documented, not enforced) |
| Attempt count | 7 total attempts (1 try + 6 retries), matching the 6-entry documented schedule; `attempts` counts across redrives instead of resetting |
| New fields | Only added to existing event payloads, never renamed or removed, so a receiver parsing today's shape keeps working |
| New event | `envelope.extended`, added to `WEBHOOK_EVENT_TYPES`; an "all events" subscription starts receiving it |
| Recipient decline reason | Not added to the webhook payload — a signer's free-text reason can contain health information; it stays behind the authenticated `GET` detail route |
| Delivery browsing | New tenant-wide `GET /webhooks/deliveries` with filters, alongside the existing per-endpoint route, which is kept |

#### Schema and Migration

`packages/shared/src/webhooks.ts` gains `WEBHOOK_API_VERSION`, the `envelope.extended` event type,
a non-subscribable `webhook.test` type (workstream 9), header name constants, per-event zod data
schemas (loose objects, so later additive fields do not break them), and
`listWebhookDeliveriesPageQuerySchema` (`endpointId?`, `status?`, `eventType?`, `eventId?`,
`envelopeId?`, `limit` 1–100 default 50, `cursor?`). `WebhookDeliverySummary` gains
`webhookEndpointId`, `envelopeId` and `nextAttemptAt`.

One migration, `webhook_delivery_envelope`: nullable `WebhookDelivery.envelopeId` (denormalized, no
foreign key, the same pattern `tenantId` already uses on this table), indexes on
`(tenantId, envelopeId)`, `(tenantId, id)` and `(webhookEndpointId, id)`, backfilled from each row's
stored `payload->'data'->>'envelopeId'`.

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 8.1 | Shared event/header/query contracts, `envelopeId` migration and backfill, web event label | Contract and migration tests | Implemented; verification pending |
| 8.2 | Fix `WEBHOOK_MAX_ATTEMPTS` to 7, stop resetting `attempts` on redrive, write `nextAttemptAt`, add delivery headers and `User-Agent` | `webhook-retry-schedule.test.ts`; corrected `webhook-delivery.e2e.test.ts` expectations (7 attempts; redrive keeps counting; headers present) | Implemented; verification pending |
| 8.3 | Richer, additive per-event payloads including the `recipient.signed` fix and `envelope.extended` | `webhook-events.e2e.test.ts` parses every payload against the shared schemas | Implemented; verification pending |
| 8.4 | `GET /webhooks/deliveries`, `GET /webhooks/deliveries/:id`, `POST /webhooks/deliveries/:id/retry` (session ADMIN/OWNER only); old per-endpoint routes kept, documented as deprecated | API e2e: paging, each filter, cross-tenant 404, API-key and MEMBER 403 | ✅ Built |
| 8.5 | Web: deliveries dialog gains filters, Load more, event-id copy, envelope id, attempt/next-retry display; guide and docs/08 As-built note | Component and browser tests; gallery | ✅ Built |

#### Implementation record (steps 8.1–8.4, 28 September 2026)

The current build adds event/query/header contracts, delivery envelope indexes and backfill,
seven total delivery attempts, lifetime counts across redrive, retry timestamps and delivery
headers. All nine fired events carry the contract version and envelope title. Viewing and
consent report the status read within their transaction; signing reports the actual status,
`allSigned` and `remainingSigners`. Sealing remains asynchronous: the last signature still leaves
`PARTIALLY_SIGNED` until the completion worker commits `COMPLETED`. A sender cancellation includes
its reason; a recipient decline deliberately excludes its free-text reason. Deadline extensions
fire `envelope.extended` both before expiry and when reopening, after the transaction commits.

Regression coverage validates every fired event against the shared schema, checks repeated view
and consent do not duplicate events, checks one and two signer counts, and verifies extension
idempotency. The migration test shadows the delivery table with a temporary table and rolls back
all fixture and migration changes. The backfill leaves malformed historical envelope IDs null
without changing their stored payloads.

Step 8.4 adds `GET /webhooks/deliveries` (tenant-wide, filterable by endpoint, status, event type,
event id and envelope id, paged with the same `(createdAt, id)` cursor idiom `envelopes.service.ts`
already uses), `GET /webhooks/deliveries/:id`, and `POST /webhooks/deliveries/:id/retry` as a
clearer-named alias for the existing per-delivery redrive. The two existing per-endpoint routes
(`GET /webhooks/:id/deliveries`, `POST /webhooks/:id/redrive`) are kept and marked `deprecated` in
the served OpenAPI document; nothing about their behavior changes. `envelope.completed`'s
`completedAt` now comes from the transaction's own committed value, not a second clock read after
it — the two could previously disagree by however long sealing's transaction took to commit.

Verification of the complete implementation (steps 8.1–8.4), rerun cleanly after step 8.4 was added:

| Check | Result |
|---|---|
| `pnpm lint` | Passed |
| `pnpm typecheck` | Existing shared `jurisdiction.test.ts` strict-undefined failures only; API, web, embed typechecks and the shared production build passed separately |
| `pnpm test` | 472 passed: shared 116, API 173, web 179, embed 4 |
| API e2e, Node 22.19.0 | 251 passed across 36 files |
| Browser e2e, desktop-chrome, isolated stack | 35 passed (rerun after the sealing.service.ts fix; step 8.4 does not touch apps/web) |
| Targeted webhook e2e (events, delivery, migration, endpoints, browsing) | 31 passed |
| Every step's own tree (8.1, 8.2, 8.3, 8.4) | Independently rebuilt and typechecked/linted/unit-tested in a scratch worktree; each builds on its own |

Two flakes were investigated and are recorded, not dismissed:
- Running `webhooks.e2e.test.ts`'s new delivery-browsing test required its own dedicated app and
  worker instance (`WEBHOOK_ALLOW_INSECURE_LOCAL_URLS` is read once at boot, and the file's shared
  instance must keep rejecting loopback URLs for its own existing rejection test) — it initially
  timed out waiting on the default 10s budget under load from adjacent e2e files in the same run;
  raised to 15s, matching the same budget `webhook-delivery.e2e.test.ts`'s own worker-dependent
  wait already uses, and confirmed stable across repeated runs both alone and alongside its sibling
  webhook files.
- One `ECONNRESET` on `sealing.e2e.test.ts`'s concurrent-signers test appeared during a run that
  briefly overlapped with another e2e invocation on the same host; it passed cleanly, repeatedly,
  once runs were no longer overlapping, and is unrelated to any file this workstream changed.

Correcting `webhook-delivery.e2e.test.ts`'s attempt-count assertions (6 → 7) makes the test match
the schedule this system has always documented; it is a fix to match the documented contract, not
a weakening. No existing assertion is deleted or loosened.

#### Step 8.5: Web Deliveries Dialog

The endpoint-scoped Deliveries dialog now reads through the tenant-wide, paged route from step 8.4
(`GET /webhooks/deliveries?endpointId=...`) instead of the deprecated per-endpoint one, and its
retry button calls `POST /webhooks/deliveries/:id/retry` instead of the deprecated redrive route.
Status and event-type filters sit above the list; each filter change starts a fresh page chain
(reusing the same `useInfiniteQuery` idiom `EnvelopeDetailPage.tsx`'s own "Load more events" already
uses), with a "Load more deliveries" button once a page is exhausted. Each delivery row shows a
small copy-to-clipboard control for its event id and, when present, its envelope id — reusing the
existing `useCopyToClipboard` hook rather than the full `HashBlock` card, which is sized for a
document fingerprint, not an inline list row. A delivery's own "next retry at" time is shown when
one is scheduled.

**Tests:** `apps/web/e2e/integrations.spec.ts` gained a dedicated browser test covering both
filters, the load-more page chain's underlying route, and both copy-id buttons (Chromium clipboard
permissions, matching the existing pattern `upload-and-view.spec.ts` and the guide's own copy tests
already use). Two existing tests needed small, mechanical fixes once the new event-type filter
`<select>` made "Delivered"/"Envelope completed" ambiguous text matches inside the dialog
(`integrations.spec.ts`'s redrive assertion, and the gallery's own delivery screenshot check) —
both were narrowed to the specific list item, not weakened.

**Verification:** `pnpm typecheck` (web), `pnpm lint`, the full web unit suite (179 tests), the
full `integrations.spec.ts` file (7 tests, twice) and the `integration settings` gallery scenario
on desktop/tablet/mobile all passed. The full desktop-chrome suite (36 files) was run twice; each
run had exactly one unrelated test fail near the end (once in `embed.spec.ts`, once in a different
`integrations.spec.ts` test, both on basic setup steps — an iframe count and a registration page
load — that share no code with this step), and both passed cleanly and quickly when rerun alone.
Given two different tests failed on two different, unrelated, environment-shaped symptoms across
two runs, on a host already noted as heavily loaded during this workstream, these are recorded as
host-load flakes, not a regression from this step.

| Step | Commit |
|---|---|
| 8.1 | 1fd4485 |
| 8.2 | 758696f |
| 8.3 | cec3746 |
| 8.4 | f79aac6 |
| 8.5 | 77e407f |

### Deliberate Simplifications

- `envelope.delivered` still never fires (unchanged from workstream 1; see "The `envelope.delivered`
  Gap" above).
- No event replay by time range; the 7-day delivery history remains the only lookback.
- Ordering between events for the same envelope is not guaranteed; a receiver reconciles by reading
  current status, not by trusting event arrival order.

---

## Workstream 9: Webhook Endpoint Lifecycle Tooling (Accepted)

### In Plain Terms

Today a lost webhook secret can only be recovered by deactivating the endpoint and registering a
new one, which permanently uses up one of the tenant's 5 endpoint slots, since revoked/inactive
endpoints still count against that cap and cannot be deleted. There is also no way to send a test
event to check a receiver is wired correctly, and a receiver that starts failing gets no signal that
it has been silently exhausted every delivery — this workstream adds a test event, secret rotation
with an overlap window, a way to permanently delete an inactive endpoint, and an automatic
deactivation with an email to the tenant's admins after enough consecutive failures.

Finish line:
- [x] An ADMIN/OWNER can send a test event to a registered endpoint without it counting as a real delivery.
- [x] A secret can be rotated with an overlap window during which both the old and new secret verify.
- [x] The 5-endpoint cap counts only active endpoints; an inactive endpoint can be permanently deleted.
- [x] An endpoint that fails enough consecutive real deliveries is automatically deactivated, and
      every human ADMIN/OWNER in the tenant is emailed.

### Technical Detail and Decisions

| Question | Decision |
|---|---|
| Test event | One attempt, no retry, no alert, does not count toward auto-disable or the delivery history's real event data |
| Rotation | New secret returned once; both old and new verify during a configurable overlap (default 24h, 0–72h); the header carries both signatures as `sha256=<new>,sha256=<old>` during the window |
| Cap accounting | Active endpoints only, checked under a tenant advisory lock on create and on reactivation; a separate total-row cap of 20 bounds unbounded inactive accumulation |
| Permanent delete | Only for an inactive endpoint; deletes its deliveries in the same transaction. The released `DELETE /webhooks/:id` (deactivate) is unchanged |
| Auto-disable | A conditional `updateMany` (so only one delivery attempt trips it) at `WEBHOOK_AUTO_DISABLE_THRESHOLD` consecutive real-delivery exhaustions; success resets the counter; reactivating clears the disabled state |
| Notification | Email every human ADMIN/OWNER (never the hidden service-account user); the email names the endpoint's host only, never its full URL or secret |

#### Schema, Configuration and Env Vars

One migration on `WebhookEndpoint`: `previousSecretCiphertext?`, `previousSecretExpiresAt?`,
`secretRotatedAt?`, `consecutiveFailures Int @default(0)`, `disabledAt?`, `disabledReason?`.

New env var `WEBHOOK_AUTO_DISABLE_THRESHOLD` (default 10; `test-env.ts` 2; `apps/web/e2e/stack/stack.mjs` 3),
added to `env.schema.ts` and `.env.example`.

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 9.1 | Migration: rotation and health fields; env var wiring | Migration review; config test | ✅ Built |
| 9.2 | `POST /webhooks/:id/test` (202, one attempt, no alert) | API e2e: delivered/failed test event, does not affect auto-disable counter | ✅ Built |
| 9.3 | `POST /webhooks/:id/rotate-secret` with overlap-window dual signing | Unit tests in `webhook-signature.test.ts`; e2e: both secrets verify in-window, only new one after; secret absent from logs | ✅ Built |
| 9.4 | Active-only cap accounting; `DELETE /webhooks/:id/permanent` | API e2e: cap counts only active, reactivation re-checks cap, delete requires inactive | ✅ Built |
| 9.5 | Auto-disable on repeated exhaustion; admin email via `MailQueueService`/`email.processor.ts`; reactivation clears state | API e2e; `mail.e2e.test.ts` (admins emailed, service account not); `templates.test.ts` | ✅ Built |
| 9.6 | Web: Send test event, Rotate secret, Delete permanently, disabled banner with Reactivate, "n of 5 active" counter | Component/browser tests; gallery | ✅ Built |

#### Implementation record (steps 9.1–9.6, 29 September 2026)

Built as planned, with these specifics worth knowing:

- **Error codes.** Two codes were added beyond the plan's text: `WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED`
  (the 20-row bound) and `WEBHOOK_ENDPOINT_ACTIVE` (permanent delete of an active endpoint). The
  existing five-endpoint code now means five *active* endpoints.
- **Test events** are stored as ordinary `WebhookDelivery` rows with `eventType = webhook.test` and
  a null `envelopeId`, sent as a job with `attempts: 1`; a failure ends as `EXHAUSTED` after one
  attempt. They are excluded from the failure counter, the exhaustion alert and retry (a retry
  returns `WEBHOOK_DELIVERY_NOT_REDRIVABLE`). They work for inactive endpoints, since checking a
  receiver before reactivating it is the point.
- **Rotation** keeps one previous secret. Rotating inside an open window drops the older one. The
  nightly delivery purge clears an expired previous secret's ciphertext. The verifier example in
  the in-app guide now accepts a comma-separated `X-Signature`; without that change a receiver
  copied from the guide would have rejected every request during a rotation.
- **Cap accounting** runs under one per-tenant advisory lock shared by create, reactivate and
  permanent delete, so two simultaneous requests cannot both take the last slot.
- **Auto-disable** increments atomically in the worker, then disables through a conditional
  `updateMany` so exactly one delivery trips it. Recipients are non-service-account OWNER/ADMIN
  users with an accepted invitation, one email job each, keyed by endpoint, person and disable
  time. Manual deactivation sends no email. Only a delivery's first run of attempts counts toward
  the streak: a manual retry that fails again is the same bad event, so it cannot trip the
  threshold by itself.
- **Checks moved.** The admin-email assertions live in `webhook-lifecycle.e2e.test.ts` rather than
  `mail.e2e.test.ts`, next to the behaviour they prove; the template has its own unit test in
  `templates.test.ts`. The browser test simulates the disabled state with SQL (real auto-disable
  needs real envelope traffic and is proven by the API e2e).
- **Migration.** `20260929090000_webhook_endpoint_lifecycle` is additive. `prisma migrate dev`
  asked to reset the dev database because an earlier migration file was edited after being applied,
  so the SQL came from `prisma migrate diff` and was written by hand; nothing was reset.

**Verification (29 September 2026).** `pnpm lint` passed; `pnpm typecheck` showed only the known
`jurisdiction.test.ts` failures; `pnpm test` 479 passed (shared 116, API 177, web 182, embed 4);
API e2e (Node 22.19.0) 37 files, 269 tests passed; desktop-chrome browser e2e 37 passed; the Prisma
drift check reported no difference; the `integration settings` gallery ran on desktop, tablet and
mobile. One earlier full API e2e run failed two tests in `webhooks.e2e.test.ts`'s tenant-wide
delivery browsing block (15s and 10s timeouts waiting on its dedicated worker). Neither file's
code was at fault as far as could be shown: the same two files passed together and the whole suite
then passed on a rerun, so it is recorded as an unexplained load-related timeout, the same block
that timed out under load in workstream 8.

| Step | Commit |
|---|---|
| 9.1 | 59127e4 |
| 9.2 | 16df61a |
| 9.3 | 24ba40d |
| 9.4 | 9a17783 |
| 9.5 | 60eecc4 |
| 9.6 | fe25e60 |

### Deliberate Simplifications

- The auto-disable threshold is a single global config value, not per-tenant configurable.
- No "end the overlap window early" action; a tenant that wants the old secret to stop working
  immediately rotates again with `overlapHours: 0`.
- No bulk retry across many deliveries at once.

---

## Workstream 10: Partner References and Safe Retries (Accepted)

### In Plain Terms

A partner currently has no way to attach its own record identifier to an envelope, so it must keep
its own mapping from `envelopeId` to its record purely by remembering the id returned at creation —
if that response is lost, there is no way to look the envelope back up by the partner's own key.
This workstream adds an optional reference (`externalId`) and small metadata to an envelope, echoes
both in every webhook, and adds an optional `Idempotency-Key` to envelope creation and embedded
session creation so a retried request after a lost response does not create a duplicate.

Finish line:
- [x] An envelope can carry an optional `externalId` and small metadata, set at creation or while a draft.
- [x] The envelope list can be filtered by `externalId`.
- [x] Every webhook for an envelope includes its `externalId` and metadata.
- [x] A retried `POST /envelopes` or `POST /embed/sessions` with the same `Idempotency-Key` and body
      does not create a second envelope or session.

### Technical Detail and Decisions

ADR 0019 governs this workstream.

| Question | Decision |
|---|---|
| `externalId` | Optional, 1–200 characters, restricted charset; not unique (a partner's own system enforces its own uniqueness); fixed once the envelope is sent |
| `metadata` | Optional, at most 10 string-valued keys, 2 KB total; same DRAFT-only mutability as `externalId` |
| Idempotency scope | `POST /envelopes` and `POST /embed/sessions` only; both keys are **optional**, unlike the existing required key on send/extend |
| Idempotency storage | A reference to the created resource, never the raw response body or a launch token, reusing `IdempotencyService` |
| Replayed session request | Reissues a fresh launch token bound to the same `sessionId`, rather than returning a stale, likely-expired token |

#### Schema and Migration

One migration: `Envelope.externalId String? @db.VarChar(200)`, `Envelope.metadata Json?`, index
`(tenantId, externalId)`; `EmbedSession` gains matching reference columns for the upload-mode flow.

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 10.1 | Migration; shared `externalIdSchema`/`envelopeMetadataSchema` | Schema validation tests; migration review | ✅ Built |
| 10.2 | Set on create/draft-PATCH/upload-mode session; list filter; redaction | API e2e across create, draft, list, embed, cross-tenant | ✅ Built |
| 10.3 | Echo `externalId`/`metadata` in every webhook payload | `webhook-events.e2e.test.ts` | ✅ Built |
| 10.4 | Optional `Idempotency-Key` on envelope create and embed session create; session replay reissues a launch token | API e2e: replay, key/body mismatch (422), no-key double-submit still creates two drafts (documented, not a regression), reissued token invalidates the old one | ✅ Built |
| 10.5 | Web: Reference row on envelope detail; guide and docs/08 notes | Component/browser tests | ✅ Built |

#### Implementation record (steps 10.1–10.5, 29 September 2026)

Built as planned, with these specifics worth knowing:

- **Where the fields are accepted.** `externalId` and `metadata` are accepted on the multipart
  `POST /envelopes`, on `PATCH /envelopes/:id` (either may be `null` to clear) and on an
  upload-mode `POST /embed/sessions`; `GET /envelopes?externalId=` filters, including inside the
  Needs-attention view (the raw ranking SQL takes the filter too). `metadata` is JSON text in a
  multipart form and an object elsewhere. Sizes are counted in UTF-8 bytes, without `Buffer`, so
  the same schema runs in the browser.
- **The embedded browser cannot write the reference.** A session's own `externalId`/`metadata`
  (columns on `EmbedSession`, set by the partner's backend) are applied when its upload creates
  the draft. The form on `POST /embed/session/envelope` and `PATCH /envelopes/:id` refuse the
  fields with `EMBED_SCOPE_DENIED` for an embedded bearer. The bearer can *read* them, because the
  envelope detail it loads carries them.
- **Never in the audit trail or logs.** A draft update records only the names of the keys that
  changed (as before); `externalId` and `metadata` are in `logging/redact.ts`'s sensitive keys,
  since a partner's record id can identify a patient. The e2e suite asserts a metadata value
  appears in neither `GET /envelopes/:id/events` nor the captured logs.
- **Webhooks.** Both fields are added in `WebhookQueueService.enqueue` beside the title, read in
  the same lookup, and are required (but nullable) keys in every fired event's data schema, so an
  absent reference is `null`, not a missing key. `envelope.delivered`, never fired, is unchanged.
- **Idempotency.** `IdempotencyService.run()` (required key, whole response stored) behaves as
  before for send and extend. A new `runReferenced()` takes an optional key and stores only a
  reference (an envelope id, a session id) in Redis, rebuilding the response on a replay. A
  present-but-malformed key is refused (`IDEMPOTENCY_KEY_REQUIRED`) rather than ignored. The
  envelope-create scope is the tenant plus the calling key (or user), and the request fingerprint
  includes the PDF's SHA-256. A replayed session request calls `reissueLaunch`, which replaces the
  launch-token hash atomically for the issuing key only, so the old token stops working; a session
  already opened answers `EMBED_LAUNCH_USED`, a revoked one `EMBED_SESSION_INVALID`.
- **Multipart limits** on both upload routes rose from 4 fields / 6 parts to 6 fields / 8 parts
  for the two new text fields.
- **Web.** Envelope detail shows a "Partner reference" group beside the created-by line (id and
  labels, rendered as text) only when either is set. The Settings guide documents the new
  inputs, the optional `Idempotency-Key`, the `externalId` list filter, the two webhook fields and
  the embedded-session behaviour; its troubleshooting line that said upload has no replay
  guarantee is corrected. The guide's webhook payload examples were already missing several
  fields (for example `envelopeTitle`); bringing them fully in line is workstream 13.
- **docs.** As-built notes in docs/05 (schema) and docs/08 (create, webhooks, embed sessions).

**Verification (29 September 2026).** `pnpm lint` passed; `pnpm typecheck` showed only the known
`jurisdiction.test.ts` failures, and the api, web and embed packages typecheck clean on their own;
`pnpm test` 495 passed (shared 127, embed 4, API 177, web 187); API e2e (Node 22.19.0) 39 files,
290 tests passed; desktop-chrome browser e2e 38 passed; the Prisma drift check reported no
difference. The convention review found one blocking lint error (`role="group"` on a `span`,
fixed with a `fieldset`) and one scope issue (the create idempotency scope was tenant-wide; now
per key or user), both fixed, plus missing coverage for the void, decline and expiry events, added.
One browser failure was the new spec's own: its raw SQL update left `updatedAt` alone, so the
detail's ETag answered the reload with a 304 and the stale page; the helper now moves
`updatedAt` as the API would. In the first full browser run,
`integrations.spec.ts › integration dialogs support keyboard navigation and restore focus` failed
once; it passed alone, with its whole file, and in a complete rerun, and nothing this workstream
touched is on its path. Its failure message was not captured, so the cause is unexplained; it is
recorded here as a focus-timing flake under load, not as a proven one.

| Step | Commit |
|---|---|
| 10.1 | f46b209 |
| 10.2 | 9c16f1d |
| 10.3 | 7aa48ab |
| 10.4 | 4d64d43 |
| 10.5 | bf05e5d |


### Deliberate Simplifications

- `externalId` supports only exact-match filtering; metadata values are not searchable.
- Both fields are fixed once an envelope is sent, like every other draft-only field.
- No idempotency on recipient/field mutation routes; only creation gets it, matching how send and
  extend already work.

---

## Workstream 11: API-Key Lifecycle, Downloads and Limits (Accepted)

### In Plain Terms

An API key can create and send an envelope today but cannot cancel it or send a reminder, and there
is no route to fetch the completed PDF or its certificate page without knowing the exact final
version number. This workstream also fixes a pre-existing database deadlock that two rapid actions
on one envelope can trigger, which matters more once partners are calling the API back-to-back.

Finish line:
- [x] A full API key can void an envelope and send a reminder; extend remains session-only.
- [x] `GET /envelopes/:id/documents/{original,completed,certificate}` exist and are read-only-key accessible.
- [x] The pre-existing audit-write deadlock (docs/18, "A Pre-Existing Race") no longer occurs under
      two rapid actions on the same envelope.
- [x] Rate-limit headers reflect the most restrictive limit that actually applied to the request.

### Technical Detail and Decisions

| Question | Decision |
|---|---|
| Deadlock fix | Lock the envelope row first in every audit-writing transaction that currently updates Recipient first (the mail-worker transactions), matching the lock order `cancel.service.ts` already uses, instead of adding transaction-retry logic everywhere |
| Void/remind for keys | `@ApiKeyAllowed({write:true})` added to both; read-only keys get the existing `API_KEY_READ_ONLY` |
| Certificate | Extracted on demand from the sealed final PDF (no separate stored file); a bounded, tenant-rate-limited operation |
| Rate-limit headers | The most restrictive of the limiters that counted the request wins, instead of whichever ran last overwriting the others |

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 11.1 | `fix(api)`: lock the envelope first in mail-worker audit transactions | New `audit-concurrency.e2e.test.ts` reproduces the deadlock first, then proves the fix | ✅ Built |
| 11.2 | `@ApiKeyAllowed` on void and remind | API e2e: read-only 403, service-account actor, `envelope.voided` fires | ✅ Built |
| 11.3 | `GET /envelopes/:id/documents/{original,completed,certificate}`; fix the `/file` 304 `ERR_HTTP_HEADERS_SENT` branch | New `documents.e2e.test.ts`; unit test for certificate extraction | ✅ Built |
| 11.4 | Most-restrictive `X-RateLimit-*` across every limit that counted the request; CORS exposes them. No new per-key limiter (see the record below) | `rate-limit.test.ts`; `rate-limits.e2e.test.ts` | ✅ Built |
| 11.5 | Guide entries; docs/08 As-built notes | Component/browser tests | ✅ Built |

Step 11.1 touches the mail and lifecycle modules, outside the integration surface proper, because
the deadlock it fixes becomes more likely once partners call the API without the pacing a human
using the web app naturally has.

#### Implementation record (steps 11.1–11.5, 29 September 2026)

Built as planned, with these specifics worth knowing:

- **The deadlock, exactly.** The old text of "A Pre-Existing Race" describes the symptom; the cycle is:
  a mail-worker transaction takes the audit trail's per-envelope advisory lock, then its `AuditTrail`
  insert needs a key-share lock on the `Envelope` row (the foreign key). A cancel holds that row
  `FOR UPDATE` and then asks for the advisory lock. Each waits on the other. `audit-concurrency.e2e.test.ts`
  reproduces it deterministically (a plain connection plays the cancel, at the moment the mail
  transport has returned): before the fix the mail job lost and was retried, so the transport was
  called three times instead of once. The fix takes `lockEnvelope` (the same `FOR UPDATE` cancel uses)
  as the first statement of every audit-writing transaction that did not already lock the envelope:
  the `EMAIL_SENT` write in the signing-link mailer, the cancellation notice, the completion email,
  audit export, and, as a precaution, the signer's first view and "request more time". Sending a
  reminder, drafts, legal hold, sign, decline, cancel, extend, expiry, retention and the seal already
  locked or updated the envelope first. The first-view case could not be reproduced: that
  transaction waits earlier, on a `Recipient` row, so its test is a regression guard rather than a
  reproduction.
- **Void and remind for keys.** Only `@ApiKeyAllowed({ write: true })` on the two handlers. The
  acting user is the service account, so the audit actor for a key's cancel is that user. Extend and
  the automatic-reminder settings still answer `API_KEY_NOT_ALLOWED`; both are asserted.
- **Named documents.** `resolveNamed` in `EnvelopesService` maps `original` to version 0, `completed`
  to the final version and `certificate` to the pages the seal added to the version before it
  (final page count minus the previous version's), so no schema change and no stored second file.
  The certificate is cut out with `pdf-lib` (`sealing/certificate-extract.ts`) from a file already
  capped at the upload limit, behind a new 30 a minute per workspace limit (`LIMITS.certificate`).
  Before completion, `completed` and `certificate` answer `409 CONFLICT`. Scope and purge checks
  come before any ETag answer, through one helper shared with `/file`. ETags are the file's
  SHA-256 (plus `-certificate`). Download names are "Name (signed).pdf" and "Name (certificate).pdf".
- **The 304 bug was on two routes.** `res.status(304).end()` with `passthrough` makes Nest send a
  second time, which logged `Unhandled error while processing request` every time. The envelope
  detail route had it as well as `/file`; both now set the status and return. The existing 304 tests
  gained a "no error logged" assertion, and were confirmed to fail before the fix.
- **Headers.** `setRateLimitHeaders` keeps the response's existing `X-RateLimit-*` set when it has
  fewer requests left than the limiter now counting, so the address limit (300), a key's bucket and
  the workspace bucket can run in any order. CORS now exposes the three headers. **Step 11.4 did not
  add per-key rate tracking**, despite the plan text: the guard already counts a per-key bucket
  where a route asks for it (`by: 'tenantKey'`, used by the embed routes), and a per-key counter with
  the same limit as the workspace counter can never refuse a request the workspace counter would
  not. A distinct, lower per-key limit is a product decision the plan does not make.
- **Guide.** The in-app reference now lists 17 operations (the count is computed, not typed), the
  completion step points to `/documents/completed`, and the note that cancellation and reminders need
  a session is corrected. `docs/08` has As-built notes for all of it. Workstream 13 replaces this
  hand-kept list with the catalog.
- **A pre-existing test race, found and fixed while verifying.** `webhooks.e2e.test.ts`'s tenant-wide
  delivery block ran a dedicated worker alongside the file's outer worker on the same Redis queues,
  so each job went to either. The outer worker rejects loopback receivers and holds the mailbox
  `inviteMember` reads, which is why two tests of that block timed out from time to time, and why
  the workstream 8 and 9 records call it an unexplained load timeout. Two of its tests failed in
  the first full run of this workstream and one failed alone; the file passed on clean HEAD and
  failed on this tree, which pointed to the queue split, not load. The outer worker now closes
  before the dedicated one starts and the file uses that one. Five consecutive runs passed.

**Verification (30 September 2026).** `pnpm lint` passed; the api, web and embed packages typecheck
clean on their own (root `pnpm typecheck` still shows only the known `jurisdiction.test.ts` failures,
not touched); `pnpm test` 504 passed (shared 127, embed 4, API 185, web 188); API e2e (Node 22.19.0)
42 files, 303 tests passed; desktop-chrome browser e2e 38 passed. The convention review found one
blocking issue (the browser spec still expected 12 reference entries; it is now 17) and four smaller
ones, all fixed: the reminder-header test now waits for the invitation worker, a member's access to
the named documents is covered (in `roles.e2e.test.ts`, folded into the existing scope test because
a second pair of invites exceeds the invitation limit for that file's workspace), the certificate
extraction test now checks which pages come out and in what order, and "A Pre-Existing Race" carries
an as-built pointer. The first full API run had one failure, `idempotent-create.e2e.test.ts` (a
workstream 10 test): a retry got 422 because `makePdf` stamps the current second into the file, so
two calls straddling a second boundary send different bytes and the request fingerprint, which
includes the PDF's hash, differs. It passed alone three times; the test now builds each PDF once.

### Deliberate Simplifications

- No API-key rename or expiry; rotating a key means creating a new one and revoking the old.
- Audit export and legal hold remain session-only, ADMIN-only routes.
- The certificate is cut out on request, not stored; a partner that needs it often should keep the
  file rather than ask again.
- No `documents/versions/:n` route; a version is read with `/file?version=n`.

---

## Workstream 12: Hosted SDK and Runnable Partner Example (Accepted)

### In Plain Terms

Today `@envelope/embed`'s built output still imports this repository's private, unpublished
`@envelope/shared` package and zod at runtime, so nothing outside this monorepo can actually load
it, and the only complete, working example of a partner integration is test code partners never
see. This workstream makes the SDK load as a plain script tag from a URL this system serves, the
way widely used embedded widgets do, and publishes a runnable, dependency-free example application.

Finish line:
- [ ] `<script src=".../embed/sdk/v1/envelope.js">` works in a plain HTML page, with no build step
      and no access to this repository's other packages.
- [ ] A complete, runnable example partner application exists and is exercised by the browser suite.

### Technical Detail and Decisions

ADR 0020 governs this workstream.

| Question | Decision |
|---|---|
| Distribution | The API serves a versioned, self-contained script at a stable URL; no CDN, no npm publication |
| Runtime dependencies | None — the protocol validation is hand-written in the package, with a parity test against the existing zod schema so the two cannot silently drift |
| Build format | Vite library mode: an ES module and an IIFE global (`EnvelopeEmbed`), plus `.d.ts` declarations |
| Versioning | A major-version path segment (`/sdk/v1/`); no per-patch URLs or subresource integrity in this phase |

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 12.1 | Self-contained SDK: hand-written protocol validator, Vite ESM+IIFE build, `.d.ts` output; `@envelope/shared` moves to devDependencies | Parity test against `embedEventSchema`; existing SDK unit tests | Planned |
| 12.2 | API serves `GET /embed/sdk/v1/envelope.js` and `.mjs` with cross-origin headers, caching and an ETag; 503 if the build is missing in production | New `embed-sdk.e2e.test.ts` | Planned |
| 12.3 | `examples/embedded-partner/`: zero-dependency Node example app; `embed-host.ts` wraps it so e2e exercises the real example | Full browser e2e using the example; gallery | Planned |

### Deliberate Simplifications

- No CDN hosting, npm publication or subresource-integrity hash in this phase; the hosted script is
  the distribution mechanism.
- No Python, PHP, C# or Java SDK; the reference examples are cURL and Node only.

---

## Workstream 13: One Integration Contract, OpenAPI and Developer Guide (Accepted)

### In Plain Terms

Today the same facts — which routes accept an API key, what a webhook payload contains, which error
codes exist — are written out separately in `docs/08`, the in-app guide and the code itself, and
they have already drifted apart in about 15 places. This workstream builds one shared catalog that
the in-app guide, the OpenAPI document and a new repository-hosted developer guide all read from, so
they cannot drift again without a failing test, and it publishes that developer guide as a standalone
markdown document a tenant can hand to a partner who has no login.

Finish line:
- [ ] A single shared catalog lists every API-key-accessible operation, every webhook event and every
      error code; a test fails if a controller's actual API-key allow-list disagrees with it.
- [ ] The served OpenAPI document includes response schemas, an API-key security scheme and the embed
      routes, and a committed snapshot lets it be reviewed without a running server.
- [ ] `docs/developers/` is a complete, standalone guide: quick start, concepts, auth, envelopes,
      webhooks, embedded editor, errors, limits, recipes and a generated reference.
- [ ] The in-app guide's cURL examples run without hand-editing hard-coded IDs.

### Technical Detail and Decisions

ADR 0021 governs this workstream.

| Question | Decision |
|---|---|
| Source of truth | A new `packages/shared/src/integration-contract.ts`: the operations catalog, webhook event reference, header list and error guide |
| Drift prevention | A reflection test compares the catalog's API-key-accessible route list against each controller's actual `@ApiKeyAllowed` metadata; a markdown-table drift test compares generated sections of `docs/developers/*` against the catalog |
| OpenAPI | Adds response schemas, an `apiKey` bearer scheme alongside `session`, embed route tags and webhook payload components; a committed `docs/developers/openapi.json` snapshot, regenerated only with `UPDATE_OPENAPI=1`; still gated by `API_DOCS_ENABLED` in production |
| Developer guide location | `docs/developers/`, a non-numbered folder — docs 00–11 are the specification and 12+ are phase plans; a partner-facing guide is neither and needs to be shareable as its own folder |
| Example correctness | cURL examples carry ids through shell variables extracted with `jq`, not hard-coded UUIDs in the URL |

#### Implementation Steps (One Commit per Step)

| Step | Deliverable | Checks | Status |
|---|---|---|---|
| 13.1 | `integration-contract.ts` and `api-responses.ts`; reflection drift test | `integration-contract.test.ts` | Planned |
| 13.2 | OpenAPI security schemes, response schemas, embed tags, committed snapshot | `openapi.e2e.test.ts` | Planned |
| 13.3 | In-app guide reads from the catalog; `jq`-based examples; self-contained webhook receiver example; generic `EmbeddedEditorGuide`; setup-checklist card | Component and browser tests; gallery | Planned |
| 13.4 | `docs/developers/*` guide with generated, drift-checked sections; As-built notes on docs/03/08/10; root README rewrite; docs index and CHANGELOG | `integration-docs.test.ts` runs in `pnpm test` | Planned |

### Deliberate Simplifications

- Response-schema coverage in OpenAPI targets the routes this catalog documents, not every internal
  route in the API.
- The developer guide is markdown only; no separate hosted documentation site in this phase.

---

## Workstream 14: Release

Planned, separate authorization required. No product version bump, changelog release section or
tag until the user explicitly authorizes a release, following `.claude/skills/release/SKILL.md`.
