# Phase 9: Templates, Bulk Send and Delivery Tracking Plan

| | |
|---|---|
| **Status** | Built on 1 October 2026; not yet released (changelog `[Unreleased]`) |
| **Version** | 1.1.0 |
| **Last updated** | 1 October 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 9 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 9 Is

Phases 1 to 8 built a product that one person can use to send one document at a time, safely. Phase 9
is about sending the same kind of document again and again: a consent form, an intake sheet, a
contract. It has three parts, built in this order:

```
   TEMPLATES ─────► Save a prepared document (the PDF, who signs, where the boxes go) once.
                    Next time, pick the template, type a name and an email, and send.
   BULK SEND ─────► Pick a template, upload a spreadsheet (CSV) with one row per person, check the
                    preview, and send. Every row becomes its own envelope. A bad row never stops
                    the others.
   DELIVERY ──────► Mail goes out through whichever mail provider you choose (Gmail while
   TRACKING         developing, a transactional provider in production). If a provider reports
                    that an email bounced, the sender is told and the envelope shows it.
```

What Phase 9 does not do: edit a template after it is saved, fill in values in the document
(merge fields), schedule a send, or cancel a running batch. Production packaging, monitoring and a
backup runbook stay on the roadmap for a later phase. A release is cut only when you ask.

## What You Can Do at the End of Phase 9

1. **Save an envelope as a template** (Admins). The people become named roles ("Patient",
   "Doctor") and the boxes stay where you put them.
2. **Send from a template** (everyone). Give each role a name and an email, and send.
3. **Send to many people at once.** Upload a CSV, see each row checked before anything is sent, run
   the batch and watch the results: which rows became envelopes and which did not, and why.
4. **Do the same from your own system.** An API key can create from a template and start a batch.
5. **Use any mail provider.** Gmail still works on your own machine; a production provider is
   configuration, not code.
6. **Find out when an email bounced.** The sender gets a notice, the envelope shows the address as
   undeliverable, and the audit trail records it.

## The Phase 9 Finish Line

- [x] An Admin saves an envelope as a template; a Member cannot (403); another workspace cannot see
      it (404).
- [x] Creating from a template gives an envelope with the right recipients, colours, routing order
      and fields, a fresh policy snapshot, a separate stored PDF, and an `ENVELOPE_CREATED` audit
      event naming the template.
- [x] A category blocked after a template was saved is refused when the template is used.
- [x] A 3-row batch with one invalid row creates and sends two envelopes, reports the third with its
      error code, and clears the processed rows' recipient data; a retried job creates no duplicate.
- [x] More than 500 rows, or a batch beyond the hourly limit, is refused with the right codes.
- [x] A bounce event for a known message appends `EMAIL_BOUNCED`, notifies the sender and shows in
      the envelope detail; a wrong secret gets 401 and writes nothing; an unknown message is ignored;
      a repeated event is recorded once.
- [x] API keys: create-from-template and bulk work with a write key, a read-only key cannot write,
      and the integration contract, OpenAPI and developer-guide tests pass.
- [x] No template, batch or delivery row, log line, Redis job or response leaks another workspace's
      data, a signing link, the mail-events secret or an unmasked address.
- [x] Browser: an Admin saves a template, a sender uploads a CSV, sees the preview, runs the batch
      and sees the results (desktop-chrome).

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Name the mail provider you intend to use in production | Step 7 checks that provider's bounce format and message-id behaviour; only `generic` and `postmark` adapters ship, other providers follow | Before step 7 |
| A sample CSV from a real use case (column names, a typical row count) | The CSV layout is fixed by the role names; real data catches awkward cases | Before step 6 |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Templates, bulk send and delivery tracking in one phase, one plan (user, 30 September 2026) |
| Who manages templates | Admins create, rename and archive; every role may create envelopes from an active template (docs/01 line 124) |
| Bulk input | CSV parsed and previewed in the browser; the API takes the same rows as JSON (ADR 0028) |
| API keys | Yes: create-from-template and bulk are API-key routes and join the integration contract (docs/18, ADR 0021) |
| Mail | Provider-neutral: SMTP stays the only transport, Gmail in development and any relay in production by configuration; one neutral delivery-event endpoint (ADR 0029) |
| Template audit | `AuditTrail.envelopeId` is NOT NULL (ADR 0004), so template create, rename and archive are structured logs; the envelope's `ENVELOPE_CREATED` event records `templateId` |
| Editing | Templates are immutable apart from name, description, default message and archive |
| Dependencies | None added. The CSV parser is hand-written in `packages/shared` |

