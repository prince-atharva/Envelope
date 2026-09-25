# System Architecture

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering (Part 2) |
| **What this doc answers** | How do the pieces fit together, and what happens when someone signs? |

---

# PART 1 — In Plain Terms

## The Four Parts of the System

Think of the platform as a small office with four departments.

```
   ┌─────────────────────────────────────────────────────┐
   │  1. THE FRONT DESK — what people see and touch      │
   │     The sender's dashboard, the signing page        │
   └─────────────────────────────────────────────────────┘
                            │
   ┌─────────────────────────────────────────────────────┐
   │  2. THE BRAIN — decides what happens next           │
   │     Who signs now, is this link valid, is it done?  │
   └─────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
   ┌──────────────────────┐   ┌──────────────────────────┐
   │  3. THE WORKSHOP     │   │  4. THE FILING CABINET   │
   │  Builds the finished │   │  Stores documents and    │
   │  document            │   │  the permanent record    │
   └──────────────────────┘   └──────────────────────────┘
```

**The Front Desk** is everything a person sees. There are two very different counters here. The sender's dashboard is for people who use the system often and want to move fast. The signing page is for someone who has never seen it before and will never see it again, so it must be obvious with no instructions.

**The Brain** makes every decision. Is this link genuine? Has it been used already? Who is next in line? Is everyone finished? It also writes down everything that happens.

**The Workshop** does the heavy work: putting the signature onto the page, building the certificate, taking the fingerprint. This takes a few seconds, so it happens in the background — the signer sees "Done!" straight away rather than staring at a spinner.

**The Filing Cabinet** stores everything: the original documents, each version as it gains signatures, the finished sealed copy, and the permanent record of what happened.

## Why the Workshop Works in the Background

This is a small design decision with a large effect on how the product feels.

Building a finished document is genuinely slow in computing terms — several seconds for a long file. If the signer had to wait for it, they would be staring at a loading spinner on a train with bad signal, wondering whether it worked, possibly tapping the button again.

Instead, the moment they tap Finish, we save their signature and tell them immediately that they are done. The actual assembly happens in the background, like handing a form to a back office. The email with the finished document arrives moments later.

## The Life of a Document

Every signing job moves through a fixed set of stages. It can never skip one or go backwards.

```
      DRAFT           Being prepared. Only the sender can see it.
        │
        ▼
      SENT            Emails are out. Links are live.
        │
        ▼
    DELIVERED         The emails arrived successfully.
        │
        ▼
     VIEWED           Someone opened it. (Recorded: when, where, what device.)
        │
        ▼
  PARTIALLY SIGNED    At least one person signed, but not everyone yet.
        │
        ▼
    COMPLETED         Everyone signed. Sealed and locked. Finished.


  Two ways it can end early:

     DECLINED         Someone refused. Reason recorded. Nobody can sign now.
      VOIDED          The sender cancelled it. All links died instantly.
```

Three things are worth knowing about this:

**It only moves forwards.** A completed document cannot go back to being editable. This is deliberate and enforced by the system, not merely by the interface.

**The endings are final.** Once a document is completed, declined, or voided, that is permanent. A declined document cannot be signed later — the sender must send a fresh one, which leaves an honest record of what happened.

**Every single change is written down**, at the same instant it happens, in a record that can never be edited afterwards.

## What Actually Happens, Start to Finish

Following one document all the way through, with every step the system takes:

```
  PRIYA (sender)          THE SYSTEM              RAJ (signer)
      │                        │                       │
      │  1. Uploads PDF ──────►│                       │
      │                        │ 2. Takes fingerprint  │
      │                        │    Stores the file    │
      │◄─ 3. Ready to set up ──│                       │
      │                        │                       │
      │  4. Places boxes,      │                       │
      │     adds Raj ─────────►│                       │
      │                        │ 5. Saves positions    │
      │                        │    as percentages     │
      │                        │                       │
      │  6. Clicks Send ──────►│                       │
      │                        │ 7. Creates one-time   │
      │                        │    key, sends email ─►│
      │                        │                       │
      │                        │◄─ 8. Opens the link ──│
      │                        │ 9. Checks the key     │
      │                        │10. Records: VIEWED    │
      │                        │11. Shows the notice ─►│
      │                        │                       │
      │                        │◄─12. Ticks consent ───│
      │                        │13. Stores the exact   │
      │                        │    wording shown, then│
      │                        │    shows document ───►│
      │                        │                       │
      │                        │◄─14. Draws signature, │
      │                        │      taps Finish      │
      │                        │15. Says "Done!" ─────►│
      │                        │                       │
      │                        │  ── background work ──│
      │                        │16. Converts percentages
      │                        │    to real positions  │
      │                        │17. Burns signature in │
      │                        │18. Adds certificate   │
      │                        │19. Takes fingerprint  │
      │                        │20. Locks it away      │
      │                        │                       │
      │◄─21. "Completed" ──────│──21. Finished copy ──►│
```

Steps 16 and 17 are where the interesting work happens, and they are covered in detail in [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md).

---
---

# PART 2 — Technical Detail

> Written for engineering. Non-technical readers can stop here.

## Container Diagram

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT / PRESENTATION LAYER                          │
├────────────────────────────────────┬──────────────────────────────────────────┤
│           Sender Studio            │             Signer Portal                │
│  - React + Vite app (authed)       │  - React route, unauthenticated          │
│  - pdfjs-dist page rendering       │  - Token-gated, single-use               │
│  - Absolute overlay layer for      │  - signature_pad canvas capture          │
│    drag-and-drop field placement   │  - Minimal bundle: mobile-first, low BW  │
│  - Ratio conversion chokepoint     │  - Guided field navigation               │
└────────────────────────────────────┴──────────────────────────────────────────┘
                                    │
                                    │  HTTPS / JSON
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION LAYER                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│  Node.js / TypeScript  (NestJS — see ADR 0012)                                 │
│                                                                               │
│   ┌───────────────┐  ┌────────────────┐  ┌──────────────┐  ┌───────────────┐ │
│   │ Token         │  │ Envelope State │  │ Field &      │  │ Audit         │ │
│   │ Guardian      │  │ Machine        │  │ Template Svc │  │ Logger        │ │
│   │ HMAC verify   │  │ transitions,   │  │ ratio        │  │ append-only,  │ │
│   │ single-use,   │  │ guards, routing│  │ validation   │  │ hash-chained  │ │
│   │ expiry        │  │                │  │              │  │               │ │
│   └───────────────┘  └────────────────┘  └──────────────┘  └───────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
              │                                              │
              ▼                                              ▼
