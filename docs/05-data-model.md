# Data Model

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering (Part 2) |
| **What this doc answers** | What information do we store, and how is it organised? |

---

# PART 1 — In Plain Terms

## The Six Things We Track

Everything the system stores falls into six categories.

```
   ACCOUNTS ────────► People who send documents. They have logins.
       │
       ▼
   SIGNING JOBS ────► One per document sent out. The centre of everything.
       │
       ├──► THE PEOPLE      Who must sign, in what order, and their status
       │
       ├──► THE BOXES       Where on the page each person signs, and what
       │                    they put there
       │
       ├──► THE VERSIONS    A snapshot after each person signs, with its
       │                    own fingerprint
       │
       └──► THE RECORD      A permanent log of everything that happened
```

**Accounts** are only for senders. Signers never get an account — that is the point.

**Signing jobs** are the central item. Everything else belongs to one.

**The people** lists who needs to act. Each has a status, a position in the order, and their own private one-time key.

**The boxes** are the positions on the page. Each belongs to one specific person, so the system knows whose signature goes where. Positions are stored as percentages, never as screen measurements — this is what makes signatures land correctly on every device.

**The versions** are snapshots. This is worth explaining properly, because it is the part people usually get wrong.

**The record** is the permanent log. Only ever added to.

## Why We Keep a Snapshot After Every Signature

Suppose three people must sign a contract in turn.

The obvious approach is to keep the original file and the finished file, with a fingerprint of each. It seems sufficient. It is not, and the reason matters legally.

When the second person signs, the document they are looking at is **not the original** — it already has the first person's signature on it. When the third signs, they see a document with two signatures. Each person genuinely signed a different version of the file.

If you only keep the first and last fingerprints, you cannot prove what the second person actually saw when they signed. In a dispute, that gap is exactly what gets attacked: *"my client never agreed to the version you are showing the court."*

So we keep a snapshot at every stage:

```
   Version 0  ── the original, before anyone signed
                 fingerprint: e3b0c442...

   Version 1  ── after Priya signed        ← this is what Raj actually saw
                 fingerprint: a591a6d4...

   Version 2  ── after Raj signed          ← this is what Sam actually saw
                 fingerprint: 7d8f2b1c...

   Version 3  ── after Sam signed, plus the certificate page
                 fingerprint: 4c9e1a05...   ← the final sealed document
```

Now the chain is complete and honest. For each signer we can show precisely which version they were presented with and prove it has not been altered since. There are no gaps to attack.

## The Rules We Do Not Break

Four constraints run through the whole design. Each exists for a specific reason.

**Positions are stored as percentages, never as screen measurements.**
A pixel measurement is meaningless on a different screen. A percentage means the same thing everywhere. This single rule is why signatures land correctly on a phone, a laptop, and a printout.

**The original file is never modified.**
Every signature produces a new version alongside it. The original stays untouched forever, so we can always prove what the document looked like before anyone touched it.

**The record can only be added to.**
There is no way to edit or delete an entry — not through the app, and not by anyone with direct database access either. Entries are chained together so that altering one visibly breaks the chain. A tampered log announces itself.

**Consent is stored word for word.**
When someone agrees to sign electronically, we store the exact wording they were shown, not a reference to it. If that wording is ever updated, old records still show what was actually on screen at the time. A reference to a template that has since changed proves nothing.

---
---

# PART 2 — Technical Detail

> Written for engineering. Non-technical readers can stop here.

## Entity Relationship Diagram

```
   ┌──────────┐
   │   User   │  senders and admins only — signers have no User row
   └────┬─────┘
        │ 1
        │
        │ n
   ┌────▼──────────────────────────────────────────────────────┐
   │                        Envelope                           │
   │  status, originalFileUrl, completedFileUrl, expiresAt      │
   └──┬──────────┬──────────────┬──────────────┬───────────────┘
      │ 1        │ 1            │ 1            │ 1
      │          │              │              │
      │ n        │ n            │ n            │ n
   ┌──▼───────┐ ┌▼────────────┐ ┌▼───────────┐ ┌▼──────────────┐
   │Recipient │ │DocumentField│ │DocumentVer-│ │  AuditTrail   │
   │          │ │             │ │   sion     │ │               │
   │ tokenHash│ │ ratioX/Y/W/H│ │ versionNo  │ │ prevHash      │
   │ role     │ │ pageNumber  │ │ hash       │ │ eventHash     │
   │ status   │ │ type        │ │ fileUrl    │ │ append-only   │
   │ consent  │ │ value       │ │            │ │               │
   └────┬─────┘ └──────▲──────┘ └────────────┘ └───────────────┘
        │ 1            │ n
        └──────────────┘
        a field belongs to exactly one recipient
```

## Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ─────────────────────────────────────────────────────────────
//  Enumerations
// ─────────────────────────────────────────────────────────────

enum EnvelopeStatus {
  DRAFT
  SENT
  DELIVERED
  PARTIALLY_SIGNED
  EXPIRED     // As built (Phase 5): paused by its deadline; can be extended or cancelled (ADR 0013)
  COMPLETED
  DECLINED
  VOIDED
}

// As built (Phase 5, docs/16 step 3). Envelope gains voidedAt, voidReason and
// voidedByUserId (who cancelled, when and why), expiredAt, and
// reminderIntervalDays (automatic reminders; null is off). Recipient gains
// expiryWarnedAt, moreTimeRequestedAt and lastSeenAt. Checks keep them
// consistent: a cancelled envelope has a time and, if it was sent, a reason;
// an expired one has a time; reminders are every 1 to 30 days.

enum RecipientRole {
  SIGNER      // must sign
  APPROVER    // must approve, does not sign
  VIEWER      // read-only access
  CC          // receives the completed copy only
}

enum RecipientStatus {
  PENDING
  SENT
  DELIVERED
  VIEWED
  SIGNED
  DECLINED
}

// As built (Phase 3): how an adopted signature or initials image was made.
enum SignatureMethod {
  DRAWN
  TYPED
}

enum FieldType {
  SIGNATURE
  INITIALS
  DATE_SIGNED   // system-generated, never user-editable
  TEXT_INPUT
  CHECKBOX
}

// ─────────────────────────────────────────────────────────────
//  Core entities
// ─────────────────────────────────────────────────────────────

model User {
  id           String     @id @default(uuid())
  email        String     @unique
  passwordHash String
  fullName     String
  organization String?
  tenantId     String
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  envelopes    Envelope[]

  @@index([tenantId])
}

model Envelope {
  id               String         @id @default(uuid())
  tenantId         String
  title            String
  status           EnvelopeStatus @default(DRAFT)

  ownerId          String
  owner            User           @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  // Storage. The original is NEVER mutated.
  originalFileUrl  String
  completedFileUrl String?

  // Convenience denormalisation of DocumentVersion 0 and the final version.
  // DocumentVersion remains the authoritative chain of custody.
  originalHash     String
  finalHash        String?

  // Routing
  sequentialSigning Boolean       @default(false)
  sentAt            DateTime?     // As built (Phase 3): when it left DRAFT
  expiresAt         DateTime?
  completedAt       DateTime?

  // Jurisdiction policy resolution — see doc 07
  jurisdictionCode String         @default("US")

  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  recipients       Recipient[]
  fields           DocumentField[]
  versions         DocumentVersion[]
  auditLogs        AuditTrail[]

  @@index([tenantId, status])
  @@index([ownerId])
  @@index([expiresAt])
}