## ADRs Written in This Phase

- [ADR 0027](adr/0027-copy-the-pdf-into-templates-and-refreeze-policy-per-envelope.md) — Copy the PDF into templates, store role slots, and re-freeze policy per envelope
- [ADR 0028](adr/0028-process-bulk-send-as-a-batch-of-independent-envelopes.md) — Process bulk send as a batch of independent envelopes on a queue
- [ADR 0029](adr/0029-receive-delivery-events-through-one-neutral-authenticated-endpoint.md) — Receive delivery events through one neutral, authenticated endpoint
- [ADR 0030](adr/0030-report-role-mismatches-per-row-in-bulk-send.md) — Report role mismatches per row in bulk send (added during the build)

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Shared contracts, errors, limits, migration, tenancy entries, `StorageService.copy`, `MAIL_EVENTS_SECRET` | ✅ Done |
| 2 | Templates API: save from envelope, list, get, rename, archive | ✅ Done |
| 3 | Create one envelope from a template, optionally send it | ✅ Done |
| 4 | Bulk send: batch API, worker job, progress, limit | ✅ Done |
| 5 | Web: Templates page, "Save as template", "Use template" | ✅ Done |
| 6 | Web: bulk send from CSV (shared parser, preview, results) | ✅ Done |
| 7 | Delivery tracking: `MailDelivery`, `/mail-events`, `EMAIL_BOUNCED`, sender notice, envelope detail | ✅ Done |
| 8 | Tests: the finish line | ✅ Done |
| 9 | Documentation; release `v0.10.0` only when asked | ✅ Docs done; release not cut |

Each step is one commit that builds on its own: contracts and schema first, wiring last. Commit
subjects follow AGENTS §9 and name `docs/20 step K` in the body.

### Step 1: Shared contracts, schema and config

- `packages/shared`: new `templates.ts` (template, role slot, create-from-template, bulk request and
  row schemas, batch and row status enums); `limits.ts` (`MAX_BULK_ROWS = 500`,
  `MAX_TEMPLATE_NAME_LENGTH`); `errors.ts` gains `TEMPLATE_NOT_FOUND`, `TEMPLATE_ARCHIVED`,
  `TEMPLATE_ROLE_MISMATCH`, `BULK_TOO_LARGE`, `BULK_BATCH_NOT_FOUND` in `ERROR_CATALOG` and
  `INTEGRATION_ERROR_GUIDE` (or `NON_INTEGRATION_ERROR_CODES` for any code partners cannot meet).
  `RATE_LIMITS` gains `bulkBatch`, matching `LIMITS` in `keyed-rate-limit.guard.ts`.
- Schema (one additive migration, written with `migrate dev --create-only` and reviewed; never
  `migrate reset`): `Template`, `TemplateRole`, `TemplateField`, `BulkBatch`, `BulkBatchRow`,
  `MailDelivery` as listed below. New tables take the default privileges for `digitalsign_app`.
- `TenantPrismaService`: `Template` and `BulkBatch` scoped by `tenantId`; `TemplateRole`,
  `TemplateField` and `BulkBatchRow` scoped through their parent, with the same refusals for `upsert`
  and unique-key writes as the other scoped models.
- `StorageService.copy(fromKey, toKey)` with the S3 and in-memory implementations used by tests.
- New env var `MAIL_EVENTS_SECRET` (optional; when set it must be at least 32 characters and differ
  from every other secret, following the `superRefine` checks): `env.schema.ts`, `.env.example`,
  `apps/api/test/test-env.ts`, `apps/web/e2e/stack/stack.mjs`.
- `truncateAll()` in `apps/api/test/helpers/db.ts` lists the new tables.
- Tests: shared unit tests for the schemas; the migration drift check.

**Schema**

| Model | Fields and indexes |
|---|---|
| `Template` | id, tenantId, name, description, originalFileUrl, originalHash, pageCount, documentCategory, defaultMessage, sequentialSigning, reminderIntervalDays, createdById, archivedAt, createdAt, updatedAt. Index `(tenantId, archivedAt)`; unique name per tenant among non-archived templates (partial unique index) |
| `TemplateRole` | id, templateId, name, role (`RecipientRole`), routingOrder, colorIndex. Unique `(templateId, name)`; `(id, templateId)` unique for the composite key below |
| `TemplateField` | id, templateId, templateRoleId, then the same columns as `DocumentField` (copied from the model when the migration is written). Composite FK `(templateRoleId, templateId)` |
| `BulkBatch` | id, tenantId, templateId, createdById, status (`PROCESSING`, `COMPLETED`), sendOnCreate, totalRows, succeededRows, failedRows, createdAt, finishedAt. Index `(tenantId, createdAt)` |
| `BulkBatchRow` | id, batchId, rowIndex, status (`PENDING`, `SUCCEEDED`, `FAILED`), recipients (JSON, null once used), externalId, envelopeId (nullable), errorCode (nullable). Unique `(batchId, rowIndex)` |
| `MailDelivery` | id, envelopeId, recipientId (nullable), messageId (unique), template, status (`SENT`, `BOUNCED`, `COMPLAINED`), updatedAt. Index `envelopeId` |

