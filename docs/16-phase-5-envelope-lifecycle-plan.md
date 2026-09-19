# Phase 5: Envelope Lifecycle Plan

| | |
|---|---|
| **Status** | In progress |
| **Version** | 0.1.0 |
| **Last updated** | 19 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 5 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 5 Is

Doc 11's last block, weeks 9–10, is **Hardening: ready for customers**. It lists 18 items, about three
phases of work, so it is split in three:

| Phase | What it covers |
|---|---|
| **5, Envelope Lifecycle** (this doc) | Everything that happens to a document after it is sent and before it is finished |
| 6, Compliance and Integrations | Jurisdiction rules and blocked document types, retention and legal hold, audit export, user roles, API keys and webhooks, delegation, in-person signing |
| 7, Launch Readiness | Production hosting, security headers, virus scanning, database row security, accessibility, monitoring, backups, load testing, runbooks, the security checklist |

After Phase 4 a document can be sent, signed and sealed. What a sender still cannot do is manage it
along the way:

```
   CANCEL ──────────► stop a document; every signing link dies at once
   DEADLINES ───────► an overdue document pauses; the sender can give more time
   REMINDERS ───────► people are reminded automatically, and warned before the deadline
   DASHBOARD ───────► "what should I chase today?" at a glance
   SAFETY ──────────► request limits shared by every server; a nightly check of the audit trail,
                      with an email to you if anything is wrong
```

## What You Can Do at the End of Phase 5

1. **Cancel** a document you sent, with a reason. The links in everyone's email stop working at once,
   and everyone who was emailed is told. An unsent draft can be discarded.
2. **Deadlines.** When a deadline passes with signatures missing, the document shows as
   **Expired** and you get an email. You can **extend** it, and the people still to sign get a new
   link, or cancel it. Nobody who already signed has to sign again.
3. A signer who opens an expired link can tap **Ask the sender for more time**. You get an email.
4. **Automatic reminders**, every 3 days by default, only to the person whose turn it is, and never
   while they have the document open. Two days before the deadline they get one "expires soon"
   email. You can change the interval or turn it off when sending, or later.
5. The **dashboard** opens on **Needs attention**: expired documents first, then people who have not
   opened their email for two days, then documents about to expire. Each row shows "2 of 3 signed"
   and has a Remind button.
6. If the audit trail is ever found altered, or a document fails to seal, an **email goes to the
   address you choose**.

## The Phase 5 Finish Line

- [ ] A cancelled document's links are refused on the very next request, and everyone already
      emailed is told.
- [ ] An overdue document becomes Expired within 5 minutes and the sender is emailed. Extending it
      resumes signing with fresh links, and signatures made before the deadline are kept.
- [ ] A signer on an expired link can ask for more time.
- [ ] Reminders go out on schedule, only to the person whose turn it is, and never while they have
      the document open. "Expires soon" is sent once.
- [ ] Needs attention lists what to chase, longest-waiting first.
- [ ] Request limits hold across two API servers, and still apply if Redis is down.
- [ ] An altered audit trail produces exactly one alert email, and every change of status writes
      exactly one audit event, in the same transaction.
- [ ] No signing link appears in any log, table, Redis key or email we did not mean it to.

## Progress

| # | Step | Status |
|---|---|---|
| 0 | This plan, ADR 0013 (expiry pauses an envelope) and ADR 0004 (the audit hash chain) | ✅ Done |
| 1 | One definition of "open" and "closed" statuses | ✅ Done |
| 2 | Lock the envelope before signing, declining, sending a link or sealing commits | ✅ Done |
| 3 | Database: Expired status, cancel and reminder columns | ✅ Done |
| 4 | Cancel and discard (API and emails) | ✅ Done |
| 5 | Cancel and discard (screens) | ✅ Done |
| 6 | The maintenance queue and the expiry sweep | ✅ Done |
| 7 | Extend and resume | ✅ Done |
| 8 | Ask for more time | ⬜ |
| 9 | Extend and expiry on the envelope page | ⬜ |
| 10 | Automatic reminders and the "expires soon" email | ⬜ |
| 11 | Alert emails | ⬜ |
| 12 | The nightly audit-chain check | ⬜ |
| 13 | Request limits in Redis, on every route | ⬜ |
| 14 | Dashboard views | ⬜ |
| 15 | Tests: the finish line | ⬜ |
| 16 | Documentation and release `v0.5.0` | ⬜ |

