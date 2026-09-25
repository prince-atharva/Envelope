# Phase 6b (Foundation): API Keys and Webhooks Plan

| | |
|---|---|
| **Status** | Built (commits `bb12153`–`4353f01`); not yet released |
| **Version** | 1.0.0 |
| **Last updated** | 25 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 6b's foundation slice deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What This Phase Is

`docs/README.md` and `docs/17` both flagged the same gap: "the HealthProHub integration (embed SDK,
API keys, dual-mode SaaS) is Phase 6b... it still has no documents in this folder — it needs its own
design pass before it is built." This document is that design pass, scoped to a deliberately smaller
slice than the full list:

```
   BUILT NOW ──────────► API keys (server-to-server auth) and webhooks (event notifications), so
                          HealthProHub — the first integration partner — can create and send
                          envelopes programmatically, and learn about status changes without
                          polling.
   NOT BUILT YET ──────► An embed SDK or iframe signing UI, delegation, in-person signing, and
                          self-serve multi-partner onboarding. These stay separate, later phases.
   SIGNING UNCHANGED ──► A signer always finishes on Envelope's own hosted web app, reached by the
                          emailed link. This is intentional: every signer sees Envelope's own
                          branding and becomes a visit to Envelope's own site. The API and webhooks
                          cover envelope creation, sending and status only, never the sign step.
```

## What You Can Do at the End of This Phase

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

## The Phase 6b (Foundation) Finish Line

- [x] An API key authenticates envelope create, draft edit and send routes; a read-only key is
      refused on any of them that writes.
- [x] Every route not explicitly allow-listed refuses an API key, even though a key's scope is
      nominally "whole tenant" — closed by default.
- [x] A webhook fires for 8 of the 9 documented events, signed exactly as docs/08 specifies, with
      6 retries over roughly 15 hours and a 7-day redrive window.
- [x] `envelope.delivered` is reserved but never fired, with a written reason (below).
- [x] A webhook endpoint URL must be `https://` and resolve to a public address, checked at
      registration and again at delivery.
- [x] `docs/08` and this document updated; ADR 0015 written.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| HealthProHub's actual integration requirements (which routes they call, what their receiver expects) | This phase built a generic mechanism against the documented spec; it has not yet been validated against a real partner integration | Before HealthProHub goes live |
| A decision on the embed SDK's shape (iframe? JS widget? none — headless only, as this phase assumes) | Out of scope here; the "signing stays on Envelope's own site" decision above assumes headless is the long-term answer, not just this phase's shortcut | Before Phase 6c |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | API keys and webhooks only. Embed SDK, delegation, in-person signing and self-serve multi-partner onboarding move to a later phase |
| Who is the first partner | HealthProHub, but the mechanism underneath is generic — not hardcoded to one tenant |
| Where an API key's writes land | A per-tenant hidden `isServiceAccount` User, `role: ADMIN` (ADR 0015) — not tied to any one human |
| Webhook secret storage | Encrypted (AES-256-GCM), not hashed — delivery must recover the raw secret to sign each request (ADR 0015) |
| `envelope.delivered` | Reserved in the event-type union, never fired — see "The `envelope.delivered` Gap" below |
| Route allow-listing | Closed by default via `@ApiKeyAllowed()`; only envelope create/upload, draft edits, send, and reads are open to a key this phase |

## ADRs Written in This Phase

- [ADR 0015](adr/0015-api-keys-and-webhook-secrets-use-different-storage.md) — API keys and webhook
  secrets use different storage

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Shared contracts, schema, config, ADR 0015 | ✅ Done |
| 2 | API keys end to end: service, guard, controller, route allow-listing | ✅ Done |
| 3 | Webhook subscription management: secret cipher, URL/SSRF guard, CRUD | ✅ Done |
| 4 | Delivery pipeline: queue, producer, worker processor, signing, redrive | ✅ Done |
| 5 | Wiring the 8 real hook points into the envelope lifecycle | ✅ Done |
| 6 | The 7-day purge job; this document | ✅ Done |

## Step 1: Shared Contracts, Schema, Config

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

## Step 2: API Keys

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

## Step 3: Webhook Subscription Management

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

## Step 4: Delivery Pipeline

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

## Step 5: Wiring the 8 Real Hook Points

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

## Step 6: The 7-Day Purge

`maintenance/webhook-delivery-purge.service.ts`, registered in `MaintenanceScheduler` /
`MaintenanceProcessor` exactly like every other scheduled job (`WEBHOOK_DELIVERY_PURGE_CRON`,
default `30 3 * * *`). Deletes every `WebhookDelivery` row past 7 days, regardless of status: unlike
`AuditTrail` (ADR 0004), a delivery row is operational, not evidence, so there is no reason to keep
a successful delivery's row any longer than a failed one's.

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

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` (unit: `webhook-url-guard.test.ts`,
  `webhook-secret-cipher.test.ts`, `webhook-signature.test.ts`).
- e2e: `api-keys.e2e.test.ts` (issuance, scope, revocation, read-only enforcement, role floor),
  `webhooks.e2e.test.ts` (CRUD, URL rejection, endpoint cap, deactivation), `webhook-delivery.e2e.test.ts`
  (a real local HTTP receiver: signature verification, retry-then-success, exhaustion, redrive,
  unsubscribed events never delivered), `webhook-events.e2e.test.ts` (all 8 real hook points fire
  through an actual envelope lifecycle, with the right payload), `webhook-delivery-purge.e2e.test.ts`.
- Manual: register a local receiver, send a real envelope through the dev stack, confirm signature
  verification passes and events arrive in order as the envelope moves through its lifecycle.