model Recipient {
  id             String          @id @default(uuid())
  envelopeId     String
  envelope       Envelope        @relation(fields: [envelopeId], references: [id], onDelete: Cascade)

  name           String
  email          String
  role           RecipientRole   @default(SIGNER)
  status         RecipientStatus @default(PENDING)
  routingOrder   Int             @default(1)  // equal values sign in parallel

  // As built (Phase 2): the colour this person gets in the field builder,
  // assigned when they are added so removing someone never recolours the rest.
  // One email may appear only once per envelope.
  colorIndex     Int             @default(0)

  // ── Access credentials ──
  // Only the HMAC-SHA256 hash is stored. The raw token exists solely
  // in the email that was sent. A full database compromise cannot
  // reconstruct a working signing link. See doc 10.
  //
  // As built (Phase 2): both are NULLABLE. Tokens are minted when the envelope
  // is sent, and a recipient added while preparing a draft has none yet.
  //
  // As built (Phase 3): the email worker mints the token as it sends the
  // invitation (ADR 0009), and every reminder mints a new one and overwrites
  // these, so only the newest link works. Decline and void leave the hash in
  // place: the envelope's status stops the link, and the portal can still say
  // why (doc 10).
  tokenHash      String?         @unique
  tokenExpiresAt DateTime?
  tokenUsedAt    DateTime?       // single-use enforcement
  accessCode     String?         // optional SMS OTP, hashed

  // ── Progress, shown to the sender (As built, Phase 3) ──
  invitedAt      DateTime?       // their turn began: at send, or when the group before finished
  notifiedAt     DateTime?       // the mail server last accepted an invitation or reminder
  lastRemindedAt DateTime?       // limits reminders to one a day
  viewedAt       DateTime?       // first time they opened the link
  servedVersionNumber Int?       // As built (Phase 4): the version last served; RECIPIENT_SIGNED records it

  // ── Consent (ESIGN requirement — see doc 07) ──
  // The verbatim disclosure text is stored, not a reference to a
  // template that may later change. This is what makes consent
  // defensible years afterwards.
  consentGivenAt DateTime?
  consentText    String?         @db.Text

  // ── Adopted images (As built, Phase 3) ──
  // Object-storage keys to transparent PNGs. Submit copies them into every
  // SIGNATURE and INITIALS field this person owns. The method is what doc 00
  // calls "how they signed".
  signatureImageKey String?
  signatureMethod   SignatureMethod?
  initialsImageKey  String?
  initialsMethod    SignatureMethod?

  signedAt       DateTime?
  declinedAt     DateTime?       // As built (Phase 3)
  declinedReason String?

  // Signing telemetry
  signedFromIp   String?
  signedFromUa   String?

  fields         DocumentField[]
  auditEvents    AuditTrail[]
  versions       DocumentVersion[]

  @@index([envelopeId, routingOrder])
  @@index([tokenHash])
}

model DocumentField {
  id          String    @id @default(uuid())
  envelopeId  String
  envelope    Envelope  @relation(fields: [envelopeId], references: [id], onDelete: Cascade)

  recipientId String
  recipient   Recipient @relation(fields: [recipientId], references: [id], onDelete: Cascade)

  type        FieldType @default(SIGNATURE)
  pageNumber  Int       // 1-indexed
  required    Boolean   @default(true)

  // ── Normalised coordinates, range [0.0, 1.0] ──
  // NEVER pixels. NEVER PDF points. Ratios only.
  // Rationale and conversion mathematics in doc 06.
  ratioX      Float
  ratioY      Float
  ratioWidth  Float
  ratioHeight Float

  // Text for TEXT_INPUT / DATE_SIGNED; object-storage key for
  // SIGNATURE / INITIALS images.
  value       String?   @db.Text
  isCompleted Boolean   @default(false)
  completedAt DateTime?

  @@index([envelopeId, pageNumber])
  @@index([recipientId])
}

// ─────────────────────────────────────────────────────────────
//  DocumentVersion — chain of custody
//
//  One row per signing round. Version 0 is the untouched original.
//  Each subsequent version is the document as the NEXT signer saw it.
//  Without this, a multi-signer envelope cannot prove which revision
//  any given signer actually attested to.
// ─────────────────────────────────────────────────────────────

model DocumentVersion {
  id            String     @id @default(uuid())
  envelopeId    String
  envelope      Envelope   @relation(fields: [envelopeId], references: [id], onDelete: Cascade)

  versionNumber Int        // 0 = original
  fileUrl       String
  hash          String     // SHA-256 of this exact file

  // Null for version 0; otherwise the recipient whose signature
  // produced this version.
  createdByRecipientId String?
  createdByRecipient   Recipient? @relation(fields: [createdByRecipientId], references: [id], onDelete: SetNull)

  isFinal       Boolean    @default(false)  // certificate appended, Object Lock applied
  storageVersionId String?                 // As built (Phase 4): final only; reads name it (ADR 0007)
  createdAt     DateTime   @default(now())

  @@unique([envelopeId, versionNumber])
  @@index([envelopeId])
}

// ─────────────────────────────────────────────────────────────
//  AuditTrail — append-only, hash-chained
//
//  No UPDATE. No DELETE. Enforced by database privileges, not
//  application convention. Each row hashes the previous row's
//  eventHash, so altering any entry breaks every entry after it.
// ─────────────────────────────────────────────────────────────