### Step 2: Templates API

- New `templates` module (`TemplatesController`, `TemplatesService`) following the `drafts` and
  `compliance/legal-hold.controller.ts` patterns.
- `POST /templates` (`@Roles('ADMIN')`, `@ApiKeyAllowed({ write: true })`): body
  `{envelopeId, name, description?}`. Loads the envelope through `TenantPrismaService` and
  `assertCanManage`, requires at least one recipient and one field, copies version 0 of the PDF to the
  template's own key (`StorageService.copy`), turns each recipient into a `TemplateRole` (keeping name,
  role, routing order and colour as the slot's label; the person's email and personal name are not
  copied), and each field into a `TemplateField`. One transaction; the copied object is deleted if it
  fails.
- `GET /templates`, `GET /templates/:id` (all roles, read API keys): active templates; `?archived=true`
  for Admins.
- `PATCH /templates/:id` (`@Roles('ADMIN')`, write key): name, description, default message,
  `archived`.
- Logs: `Template created`, `Template renamed`, `Template archived`, `Template restored`, each with
  `tenantId`, `templateId` and the actor; never a recipient's email.
- Tests: `apps/api/test/templates.e2e.test.ts` (Admin save, Member 403, cross-tenant 404, archive,
  duplicate name, role mapping) and additions to `cross-tenant.e2e.test.ts` and `roles.e2e.test.ts`.

### Step 3: Create one envelope from a template

- `POST /templates/:id/envelopes` (all roles, `@ApiKeyAllowed({ write: true })`,
  `@RateLimit(LIMITS.createAndSend)`, `IdempotencyService.runReferenced`): body
  `{recipients:[{role, name, email}], message?, externalId?, metadata?, send?}`.
- `TemplatesService.instantiate(tx?, ...)` is the one code path used here and by the bulk worker. In
  order, mirroring `EnvelopesService.create`: resolve jurisdiction (`jurisdiction.resolveForTenant`),
  `assertCategoryAllowed` with the template's category, copy the PDF to a new envelope key, then one
  transaction that creates the envelope with a fresh `policySnapshot`, `DocumentVersion` 0, the
  recipients (new colours via `lowestUnusedColor`), the fields (new UUIDs) and `ENVELOPE_CREATED` with
  `templateId` in its metadata. The copied object is deleted if the transaction fails.
- Recipients must match the template's role slots exactly (`TEMPLATE_ROLE_MISMATCH`); an archived
  template gives `TEMPLATE_ARCHIVED`.
- With `send: true` it then calls `SendingService.send` after the create commits (mail and webhooks
  enqueue after commit, as today).
- Integration contract: a new entry in `INTEGRATION_OPERATIONS` for each API-key route, OpenAPI and
  `docs/developers/` regenerated; `integration-contract.test.ts` and `integration-docs.test.ts`
  updated together. docs/08 gets "As built" notes and its stale "Sprint 3–4" lines (900–901) are
  corrected beside them.
- Logs: `Envelope created from template` with `envelopeId`, `templateId`; existing send logs unchanged.
- Tests: `templates.e2e.test.ts` (fields, colours, routing, separate PDF key, fresh snapshot, blocked
  category, archived, role mismatch, write versus read key, idempotent retry); wait on
  `linkFor(worker.mailbox, email)` before any second audit-writing action on the same envelope.

### Step 4: Bulk send

- `POST /templates/:id/bulk` (all roles, write key, new `@RateLimit(LIMITS.bulkBatch)`): body
  `{rows:[{recipients, externalId?, metadata?}], message?, send}`. Validates the whole request first
  (`BULK_TOO_LARGE` over 500 rows; each row is checked against the role slots, with errors listed by
  row index), stores the batch and rows in one transaction and returns `202 {batchId}`. A request that
  fails validation stores nothing.