## What We Need From You

| Needed | Why | When |
|---|---|---|
| An address for alert emails (`ALERT_EMAIL`) | Where urgent problems are sent | Step 11 |
| The WebKit libraries and the real-phone check (doc 15, step 10) | Releases `v0.3.0` and `v0.4.0` wait on them | Now |
| Logo and colours, the lawyer's consent wording, the 7-year retention confirmation | Still placeholders from earlier phases | Before real use |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Order of the hardening work | Lifecycle (5), then compliance and integrations (6), then launch readiness (7) |
| What a passed deadline does | **Pauses** the envelope as `EXPIRED`. The sender can extend it or cancel it (ADR 0013). |
| Automatic reminders | **On by default, every 3 days** (`AUTO_REMINDER_DEFAULT_DAYS`), plus one "expires soon" email 48 hours before the deadline. Per envelope in `reminderIntervalDays`; null is off. |
| Urgent alerts | Always logged with `alert: true`; also emailed to `ALERT_EMAIL` through the existing SMTP when it is set |
| Who may cancel | Any user of the tenant. Doc 03 says "sender or admin"; roles are not enforced anywhere yet and arrive in Phase 6. |
| Renewing an expired large-file download link | Deferred to Phase 6. Such a link still answers 410 JSON. |

## ADRs Written in This Phase

| ADR | Decision |
|---|---|
| [0013](adr/0013-expiry-pauses-an-envelope.md) | `EXPIRED` pauses an envelope; extend resumes it; an expired envelope is not stamped; a link's expiry moves with an extension (amends ADR 0009) |
| [0004](adr/0004-hash-chain-the-audit-trail.md) | The audit hash chain, reserved since doc 05 and written now that the nightly check exists |

## The State Machine After Phase 5

```
   DRAFT ──send──► SENT ──first signature──► PARTIALLY_SIGNED ──last seal──► COMPLETED
     │               │  ▲                         │  ▲
     │ discard       │  │ extend                  │  │ extend
     ▼               ▼  │                         ▼  │
   VOIDED ◄─cancel─ EXPIRED ◄──────── sweep ──────────┘
     ▲
     └──── cancel ── SENT, PARTIALLY_SIGNED       DECLINED ◄── decline (any open state)
```

| From | To | Trigger | Audit event |
|---|---|---|---|
| `DRAFT` | `VOIDED` | Discard (reason optional, no emails) | `ENVELOPE_VOIDED` |
| `SENT`, `PARTIALLY_SIGNED`, `EXPIRED` | `VOIDED` | Cancel, with a reason | `ENVELOPE_VOIDED` |
| `SENT`, `PARTIALLY_SIGNED` | `EXPIRED` | Sweep: past `expiresAt` and someone who must sign has not | `ENVELOPE_EXPIRED` |
| `EXPIRED` | `SENT` or `PARTIALLY_SIGNED` | Extend (`PARTIALLY_SIGNED` if anyone has signed) | `ENVELOPE_EXTENDED` |
| `SENT`, `PARTIALLY_SIGNED` | same | Extend before the deadline | `ENVELOPE_EXTENDED` |

`EXPIRED` is not terminal and is not open: nobody can sign, and a reminder is refused with
`ENVELOPE_EXPIRED` (409), which tells the screen to offer Extend. Decline is not possible from
`EXPIRED`, because an expired link is refused before it.

## Problems Found While Planning

Checking the design against the code turned up these, all fixed in this phase:

| Problem | Effect | Fixed in |
|---|---|---|
| Submit, decline, consent, adopt and the mailer check the envelope only through a relation filter in `updateMany`, which takes no lock on the envelope row | A cancel committing at the same moment as a signature can leave a signed recipient on a cancelled envelope, with `RECIPIENT_SIGNED` after `ENVELOPE_VOIDED` | Step 2: `lockOpenEnvelope` (row lock, deadline checked at commit) first in each |
| `sealFinal` sets `COMPLETED` without checking the status again, after up to 120 s of storage work | A cancel during sealing is overwritten, and a `VOIDED` envelope becomes `COMPLETED` | Step 2: re-check under `FOR UPDATE` just before the version insert |
| The invitation job id is `invitation-{recipientId}`, and finished jobs stay in Redis for 24 hours | A person whose invitation was skipped cannot be invited again for a day | Step 2: the id includes `invitedAt` |
| Remind checks only the status, not the deadline | On an overdue envelope it answers 200, writes `REMINDER_REQUESTED`, starts the 24-hour wait, and the worker sends nothing | Step 6: 409 `ENVELOPE_EXPIRED` |
| `SigningRateLimitGuard` divides `timeToExpire`, already in seconds, by 1000 | `Retry-After` is always 1 second | Step 13 |
| `GET /v1/envelopes?status=` is refused with 400 (strict query schema) | Doc 08's filter does not work | Step 14 |

## Step 1: One Definition of Open and Closed

`OPEN_ENVELOPE_STATUSES` (`SENT`, `DELIVERED`, `PARTIALLY_SIGNED`) and `TERMINAL_ENVELOPE_STATUSES`
(`COMPLETED`, `DECLINED`, `VOIDED`) move to `packages/shared/src/envelopes.ts`, with
`isOpenEnvelope()`. They replace the local copies in the token guardian, sending, signing, the
signing-link mailer, sealing, and the web app's progress helpers and envelope page. Nothing changes
in behaviour; adding `EXPIRED` in step 3 then happens in one place.

## Step 2: Envelope Row Locks

`apps/api/src/prisma/envelope-locks.ts`:

- `lockOpenEnvelope(tx, envelopeId, now)`:
  `SELECT id FROM "Envelope" WHERE id = $1 AND status IN (open) AND "expiresAt" > $2 FOR NO KEY UPDATE`.
  It returns false when there is no row. **As built:** `FOR NO KEY UPDATE`, not the `FOR SHARE`
  first planned. Submit and decline go on to update the envelope, and two share-lock holders
  upgrading at once deadlock; two signers of one envelope now commit one after the other, as the
  audit trail's per-envelope lock already made them. `now` is converted to UTC in the query, because
  Prisma stores UTC in columns without a zone. Postgres checks the condition again once the lock is
  granted, so whichever of a signature and a cancel commits first wins, cleanly. It also enforces the
  deadline at commit time, not only when the link was checked.
- `lockEnvelope(tx, envelopeId)`: `FOR UPDATE`, returning the status. Used by cancel, the sweep and
  extend, which then check the status in code.

Used first in consent, adopt, submit and decline, and in the mailer's claim before a link is minted. The
seal round and `sealFinal` take `FOR UPDATE` just before inserting the version and return idle if
the envelope is no longer sealable. The lock is not taken at the start of a round: cancel, remind and
the sweep would then wait for the storage work and hit Prisma's 5-second transaction timeout. An
aborted `sealFinal` leaves one locked, unreferenced object in the sealed bucket. That is rare and
harmless, and is accepted.

**Tests** (`apps/api/test/envelope-locks.e2e.test.ts`): a signature is refused when the deadline
passes after the link was checked; a signature and a decline are refused when the envelope is
cancelled after the check; a round and the final seal leave a cancelled envelope alone, with no new
version and no `ENVELOPE_COMPLETED`; an invitation is queued again for a new `invitedAt` but not
twice for one. Removing the locks makes the deadline and both sealing tests fail.

## Step 3: Database

Two migrations, because Postgres cannot use a new enum value in the transaction that adds it:

1. `envelope_expired_status`: `ALTER TYPE "EnvelopeStatus" ADD VALUE 'EXPIRED' AFTER 'PARTIALLY_SIGNED'`.
2. `envelope_lifecycle`:

| Change | Reason |
|---|---|
| `Envelope.voidedAt`, `voidReason` (text), `voidedByUserId` (restrict) | Who cancelled, when and why. The reason stays out of the audit metadata. |
| `Envelope.expiredAt` | When the sweep paused it; kept after an extension as history |
| `Envelope.reminderIntervalDays` | Automatic reminders; null is off |
| `Recipient.expiryWarnedAt` | The "expires soon" email is sent once per deadline |
| `Recipient.moreTimeRequestedAt` | One request for more time a day |
| `Recipient.lastSeenAt` | No automatic reminder while the document is open |
| `Envelope_sent_has_time` recreated as `status IN ('DRAFT','VOIDED') OR "sentAt" IS NOT NULL` | A discarded draft was never sent |
| `Envelope_voided_has_time`, `Envelope_voided_sent_has_reason`, `Envelope_expired_has_time`, `Envelope_reminder_interval_range` (1–30) | Invariants in the database |
| Index `(status, expiresAt)` | The sweep |

The token guardian refuses `EXPIRED` with `TOKEN_EXPIRED`, after the already-signed check, so a
person who signed is still told they signed.

## Step 4: Cancel and Discard

`POST /v1/envelopes/:id/void` `{ "reason": "..." }` (1000 characters at most; required unless the
envelope is a draft):

- One transaction: `lockEnvelope`, status check, `VOIDED` with `voidedAt`, `voidReason` and
  `voidedByUserId`, and `ENVELOPE_VOIDED` with `{ fromStatus, reasonLength }` (or
  `{ fromStatus: 'DRAFT', discarded: true }`).
- `COMPLETED`, `DECLINED` or `VOIDED` answers 409 `ENVELOPE_TERMINAL`; another tenant's envelope 404.
- Links stop by state: the guardian already refuses `VOIDED` first. Seal jobs stop because the
  envelope is no longer sealable.
- After commit, one `voided` email job per signer or approver (`voided-{envelopeId}-{recipientId}`).
  The worker sends it only if the person had been emailed (`notifiedAt` set) when it runs, so an
  invitation racing the cancel is covered. It carries the sender's reason and no link, and writes
  `EMAIL_SENT` with `kind: voided`.

## Steps 6 and 7: The Maintenance Queue, Expiry and Extend

**Maintenance queue.** A third queue, `maintenance`, processed by the worker one job at a time. Each
worker registers the schedules at start with BullMQ job schedulers (`upsertJobScheduler`), which is
safe with several workers: one tick makes one job. Runs can still overlap (a stalled job re-runs, or
a run is slower than its interval), so every row is claimed with a compare-and-set rather than a
global lock. `MAINTENANCE_SCHEDULES_ENABLED=false` skips registration (the API e2e suite calls the
services directly, with an injected `now`).

| Job | When | What |
|---|---|---|
| `expiry-sweep` | Every 5 minutes | Pauses overdue envelopes |
| `auto-reminders` | Every 15 minutes | Automatic reminders and "expires soon" |
| `audit-chain-check` | 02:00 UTC | The nightly check (step 12) |

Each run logs one summary line (job, scanned, changed, duration).

**Expiry sweep.** For each candidate: `lockEnvelope`, then count the unsigned signers and approvers
in a new statement (so it sees fresh data), then `EXPIRED`, `expiredAt` and `ENVELOPE_EXPIRED`
(`{ unsigned }`, system actor). After commit, the sender gets an `expired` email
(`expired-{envelopeId}-{expiredAt}`).

**Extend.** `POST /v1/envelopes/:id/extend` `{ "expiresInDays": 1–90 }`, with an `Idempotency-Key`
(a double click would otherwise send two emails, and the first link would already be dead):

- One transaction: `lockEnvelope`; open or `EXPIRED` only; the new `expiresAt`; `EXPIRED` returns to
  `PARTIALLY_SIGNED` or `SENT`; every unused link's `tokenExpiresAt` moves to the new deadline;
  `expiryWarnedAt` is cleared; `ENVELOPE_EXTENDED` with the old and new deadline and statuses.
- After commit: an `extended` email with a fresh link to each unfinished person whose turn it is, and
  a `resume-{envelopeId}-{epoch}` seal job. The seal worker stamps any signature made before the
  deadline, then invites anyone now due (`SealingService.inviteDue`, taken from the invite step of a
  stamping round).