┌──────────────────────────────────────┐   ┌───────────────────────────────────┐
│   ASYNC PROCESSING (BullMQ workers)  │   │        PERSISTENCE LAYER          │
├──────────────────────────────────────┤   ├───────────────────────────────────┤
│  - PdfSealingService                 │   │  PostgreSQL 15+ (Prisma)          │
│      pdf-lib + fontkit + sharp       │   │    envelopes, recipients, fields, │
│  - Certificate generator             │   │    versions, audit trail          │
│  - SHA-256 fingerprinting            │   │                                   │
│  - Mail dispatcher (Postmark/SES)    │   │  Object storage (S3 / R2)         │
│  - Reminder scheduler                │   │    originals, versions, sealed    │
│  - Webhook delivery + retry          │   │    → Object Lock on final only    │
│  - Retention sweeper                 │   │                                   │
│                                      │   │  Redis — queues, sessions, OTP    │
└──────────────────────────────────────┘   └───────────────────────────────────┘
```

## Component Responsibilities

| Component | Owns | Must not |
|---|---|---|
| **Sender Studio** | Field placement UX, pixel→ratio conversion, envelope composition | Never sends pixel coordinates to the server |
| **Signer Portal** | Signature capture, consent presentation, field completion | Never trusts client-supplied recipient identity — the token is the only authority |
| **Token Guardian** | Verifying, expiring, and invalidating signing tokens | Never stores a raw token |
| **Envelope State Machine** | All lifecycle transitions, guard conditions, routing advancement | Never allows a transition without emitting an audit event in the same transaction |
| **Field & Template Service** | Field CRUD, ratio range validation, template instantiation | Never accepts a ratio outside `[0.0, 1.0]` |
| **Audit Logger** | Append-only hash-chained event writes | Never exposes UPDATE or DELETE |
| **PdfSealingService** | Ratio→point conversion, burning, certificate generation, fingerprinting | Never mutates the original upload |
| **Mail Dispatcher** | Templated delivery, bounce capture | Never embeds a raw token in a logged URL |

## Envelope State Machine

```
                    ┌──────────┐
                    │  DRAFT   │  Sender composing. Mutable.
                    └────┬─────┘
                         │ send()
                         ▼
                    ┌──────────┐
                    │   SENT   │  Tokens minted, emails queued.
                    └────┬─────┘
                         │ mail provider confirms delivery
                         ▼
                    ┌───────────┐
                    │ DELIVERED │
                    └────┬──────┘
                         │ recipient opens link
                         ▼
                    ┌──────────┐
                    │  VIEWED  │  IP, user agent, timestamp recorded.
                    └────┬─────┘
                         │ recipient submits signature
                         ▼
              ┌────────────────────┐
              │  PARTIALLY_SIGNED  │◄──┐  Version created. If sequential,
              └────┬───────────────┘   │  next recipient notified.
                   │                   └──┘ (loops per recipient)
                   │ all required recipients complete
                   ▼
              ┌───────────┐
              │ COMPLETED │  Sealed, certificate appended, Object Lock applied.
              └───────────┘

   Terminal branches, reachable from any non-terminal state:

              ┌───────────┐          ┌──────────┐
              │ DECLINED  │          │  VOIDED  │
              └───────────┘          └──────────┘
               recipient refuses      sender cancels
               (reason required)      (tokens killed)