- New `bulk` queue registered in `queue.module.ts`, one job per batch carrying the batch id, enqueued
  after the commit. A `BulkProcessor` in the worker (`src/worker.ts`) processes pending rows in order
  through `TemplatesService.instantiate` and, when `sendOnCreate`, `SendingService.send`. The row's
  `envelopeId` is written in the same transaction that creates the envelope; success sets `SUCCEEDED`
  and nulls `recipients`; a failure sets `FAILED` and the error code. The batch completes with counts.
  A retried job skips finished rows and sends the still-`DRAFT` envelope of a `PENDING` row.
- `GET /bulk-batches` and `GET /bulk-batches/:id` (creator or Admin via `ownerScopeOf`, read key):
  counts and per-row outcome (row index, envelope id or error code), never a recipient email.
- The expired-session purge job also nulls `recipients` on failed rows of batches older than 30 days.
- Logs: `Bulk batch accepted`, `Bulk row succeeded`, `Bulk row failed` (with code), `Bulk batch
  completed` (with counts).
- Tests: `apps/api/test/bulk-send.e2e.test.ts` (3 rows with one bad, partial success, data cleared,
  retry without duplicates, over the row cap, hourly limit, Member sees only their batches,
  cross-tenant 404, write versus read key); clear the `bulk` queue in `beforeAll`.

### Step 5: Web, templates

- `TemplatesPage` (Settings-style page reachable from the dashboard `[Templates]` button sketched in
  docs/09): list, archive and rename for Admins, "Use template" for everyone. Route in `SenderApp.tsx`;
  entry in `SettingsNav.tsx` only if it is Settings-shaped, otherwise a dashboard link.
- "Save as template" action on `PreparePage.tsx` and the review page, Admin only.
- "Use template" dialog: one row per role (name, email), a message, "Send now" versus "Save as draft".
  Add client functions to `lib/api.ts` and keys to `lib/query-keys.ts`.
- UI copy is load-bearing (AGENTS §6): new labels only; search `apps/web/e2e` before touching any
  existing text.
- Tests: component tests beside the code, a desktop-chrome spec `templates.spec.ts`.

### Step 6: Web, bulk send from CSV

- `packages/shared/src/bulk-csv.ts`: a hand-written RFC 4180 parser and `validateBulkRows` (columns are
  `<Role> name`, `<Role> email`, optional `externalId`); quoted fields, embedded commas and newlines,
  BOM, a hard cap of 500 rows and of file size. Unit-tested, including the parity test that the browser
  and the API accept and reject the same rows.
- "Send to many" page: choose a template, download a header-only CSV for it, upload, see a preview table
  with per-row errors (nothing is sent while any row is invalid unless the sender drops those rows),
  confirm, then a results view that polls `GET /bulk-batches/:id`.
- Tests: `bulk-csv.test.ts`, a desktop-chrome spec `bulk-send.spec.ts`; the mobile project is not
  needed for this sender-side screen.

### Step 7: Delivery tracking

- First, per provider named by the user, check against its documentation whether it echoes the
  `Message-ID` we send; record the result in this section. An adapter whose provider cannot echo it is
  not shipped.
- `MailTransportService.send` (`mail/mail-transport.service.ts`) gains an optional delivery context
  (`envelopeId`, `recipientId`); when present it writes a `MailDelivery` row with the message id after a
  successful send. Mailers that belong to an envelope pass it (`signing-link.mailer.ts`,
  `lifecycle.mailer.ts`, `download-renew.mailer.ts`, the completion mailer); account mails do not.
- `MailEventsController`: `POST /mail-events/:adapter`, `@Public()`, `@RateLimit` by address. A pure
  `mail-event-adapters.ts` maps `generic` and `postmark` payloads to `{messageId, type, reason?,
  occurredAt}`. Secret from `Authorization` (bearer or basic), compared with `timingSafeEqual`; 404 when
  `MAIL_EVENTS_SECRET` is unset, 401 when wrong. For a known message id, one transaction updates
  `MailDelivery.status`, calls `audit.record(tx, {action: 'EMAIL_BOUNCED' | 'EMAIL_COMPLAINED'})`, and a
  repeated event for the same id and type is a no-op. After the commit the sender gets a notice through
  `sender-notice.mailer.ts`. An unknown id is logged at debug and answered 202.
- `AuditAction` gains the two actions (`audit/audit.service.ts`); the envelope detail response gains a
  per-recipient `emailStatus`, and the web envelope detail shows an "Email undeliverable" badge.