- **As built:** no separate `inviteDue`. A stamping round already invites whoever becomes due in the
  same transaction that inserts the version, so the resume job is an ordinary seal job
  (`catchUp`) with the id `resume-{envelopeId}-{epoch}`. It is queued only when an `EXPIRED`
  envelope reopens; before the deadline nothing is waiting to be stamped. The `extended` email goes
  to signers and approvers in `SENT`, `DELIVERED` or `VIEWED` with an unused link. The response is
  `{ id, status, expiresAt, previousExpiresAt, resumed, notified }`.

## Step 8: Ask for More Time

`POST /v1/sign/:token/request-more-time`. The guardian's `resolve(token, { allowExpired: true })`
lets the link through only when its single refusal is `TOKEN_EXPIRED`; anything else is refused as
usual. The claim `moreTimeRequestedAt IS NULL OR < now − 24h` makes it once a day: a second request
answers `200 { requested: true, alreadyRequested: true }` so a reload is not an error. It writes
`EXTENSION_REQUESTED` and emails the sender (`more-time-requested`, with a link to the envelope page).
A link that still works gets 409. It is limited like other signing writes.

## Step 10: Automatic Reminders

A person is due when:

- the envelope is open, `reminderIntervalDays` is set and the deadline has not passed;
- they are a signer or approver in `SENT`, `DELIVERED` or `VIEWED` with an unused link. That already
  means it is their turn: later groups stay `PENDING` until invited;
- their last contact, the latest of `invitedAt`, `notifiedAt` and `lastRemindedAt`, is at least the
  interval ago;
- they have not opened the document in the last 60 minutes (`lastSeenAt`, written by signing reads
  at most every 10 minutes). Every reminder carries a new link, so reminding someone mid-signing
  would break their open page.

"Expires soon" goes once per deadline, 48 hours before it (`EXPIRY_WARNING_HOURS`), unless the person
was contacted in the last 24 hours. If both are due, only the warning is sent. Each is claimed with
compare-and-set on `lastRemindedAt`, writes `REMINDER_SCHEDULED` (`{ kind: interval | expiry-warning }`,
system actor), and sets `lastRemindedAt`, so the sender's own Remind button waits 24 hours after it.

## Step 11: Alerts

`AlertService.raise(key, summary, ids)` always logs with `alert: true`. With `ALERT_EMAIL` set, it
also emails, at most once per key every `ALERT_EMAIL_MIN_INTERVAL_MINUTES` (a Redis `SET NX PX`
gate). Alert emails hold ids, codes and counts only. On the worker the email is sent directly, so a
stuck email queue cannot swallow its own alert; the API queues an `alert` job. Raised by: a failed
audit write, a chain break, a seal or email job that failed its last attempt, and a completion hash
mismatch.

## Step 12: The Nightly Audit-Chain Check

Envelopes are read in batches of 100 by id, their events loaded in one query per batch and checked
with `verifyChain`. It also checks each status has the event that must exist for it (`COMPLETED` →
`ENVELOPE_COMPLETED`, `VOIDED` → `ENVELOPE_VOIDED`, `EXPIRED` → `ENVELOPE_EXPIRED`). All breaks of a
run go into one alert (`chain-check-{date}`), repeated every night while they last. Sending is not
halted automatically; doc 10's "halt sending" stays a manual decision. `pnpm --filter @envelope/api
audit:check` runs the same check and exits with 1 on a break.

## Step 13: Request Limits in Redis

A `ThrottlerStorage` on Redis (`common/throttling/redis-throttler.storage.ts`): one Lua script
(increment, set the expiry on the first hit, read the time left), on its own client that fails fast
(`enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `RATE_LIMIT_REDIS_TIMEOUT_MS`). The shared
BullMQ client cannot be used: it waits for ever while Redis is down. If Redis fails, counting falls
back to the process's memory and one alert is logged, and recovery is logged too. Blocking everyone
(signers included) during an outage, or dropping login protection, would both be worse.

Keys are `{QUEUE_PREFIX}:rl:{bucket}:{hash}`: tenant ids, emails and tokens are hashed. The signing
and upload guards already use the injected storage, so they move with it.

| Limit | Keyed on |
|---|---|
| Create and send: 100/min | tenant |
| Upload: 20/min | tenant |
| Cancel, extend, remind, reminder settings: 30/min | tenant |
| Login: 10/min, and 5/min per account | IP; hash of the email |
| Signing: 60 reads and 10 writes a minute | hash of the link |
| Verify, download: 30/min | IP |