```

### Transition Table

This is what gets implemented — the diagram alone is not sufficient.

Draft editing (Phase 2) does not change the envelope's status, but each change is
still recorded: `ENVELOPE_UPDATED`, `RECIPIENT_ADDED`, `RECIPIENT_UPDATED`,
`RECIPIENT_REMOVED` and `FIELDS_SAVED`. Their metadata holds ids, counts and a
hash of the layout, never a name, an email or a message: the audit trail cannot
be edited afterwards, so personal data does not go into it.

| From | To | Trigger | Guard | Side effects | Audit event |
|---|---|---|---|---|---|
| `DRAFT` | `SENT` | `POST /envelopes/:id/send` | ≥1 recipient; every recipient has ≥1 required field; all ratios valid | Mint tokens, hash+store, queue emails, set `expiresAt` | `ENVELOPE_SENT` |
| `SENT` | `DELIVERED` | Mail provider webhook | Provider confirms delivery | Update recipient status | `EMAIL_DELIVERED` |
| `SENT`/`DELIVERED` | `VIEWED` | `GET /sign/:token` | Token valid, unused, unexpired | Record IP/UA/timestamp | `ENVELOPE_VIEWED` |
| `VIEWED` | `VIEWED` | `POST /sign/:token/consent` | Token valid | Store verbatim disclosure text + timestamp | `CONSENT_GIVEN` |
| `VIEWED` | `PARTIALLY_SIGNED` | `POST /sign/:token/submit` | Consent given; all required fields for this recipient complete | Persist field values, invalidate token, enqueue seal job | `RECIPIENT_SIGNED` |
| `PARTIALLY_SIGNED` | `PARTIALLY_SIGNED` | Seal job completes | — | Create `DocumentVersion`, notify next recipient if sequential | `VERSION_CREATED` |
| `PARTIALLY_SIGNED` | `COMPLETED` | Final recipient's seal job completes | All required recipients signed | Append certificate, fingerprint, apply Object Lock, notify all | `ENVELOPE_COMPLETED` |
| any non-terminal | `DECLINED` | `POST /sign/:token/decline` | Reason provided | Invalidate all tokens, notify sender | `RECIPIENT_DECLINED` |
| any non-terminal | `VOIDED` | `POST /envelopes/:id/void` | Caller is sender or admin | Invalidate all tokens, notify recipients | `ENVELOPE_VOIDED` |

> **As built (Phase 3).** Sending and signing work as above, with these differences:
>
> - **`VIEWED` is a status of the recipient, not the envelope.** The `EnvelopeStatus` enum in doc 05
>   has no `VIEWED`. Opening a link sets the *recipient* to `VIEWED` and writes `ENVELOPE_VIEWED`
>   once. The envelope stays `SENT` until the first signature.
> - **No `SENT → DELIVERED`.** Gmail SMTP has no delivery webhook. The recipient's `notifiedAt`
>   records when the mail server accepted the email, with `EMAIL_SENT` in the audit trail.
> - **Links are created by the email worker, not at send** ([ADR 0009](adr/0009-store-only-the-hmac-of-signing-tokens.md)).
>   Send invites the first routing group and queues their emails once the transaction has
>   committed. Every reminder (`REMINDER_REQUESTED`) creates a new link and stops the old one.
> - **Adopting a signature is its own event**, `SIGNATURE_ADOPTED`, separate from `RECIPIENT_SIGNED`
>   (doc 07). Neither changes the envelope's status.
> - **The next signer is invited when the version is created** (Phase 4), as the table says. In
>   Phase 3, before versions existed, it happened on submit.
> - **Decline stops links by state.** The links are not deleted. The envelope moves to `DECLINED`
>   in the same transaction as the decline, and every link check refuses a terminal envelope
>   first. So invariant 3 below holds, and the portal can still tell a signer what happened.
> - Void (`POST /envelopes/:id/void`) is not built yet.

**Invariants that MUST hold:**

1. Terminal states (`COMPLETED`, `DECLINED`, `VOIDED`) admit no outbound transitions.
2. Every transition writes its audit event in the **same database transaction** as the state change. A transition without an event is a defect, and this should be enforced by a test that walks every transition.
3. Token invalidation on decline and void is synchronous, not queued. A cancelled document must stop being signable immediately, not eventually.
4. `PARTIALLY_SIGNED → PARTIALLY_SIGNED` is a real self-loop, once per recipient, each producing a new version.

## Asynchronous Processing

Anything that takes more than ~200ms or touches an external service runs on a BullMQ worker.

| Queue | Job | Concurrency | Retry | Notes |
|---|---|---|---|---|
| `seal` | Burn signatures, produce a version | 4 | 3× exponential | Idempotent on `(envelopeId, versionNumber)` |
| `certificate` | Generate and append certificate page | 2 | 3× | Runs only on final version |
| `mail` | Invitations, reminders, completion notices | 10 | 5× exponential | Bounces feed the audit trail |
| `webhook` | Outbound HMAC-signed delivery | 10 | 6× exponential to 24h | Manual redrive path required |
| `reminder` | Scheduled nudges | 1 | 1× | Cron-triggered |
| `retention` | Purge expired data honouring legal holds | 1 | 1× | Nightly |

> **As built (Phase 3).** The mail queue is called `email`, with concurrency 5 and exponential
> retries. It carries invitations, reminders and the sender's "declined" notice. Each job holds ids
> only; the invitation and reminder jobs create the signing link inside the worker, so it never
> sits in Redis. Sealing, certificates, webhooks, scheduled reminders and retention are not built yet.

Sealing MUST be idempotent. A worker retry after a partial failure must not double-burn a signature onto the page. Key the job on `(envelopeId, versionNumber)` and make the version row creation the atomic commit point.

## Deployment

```
   MVP (single region)              Scale (multi-region)
   ─────────────────────            ────────────────────────────
   Vercel / ECS Fargate             Multi-AZ compute + autoscaling
   Managed Postgres                 Postgres with read replicas
   Managed Redis                    Redis cluster
   S3 or R2 (one region)            Per-tenant region routing for
   1 worker process                   data residency
                                    Worker pool per queue