- Docs: a provider runbook in `docs/` (SMTP settings for Gmail locally and for a transactional
  provider, the webhook URL and secret, how to read `EMAIL_BOUNCED`).
- Logs: `Mail delivery bounced` / `Mail delivery complained` with `envelopeId` and `maskEmail`; never
  the secret, the body or a link.
- Tests: `apps/api/test/mail-events.e2e.test.ts` against the real app with the memory transport (known
  id, unknown id, wrong secret, repeated event, secret never logged); unit tests for each adapter and
  the secret comparison.

### Step 8: Tests, the finish line

Every finish-line item above maps to a named test in steps 2 to 7; this step adds what crosses them:
`cross-tenant.e2e.test.ts` and `roles.e2e.test.ts` extensions for every new route, the `openapi` and
integration-contract suites, a log-redaction test for the new log lines, and the browser specs.

### Step 9: Documentation and release

`CHANGELOG.md` `[Unreleased]`, `docs/README.md` status row, docs/08 "As built" notes, this plan's
steps table and commit references, the developers' guide recipes for templates and bulk. A release
(`v0.10.0`) follows `.claude/skills/release/SKILL.md` only when the user asks; nothing is pushed or
tagged otherwise.

## As Built

Built as planned, with these differences and findings:

- **Row validation in bulk send is split in two.** The plan (and ADR 0028 as first written) refused a whole
  batch if any row's people did not match the template's roles, and also promised that a batch with one bad row
  would create the good ones. Those cannot both hold. As built: a malformed row (a bad email, a missing name)
  refuses the request with `VALIDATION_FAILED` and stores nothing; a row that does not match the template's
  roles is accepted and reported `FAILED` with `TEMPLATE_ROLE_MISMATCH` by the worker. [ADR 0030](adr/0030-report-role-mismatches-per-row-in-bulk-send.md) records
  this and supersedes item 1 of ADR 0028.
- **A second migration.** `20260930160000_bulk_batch_client` adds `BulkBatch.clientIp` and
  `clientUserAgent`, so the audit events the worker writes for a batch carry the requester's address and
  browser, not the worker's. `Template.originalSizeBytes` (needed for the copied `DocumentVersion`) was added
  to the first migration before it was committed. No other schema differences.
- **`truncateAll()` needed no change**: it truncates `Tenant ... CASCADE`, which reaches every new table.
- **Two services, not one.** `TemplatesService` holds list, get, save, update and `instantiate` (creation);
  `TemplateEnvelopesService` adds the send and the envelope detail for the API. The worker provides
  `TemplatesService`, `JurisdictionService` and `SendingService` itself (`BulkWorkerModule`) rather than
  importing `TemplatesModule`, which would pull the API's controllers and upload pipeline into it. Each bulk
  row runs inside `ClsService.run` with the batch's tenant, because the tenant-scoped client reads the
  tenant from the request context and a job has none.
- **What the trail records.** A created-from-template envelope gets the same events as one built by hand
  (`ENVELOPE_CREATED` naming the `templateId`, one `RECIPIENT_ADDED` per person without name or email, and
  `FIELDS_SAVED`). `RECIPIENT_ADDED` and `FIELDS_SAVED` also carry the template's ids.
- **Who can save.** API keys act as an Admin, so a full-access key can save templates; a read-only key cannot
  (`API_KEY_READ_ONLY`). Saving, renaming and archiving are structured logs, as planned.
- **Other differences from the plan text.**
  - "Save as template" is on a document's own page (envelope detail), not on the prepare and review
    screens.
  - A sixth error code, `TEMPLATE_NAME_TAKEN`, was needed for the unique-name rule.
  - `/mail-events` is limited per address with the existing `@Throttle` pattern for public routes (600 a
    minute), not `@RateLimit`.
  - `MailDelivery` is scoped through its envelope in `TenantPrismaService`; the bounce endpoint and the mail
    worker have no tenant and use `PrismaService`.
  - Only a message still marked `SENT` can be claimed by a bounce or complaint, so a repeat, and a complaint
    after a bounce, record nothing: the first problem wins.
- **Defaults.** `send` defaults to `false` on both the single and the bulk route, so an integration that
  forgets it gets drafts, not sent documents.
- **Rate limit.** `bulkBatch` is 10 an hour; the generated limits table now says "per hour" where a window is
  an hour. Rejected requests count against it too, as for every other limit, so tests that start many
  batches use a workspace each.