model AuditTrail {
  id          String     @id @default(uuid())
  envelopeId  String
  envelope    Envelope   @relation(fields: [envelopeId], references: [id], onDelete: Cascade)

  recipientId String?
  recipient   Recipient? @relation(fields: [recipientId], references: [id], onDelete: SetNull)

  action      String     // ENVELOPE_SENT, ENVELOPE_VIEWED, CONSENT_GIVEN, ...
  ipAddress   String
  userAgent   String     @db.Text
  metadata    Json?      // signature method, geo, latency, provider ids

  // ── Tamper-evident chain ──
  prevHash    String?    // previous event's eventHash; null for the first
  eventHash   String     // SHA-256 over (prevHash + action + timestamp + payload)

  timestamp   DateTime   @default(now())

  @@index([envelopeId, timestamp])
  @@index([timestamp])
}
```

## Field Reference — Plain English

### Envelope

| Field | Meaning |
|---|---|
| `status` | Where the job has reached. Governed by the state machine in doc 03. |
| `originalFileUrl` | The untouched upload. Never modified. |
| `completedFileUrl` | The final sealed document. Populated only on completion. |
| `originalHash` / `finalHash` | Convenience copies of version 0 and the final version's fingerprints. `DocumentVersion` is authoritative. |
| `sequentialSigning` | `true` = one at a time in order; `false` = everyone at once. |
| `sentAt` | When it was sent. Set once, as it leaves `DRAFT`. |
| `expiresAt` | After this moment all tokens stop working. |
| `jurisdictionCode` | Drives which legal rules apply. See doc 07. |

### Recipient

| Field | Meaning |
|---|---|
| `routingOrder` | Position in the queue. Equal values sign in parallel. |
| `tokenHash` | HMAC-SHA256 of the signing token. The raw token is never stored. Replaced by every reminder, so only the newest link works. |
| `tokenUsedAt` | Set on submission. Makes the link single-use. |
| `invitedAt` | Their turn began: at send, or when the group before them finished. |
| `notifiedAt` | The mail server last accepted an invitation or reminder for them. There is no delivery confirmation beyond that. |
| `lastRemindedAt` | The sender last asked for a reminder. One a day at most. |
| `viewedAt` | They first opened the link. `VIEWED` is a status of the recipient only; the envelope has no such status. |
| `consentText` | The verbatim disclosure shown. **Not a template reference.** |
| `signatureImageKey` / `initialsImageKey` | The adopted images, copied into their fields on submit. |
| `signatureMethod` / `initialsMethod` | `DRAWN` or `TYPED`: how each image was made. |
| `declinedAt` / `declinedReason` | When and why they declined. The reason is kept here and never in the audit trail, which cannot be edited later. |
| `signedFromIp` / `signedFromUa` | Evidence of who signed from where. |

### DocumentField

| Field | Meaning |
|---|---|
| `ratioX` / `ratioY` | Top-left corner as a fraction of page width/height, from the page's top-left. |
| `ratioWidth` / `ratioHeight` | Box size as a fraction of page dimensions. |
| `pageNumber` | 1-indexed. Converted to 0-indexed only inside `PdfSealingService`. |
| `value` | Text, or the storage key of the signature image. |

## Invariants

These MUST be enforced, and each SHOULD have a test:

| # | Invariant | Enforcement |
|---|---|---|
| 1 | All four ratio fields in `[0.0, 1.0]` | Prisma validation + `CHECK` constraint |
| 2 | `ratioX + ratioWidth <= 1.0` and `ratioY + ratioHeight <= 1.0` | Application validation — a field must not overflow the page |
| 3 | `pageNumber >= 1` and `<= ` the document's page count | Validated at placement time |
| 4 | A field's recipient belongs to the same envelope | **As built:** a composite foreign key. `Recipient` carries a unique `(id, envelopeId)`, and `DocumentField(recipientId, envelopeId)` references it, so the database refuses the row rather than trusting the application |
| 5 | `AuditTrail` admits no UPDATE or DELETE | Revoke privileges from the application role |
| 6 | `AuditTrail.prevHash` matches the prior row's `eventHash` | Verified by a periodic integrity job |
| 7 | `DocumentVersion.versionNumber` is contiguous from 0 | Unique constraint + application logic |
| 8 | Exactly one `DocumentVersion` per envelope has `isFinal = true` | Partial unique index |
| 9 | Terminal-status envelopes are immutable | Application guard + test over every transition |
| 10 | `originalFileUrl` never changes after creation | Application guard |
| 11 | A sent envelope has `sentAt` | **As built (Phase 3):** `CHECK` `Envelope_sent_has_time` |
| 12 | A `SIGNED` recipient has `signedAt` and a spent token (`tokenUsedAt`) | **As built (Phase 3):** `CHECK` `Recipient_signed_has_evidence` |
| 13 | A `DECLINED` recipient has `declinedAt` and a reason | **As built (Phase 3):** `CHECK` `Recipient_declined_has_reason` |
| 14 | Consent is never recorded without its verbatim text | **As built (Phase 3):** `CHECK` `Recipient_consent_has_text` |
| 15 | An adopted image always records how it was made | **As built (Phase 3):** `CHECK` `Recipient_signature_has_method` and `Recipient_initials_has_method` |
| 16 | A completed envelope carries its seal: `finalHash`, `completedFileUrl`, `completedAt` | **As built (Phase 4):** `CHECK` `Envelope_completed_has_seal` |
| 17 | The final version, and only the final version, records its storage version id | **As built (Phase 4):** `CHECK` `DocumentVersion_final_has_storage_version` (ADR 0007) |

### Database privileges for the audit table

```sql
-- The application role can insert and read, nothing more.
REVOKE UPDATE, DELETE ON "AuditTrail" FROM app_role;
GRANT  INSERT, SELECT  ON "AuditTrail" TO   app_role;
```

Application-level discipline is not sufficient here. A compromised application or a careless migration must not be able to rewrite history.

## Audit Hash Chain

```
   Event 1:  prevHash = null
             eventHash = SHA256("" + action + timestamp + payload)
                       = a1b2c3...

   Event 2:  prevHash = a1b2c3...
             eventHash = SHA256("a1b2c3..." + action + timestamp + payload)
                       = d4e5f6...

   Event 3:  prevHash = d4e5f6...
             eventHash = SHA256("d4e5f6..." + action + timestamp + payload)
                       = 789abc...