Every limited response carries `X-RateLimit-Limit`, `-Remaining` and `-Reset`, and a refusal
`Retry-After`.

## Step 14: Dashboard Views

`GET /v1/envelopes?view=attention|waiting|completed|cancelled|drafts|all` (and doc 08's `status=`).
Rows gain `progress` (`signed`, `total`, `waitingOn`, `oldestUnviewedSince`, `lastActivityAt`),
`expiresAt` and, in Needs attention, `attention: { reason, since }`. `GET /v1/envelopes/counts` returns
every tab's count in one query.

Needs attention, in rank order, longest-waiting first within each:

1. `EXPIRED`;
2. someone whose turn it is was invited 48 hours ago or more and has not opened it;
3. an email not accepted by the mail server within an hour;
4. open and expiring within 48 hours;
5. declined in the last 7 days.

It is ordered in SQL, with keyset paging on `(rank, waitingSince, id)`. The cursor carries the time
the first page was evaluated at, so rows do not move between pages. Raw SQL is not scoped by the
tenant extension, so the tenant id is passed explicitly and a test checks isolation. Other tabs keep
newest first. The dashboard opens on Needs attention when it is not empty, otherwise All.

## Step 15: Tests

- **Transitions.** `apps/api/test/transitions.e2e.test.ts` walks every status change. Each writes
  exactly one event of the expected action, and when the audit write is made to fail, the status is
  unchanged.
- **Leak audits** cover the cancelled, extended, "expires soon", automatic reminder, more-time and
  alert emails, and the `rl:` keys.
- **Browser.** Cancel; expired, ask for more time, extend, sign, completed; the dashboard tabs.
- **Isolation.** The browser stack gets its own database, `digitalsign_browser_test`, so its
  scheduler can never expire or remind the API suite's envelopes in `digitalsign_test`. The stack
  creates it if missing; the Postgres init script creates it on new volumes.

## New Settings

| Variable | Default | Purpose |
|---|---|---|
| `AUTO_REMINDER_DEFAULT_DAYS` | 3 | Interval for new envelopes; 0 means off by default |
| `EXPIRY_WARNING_HOURS` | 48 | When "expires soon" is sent |
| `MAINTENANCE_SCHEDULES_ENABLED` | true | Register the scheduled jobs |
| `EXPIRY_SWEEP_EVERY_MS` | 300000 | Expiry sweep interval |
| `REMINDER_SWEEP_EVERY_MS` | 900000 | Reminder job interval |
| `AUDIT_CHAIN_CHECK_CRON` | `0 2 * * *` | Nightly check, UTC |
| `ALERT_EMAIL` | unset | Where alerts are emailed; unset means logs only |
| `ALERT_EMAIL_MIN_INTERVAL_MINUTES` | 15 | Repeat alerts held back |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | 250 | Before falling back to memory |

New audit actions: `ENVELOPE_VOIDED`, `ENVELOPE_EXPIRED`, `ENVELOPE_EXTENDED`,
`EXTENSION_REQUESTED`, `REMINDER_SCHEDULED`. New error code: `ENVELOPE_EXPIRED` (409). New emails:
`voided`, `expired` (to the sender), `extended`, `expiry-warning`, `more-time-requested` (to the
sender) and `alert`.

## Deliberate Simplifications

| Simplification | Planned fix |
|---|---|
| Any user of a tenant can cancel | Roles, Phase 6 |
| An expired large-file download link shows 410 JSON and cannot be renewed | Phase 6 |
| Alerts are email only | A paging tool with the production deploy, Phase 7 |
| A chain break does not stop sending by itself | A manual decision, per doc 10's P0 response |
| A discarded draft is kept (as `VOIDED`, hidden from the Cancelled tab) | The audit trail cannot be deleted by the app; retention in Phase 6 |
| Found while planning, for Phase 7: an unset `NODE_ENV` in production leaves Swagger and the test rate-limit bypass on; the public health check shows raw error messages; the web app has no CSP because nothing serves it yet; the accessibility gaps (no PDF text layer, pointer-only field placement, contrast) | Phase 7 |