```

Environments: `local` (Docker Compose), `staging` (production-shaped, synthetic data), `production`.

**Data residency:** the storage layer routes by tenant region so an EU tenant's documents never leave the EU. This is a v1 architectural decision even though multi-region deployment is deferred — retrofitting it later means migrating live documents, which is far more expensive than designing for it now.

### Database at scale (100M-row follow-up, docs/16 step 14)

The schema, index and query work for 100M+ rows is built (see the migrations dated 2026-09-24 and the query rewrites that followed). Three further changes are deployment topology, not application code, and stay deferred until there is a real production database to apply them to:

- **PgBouncer, transaction mode**, in front of the API and worker's own pools (Phase 3's `DB_POOL_MAX`/`DB_POOL_MAX_WORKER` size each process's pool; PgBouncer would sit below that, pooling actual server connections across processes/instances). Transaction mode is safe here specifically because: every lock this codebase takes (`pg_advisory_xact_lock`, `FOR UPDATE`/`FOR NO KEY UPDATE`) is transaction-scoped, never session-scoped, so a connection handed to a different client between transactions never carries a stale lock with it; and the pg driver's prepared statements are unnamed per query, which PgBouncer 1.21+ supports in transaction mode without the "prepared statement already exists" failures older versions had.
- **A read replica** for `/verify` (public, unauthenticated, and the one endpoint with no per-tenant rate limit tied to a login) and the dashboard's list/attention reads, which can tolerate the usual replica lag of well under a second. Writes (send, sign, seal, everything under a lock) stay on the primary.
- **AuditTrail partitioning by month**, deferred until there is a retention policy to hang it on. Partitioning's usual justification — cheap bulk deletes of old partitions, and smaller indexes per partition — depends on eventually dropping old data, which nothing in this codebase does yet (AuditTrail is intentionally append-only with no delete path, docs/05 invariant 5). Without that, partitioning would add real complexity (every query needs the partition key or it scans all of them; the hash chain's `(envelopeId, sequence)` uniqueness has to be re-verified as safe across partition boundaries) for no query-speed gain: `(envelopeId, sequence)` stays a simple, fast index lookup at 100M+ rows either way. Revisit this once a retention policy exists to delete or archive by.
  > **Revisited in Phase 6 (docs/17 step 12, ADR 0014):** the retention policy now exists, and the
  > answer is unchanged. Retention purges storage objects, never `AuditTrail` rows, so there is
  > still no delete path to justify partitioning. The deferral stands until an archiving strategy —
  > moving old, closed chains to cold storage rather than deleting them — is designed.

## Observability

| Signal | What |
|---|---|
| Metrics | Envelope completion rate, seal job duration p50/p95/p99, queue depth, token validation failure rate, mail bounce rate |
| Logs | Structured JSON, correlation ID per envelope. **Raw tokens MUST NEVER be logged** — log the token hash prefix only. |
| Traces | Request → queue → worker, correlated by envelope ID |
| Alerts | Seal queue depth > 100, seal failure rate > 1%, any audit write failure (page immediately — this breaks the evidentiary chain) |

## Key Architectural Decisions

| Decision | Rationale | Recorded as |
|---|---|---|
| Signature burned into page content, not annotations | Annotations can be stripped by any PDF editor without disturbing the page, undermining the claim that the signature is part of the document | ADR-0005 (planned) |
| Sealing runs async on workers | Multi-second operation; signer must get immediate confirmation | ADR-0006 (planned) |
| One `DocumentVersion` per signing round | A single original/final hash pair cannot honestly represent a multi-signer chain of custody | ADR-0003 (planned) |
| Coordinates stored only as ratios | Device-independent placement; single conversion chokepoint | ADR-0002 (planned) |
| Audit hash-chained | Makes the log itself tamper-evident, not merely append-only by convention | ADR-0004 (planned) |
| Object Lock on final version only | Intermediate versions must remain writable during multi-signer flows | ADR-0007 (planned) |
| Separate NestJS API and React/Vite web app | The API outlives the web app (integration, signer portal, workers); Next.js route handlers give worker processes no structure | [ADR-0012](adr/0012-nestjs-api-and-react-vite-web.md) (accepted) |