```

Altering event 2 changes its `eventHash`, which no longer matches event 3's `prevHash`. The break is detectable and points at the exact row.

A nightly job SHOULD walk each envelope's chain and alert on any break. **An audit-write failure or chain break is a page-immediately incident** — it means the evidentiary basis of the product is compromised.

## Indexing and Growth

| Table | Growth | Strategy |
|---|---|---|
| `AuditTrail` | Fastest — 10–20 rows per envelope | Range partition by `timestamp`, monthly. Index `(envelopeId, timestamp)`. |
| `DocumentField` | ~5–20 rows per envelope | Index `(envelopeId, pageNumber)` for the placement view |
| `DocumentVersion` | 1 + one per signer | Small; unique index suffices |
| `Envelope` | One per send | Index `(tenantId, status)` for the dashboard; `expiresAt` for the sweeper |

## Retention and Legal Hold

> **As built (docs/17 step 8, ADR 0014).** The nightly sweeper (`maintenance/retention.service.ts`)
> removes storage objects on drafts' and voided/declined envelopes' windows below, and legal hold
> (step 7) excludes an envelope from it. The audit trail line below is honoured literally at the
> row level — it is never deleted, by this sweeper or anything else — but "expire together" for a
> *completed* document means the audit trail stays provable forever while the sealed file itself
> is additionally protected from early deletion by Object Lock (ADR 0007); see ADR 0014 for why a
> completed envelope past its retention years is flagged rather than automatically removed.

| Data | Default retention | Notes |
|---|---|---|
| Completed documents | 7 years | Configurable per tenant; matches common statutory periods |
| Audit trail | 7 years, matching the envelope | Deleting the log while keeping the document destroys its evidentiary value — they expire together or not at all |
| Draft envelopes | 90 days from last edit | Swept nightly |
| Voided / declined | 1 year | Shorter, but not immediate — disputes still arise |
| Signature images | With the envelope | Also burned into the PDF, so the standalone image is secondary |

**Legal hold** overrides all retention. A held envelope is exempt from every sweep until released, and both the hold and the release are audit events.

**Erasure requests** (GDPR Article 17, India DPDP) conflict directly with retention obligations. The resolution: personal data in the *account* record can be erased; a *completed contract* generally cannot, because retaining it is a legal obligation and therefore a lawful basis for continued processing. This tension is real and must be handled explicitly rather than pretended away — see [07-compliance-layer.md](07-compliance-layer.md).

## Multi-Tenancy

Every root entity carries `tenantId`. Enforcement is at the query layer via a Prisma middleware that injects the tenant filter on every read and write.

Row-Level Security in PostgreSQL SHOULD be enabled as defence in depth, so a bug in the middleware cannot leak data across tenants (deferred to Phase 7). Tenant isolation MUST have a dedicated test suite that attempts cross-tenant access on every endpoint. **As built (docs/17 step 13):** `apps/api/test/cross-tenant.e2e.test.ts`, table-driven over every route that takes an envelope id, including every Phase 6 route.