- **Delivery tracking.**
  - Mail to someone on an envelope is tracked for: signing links and reminders, the cancellation notice, the
    recipient's finished copy, and a renewed download link. Everything else is not.
  - The Message-ID is ours (`<uuid@from-domain>`), also sent as `X-Envelope-Ref` and Postmark's
    `X-PM-Metadata-envelope-ref`; the `postmark` adapter reads it from `Metadata["envelope-ref"]`.
  - The provider's own explanation of a bounce is deliberately not stored or logged: it usually repeats the
    address.
  - The sender's notice is a new job, `delivery-failed`, skipped once the envelope is closed.
  - **Not verified against a live provider.** The per-provider check the plan put at the start of step 7 could
    not be run here, because no provider account or network exists in this environment and none was named. The
    runbook ([operations/mail-delivery](operations/mail-delivery.md)) says what to confirm on first use. This
    is the main open item before a release.
- **A test-database slip.** Step 1's migration was edited once after the test database had applied it, so the
  test database got a one-off `ALTER TABLE "Template" ADD COLUMN "originalSizeBytes"` by hand. A fresh
  database built from the migrations is correct, and the drift check is clean. Only the local test database's
  stored checksum for that migration differs.
- **Web.** Templates page, "Save as template" (on a document's page, Admins only), "Use template",
  "Send to many" (CSV), a results page and a batch list. `parseBulkCsv` lives in `packages/shared`, so the
  browser and the API judge rows by one implementation (a parity test checks it).

## Deliberate Simplifications

- Templates are immutable: no layout editing and no versions. Replace by saving a new template and
  archiving the old one.
- No merge fields, prefilled values or conditional fields; a template fixes where boxes go, not what
  they say.
- Bulk is one template per batch, one CSV layout, at most 500 rows, no scheduling and no cancel. Failed
  rows are fixed and sent as a new batch.
- Only the `generic` and `postmark` adapters ship. SES (through SNS) needs its own adapter later.
- Only bounces and complaints are recorded: no delivered, opened or clicked events, no suppression list,
  no webhook event for partners (additive later, ADR 0018).
- A row that fails on an unexpected error (a storage or database fault) is marked `FAILED` with
  `INTERNAL_ERROR` and not retried; the job's own retries only help when the whole run fails.
- A batch whose job is lost (Redis emptied) stays `PROCESSING`; there is no sweeper for it yet, and the
  30-day purge only clears finished batches.
- A template's PDF is not rescanned when copied (ADR 0026).
- Still open from Phase 8: CAPTCHA, passkeys and "remember this device", rescanning files accepted
  during a scanner outage, email change and a password-strength check.

## Verification

Commands use the nvm PATH from AGENTS §4:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- API e2e on Node 22.19.0: `templates`, `bulk-send`, `mail-events`, `cross-tenant`, `roles`,
  `openapi` and the integration-contract suites.
- Browser e2e on `desktop-chrome` (the web app and `stack.mjs` change).
- Migration drift check.

Tests use the memory mail transport, the test database and Redis db 1, never the dev server, and never
the internet. Bounce tests post to the test app. Clear the `bulk` queue in `beforeAll`; wait on
`linkFor(worker.mailbox, email)` before a second audit-writing action on the same envelope (docs/18,
"A Pre-Existing Race").

### Results (1 October 2026, final tree)

| Check | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean, all four packages |
| `pnpm test` | shared 178, api 266, web 227, embed 41: all pass |
| API e2e (Node 22.19.0) | 58 files, 440 tests: all pass |
| Browser e2e, `desktop-chrome` | 49 tests: all pass on the final run |
| Each step on its own | typecheck, lint and unit tests pass on every step's tree, in a scratch worktree |
| Migration drift check | no difference |

Not run: the `mobile-iphone14` browser project (it covers the signing page, which this phase does not touch; CI
runs it), and anything against a live mail provider (see "As Built").

Two browser failures on the first full run, both looked into:

- `integrations.spec.ts` counted 17 operations in the in-app API reference; the guide now lists 25, because
  templates and bulk send add eight. The expected number was updated. Nothing was weakened.
- `expiry.spec.ts` ("an expired document ... it completes") timed out waiting for "Completed and sealed" after
  30 seconds, once, in the middle of the full suite. It passed alone, with the specs that run before it, and in
  two further full runs. The Postgres log shows no deadlock for the period. The stack's own logs for that run
  were replaced when the next run started the stack afresh, so its cause was not captured. Treated as an
  unexplained timing failure under load, not as a fix: if it recurs, run the suite with the stack's `logs`
  folder kept (copy `apps/web/.e2e/logs` before the next run).

