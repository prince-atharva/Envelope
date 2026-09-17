# Product Requirements

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Product and engineering (Part 2) |
| **What this doc answers** | What exactly are we building, for whom, and what are we deliberately leaving out? |

---

# PART 1 — In Plain Terms

## The Problem

Getting a signature on a document is one of the slowest steps in most businesses, and it is slow for reasons that have nothing to do with the actual decision.

The deal is agreed. Everyone knows what they are signing. And then it takes four days, because the contract has to be printed, signed, scanned, emailed, chased, re-sent because page 3 came out blank, and filed somewhere nobody can find later.

There are two costs here, and the second one is bigger:

**The obvious cost** is time and paper. A day or two of delay per document, multiplied across every contract, offer letter, consent form, and approval your business handles.

**The hidden cost** is the deals that quietly go cold. Every extra day between agreement and signature is a day something can change — a competitor calls, a budget freezes, a champion leaves. Signature delay is where agreed business slips away.

Commercial platforms solve this, but they charge for every document you send. That works fine at low volume and becomes painful at high volume, because your bill scales with your success. At 50,000 documents a month, a business is typically paying six figures a year for what is, underneath, a modest amount of computing.

## What We Are Building

A platform where you upload a document, mark where people need to sign, and send it. Recipients sign in their browser on any device without creating an account. Everyone gets the finished, tamper-evident document back within seconds.

The product is finished when this sentence is true: **a signature that took two days now takes four minutes, and the result stands up in a dispute.**

## Who It Is For

Four kinds of people use this, and they want completely different things.

**The Sender** runs the process. They upload documents, mark signature positions, and send. They care about speed and visibility — how many are outstanding, who has not responded, who needs chasing. They use this many times a week and will become fast at it, so their screens should reward familiarity over hand-holding.

**The Signer** is the most important user and the one we know least about. They did not choose this platform, have never seen it before, and will probably never see it again. They may be on a phone, on a train, with poor signal, in a hurry. They will not create an account, download an app, or read instructions.

> **The single most important design rule in this product:** every additional step, screen, field, or moment of confusion in the signer's path costs completed documents. The signer's journey should be as short as it can legally be — and not one step shorter.

**The Administrator** manages the organisation — who can send, what the templates are, how long documents are kept, what the company branding looks like. They are technical enough to configure things but should not need a developer.

**The Auditor** appears rarely and matters enormously. They arrive months or years later, usually because something is disputed, and need to answer one question: *can you prove what happened?* They should be able to answer it from the document alone, without logging into anything.

## What It Does

**Sending a document.** Upload one or several PDFs. Add the people who need to sign. Drag boxes onto the pages marking where each person signs, initials, dates, or types something. Optionally set an order so people are asked one after another rather than all at once. Set a deadline. Send.

**Signing a document.** Open the link from the email. Confirm you are happy to sign electronically. Get walked to each box you need to fill. Draw your signature with a finger or mouse, or type your name and pick a handwriting style. Review. Finish. Download your copy.

**Tracking.** See at a glance what is outstanding, what has been viewed but not signed, and what is complete. Send a reminder with one click. Cancel anything that is no longer needed.

**Proving it later.** Every finished document carries a certificate page listing who signed, when, from where, and on what device — plus fingerprints proving nothing was altered afterwards. Anyone can verify it independently, without access to our system.

**Reusing your paperwork.** If you send the same contract repeatedly, save it as a template with the boxes already positioned. Next time, add a name and email and send.

**Connecting to other software.** Everything the website does can also be done by other systems automatically, so your CRM or HR tool can send documents for signature without a human involved.

## What We Are Deliberately Not Building

Saying this now is much cheaper than discovering it in month three.

| Not building | Why |
|---|---|
| **Government-issued digital certificates** | Europe's *qualified* tier and India's Aadhaar route both require contracting a licensed provider, with real cost and lead time. The system is designed so either can be added later without rework. For everyday business contracts, they are not needed. |
| **A phone app** | The signer experience works properly in a phone browser, which is what signers actually want — no download, no account, no friction. An app adds cost and adds a step. |
| **Contract lifecycle management** | This gets documents signed. It does not track renewal dates, obligations, or approval hierarchies. That is a different product. |
| **Online notarisation** | A separately regulated service with its own licensing, identity-verification, and video-recording requirements. |
| **A document editor** | Whatever PDF you upload is what gets signed. Write it in Word, export to PDF, upload. Building an editor is a large project that has nothing to do with signing. |
| **Payment collection at signing** | Genuinely useful, genuinely a separate feature. Later, if wanted. |
| **Automatic reading of scanned documents** | A PDF that is really a photograph of a page will still work for signing. But we will not attempt to read text out of images to place fields automatically. |

**And one thing we will never build:** any feature that lets someone alter a document after it has been signed without that alteration being detectable. That is the entire point of the product. Requests for it get declined.

## How We Will Know It Worked

| What we measure | Why it matters | Target |
|---|---|---|
| **Completion rate** | Of documents sent, how many get signed. The single number that says whether the product works. | Above 85% within 7 days |
| **Time to first signature** | From sending to the first person signing. Measures whether the signer path is genuinely frictionless. | Median under 30 minutes |
| **Where people drop off** | The exact step where signers abandon. Tells us what to fix next. | No single step losing more than 5% |
| **Signature placement accuracy** | Signatures landing exactly where intended, across devices. | 100%, no exceptions |
| **Verification success** | Finished documents that pass an independent tamper check. | 100%, no exceptions |

The last two allow no tolerance. A signature in the wrong place or a document that fails verification is not a minor bug — it destroys trust in the product.

---
---

# PART 2 — Technical Detail

> Everything below is written for the product and engineering team. Non-technical readers can stop here — nothing after this point is needed to understand or approve the project.

## Core Domain Concept: The Envelope

The **envelope** is the aggregate root. All state, permissions, and lifecycle transitions hang off it.

```
   Envelope
     ├── Document(s)            the PDFs being signed
     ├── DocumentVersion(s)     a snapshot + fingerprint per signing round
     ├── Recipient(s)           who must act, in what order, with what role
     ├── Field(s)               what each recipient must fill, and where
     └── AuditEvent(s)          append-only, hash-chained record of everything
```

Rules that follow from this and MUST hold:

- An envelope in a terminal state (`COMPLETED`, `DECLINED`, `VOIDED`) is immutable. No new fields, recipients, or signatures.
- A field MUST belong to exactly one recipient. Shared fields are not supported and introduce ambiguity about who is attesting to what.
- Deleting a recipient with completed fields is forbidden. Void the envelope and start again.
- Every state transition MUST emit exactly one audit event, written in the same database transaction as the state change. An untracked transition is a defect.

## Personas — Technical Implications

| Persona | Auth model | Access scope | Notes |
|---|---|---|---|
| Sender | Session / JWT, account required | Own envelopes within tenant | Frequent user; optimise for keyboard and repetition |
| Signer | Opaque single-use token, **no account** | One envelope, own fields only | Untrusted client; assume hostile input, poor network, old mobile browsers |
| Admin | Session / JWT + elevated role | Whole tenant | Manages templates, retention, branding, users |
| Auditor | Read-only export, or no access at all | Audit trail export | Primary artifact is the certificate page inside the PDF — must be self-sufficient |

The signer being unauthenticated is the defining security constraint of the system. It drives the token design in [10-security-and-threat-model.md](10-security-and-threat-model.md).

## Functional Requirements

### Envelope Management

| ID | Requirement | Priority |
|---|---|---|
| ENV-01 | System MUST accept PDF uploads up to 25 MB and 500 pages | Must |
| ENV-02 | System MUST support multiple documents per envelope, signed as one unit | Must |
| ENV-03 | System MUST compute and store a SHA-256 fingerprint on upload, before any mutation | Must |
| ENV-04 | System MUST support both sequential and parallel routing | Must |
| ENV-05 | System MUST support envelope expiry with a configurable default | Must |
| ENV-06 | Sender MUST be able to void a non-terminal envelope, invalidating all outstanding tokens immediately | Must |
| ENV-07 | System SHOULD support saving an envelope as a reusable template | Should |
| ENV-08 | System SHOULD support bulk send — one template, many recipients, one envelope each | Should |
| ENV-09 | System MAY support envelope correction (amend and resend without losing history) | May |

### Recipients and Roles

| ID | Requirement | Priority |
|---|---|---|
| REC-01 | System MUST support roles: `SIGNER`, `APPROVER`, `VIEWER`, `CC` | Must |
| REC-02 | Recipients MUST be able to complete their action without an account | Must |
| REC-03 | System MUST support a routing order integer; equal values sign in parallel | Must |
| REC-04 | Recipient MUST be able to decline, with a required reason, terminating the envelope | Must |
| REC-05 | System MUST record consent-to-electronic-signing with the verbatim disclosure text shown | Must |
| REC-06 | System SHOULD support optional SMS OTP as a second factor before signing | Should |
| REC-07 | System SHOULD support delegation — a recipient reassigning to someone else, fully audited | Should |
| REC-08 | System SHOULD support in-person signing, where the sender hosts the session on their own device | Should |

REC-05 is a legal requirement, not a nicety. Storing the disclosure text verbatim — rather than a reference to a template that may later change — is what makes consent defensible years afterwards. See [07-compliance-layer.md](07-compliance-layer.md).

### Fields

| ID | Requirement | Priority |
|---|---|---|
| FLD-01 | System MUST support field types: `SIGNATURE`, `INITIALS`, `DATE_SIGNED`, `TEXT_INPUT`, `CHECKBOX` | Must |
| FLD-02 | Field position MUST be stored as normalised ratios in `[0.0, 1.0]`, never pixels | Must |
| FLD-03 | Every field MUST be assigned to exactly one recipient | Must |
| FLD-04 | System MUST enforce required-field completion before allowing finish | Must |
| FLD-05 | `DATE_SIGNED` MUST be system-generated at signing time, never user-editable | Must |
| FLD-06 | System SHOULD colour-code fields per recipient in the placement UI | Should |
| FLD-07 | System MAY support conditional fields shown based on another field's value | May |

FLD-02 is non-negotiable and is the reason signatures land correctly across devices. Rationale and mathematics in [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md).

FLD-05 exists because a user-editable signing date is worthless as evidence.

### Signing and Sealing

| ID | Requirement | Priority |
|---|---|---|
| SGN-01 | System MUST support freehand signature capture with curve smoothing | Must |
| SGN-02 | System MUST support typed signatures rendered in a script typeface | Must |
| SGN-03 | Signature images MUST be captured at 2–3× device pixel ratio for print fidelity | Must |
| SGN-04 | Signatures MUST be burned into page content, not added as annotations or form fields | Must |
| SGN-05 | System MUST preserve signature aspect ratio when fitting into the field box | Must |
| SGN-06 | System MUST create a new `DocumentVersion` with its own fingerprint per signing round | Must |
| SGN-07 | System MUST append a Certificate of Completion page on completion | Must |
| SGN-08 | Final sealed document MUST be written to write-once storage | Must |
| SGN-09 | System MUST expose independent verification of any sealed document | Must |

SGN-04 matters legally: an annotation can be removed by any PDF editor without disturbing the page, which undermines the claim that the signature is part of the document.

SGN-05 and SGN-06 are the two documented fixes to the reference specification. Both are detailed with worked examples in [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md).

### Audit and Verification

| ID | Requirement | Priority |
|---|---|---|
| AUD-01 | Every state transition MUST emit an audit event in the same transaction | Must |
| AUD-02 | Audit events MUST capture IP address, user agent, and UTC timestamp | Must |
| AUD-03 | Audit table MUST be append-only — no UPDATE, no DELETE, enforced at the database layer | Must |
| AUD-04 | Audit events MUST be hash-chained so tampering with the log itself is detectable | Must |
| AUD-05 | Certificate of Completion MUST be readable without access to the platform | Must |
| AUD-06 | System MUST support audit trail export in a machine-readable format | Must |

### Integration

| ID | Requirement | Priority |
|---|---|---|
| API-01 | All web functionality MUST be available through a documented HTTP interface | Must |
| API-02 | System MUST support webhooks with HMAC-signed payloads | Must |
| API-03 | Envelope send MUST be idempotent via an idempotency key | Must |
| API-04 | System SHOULD publish an OpenAPI 3.1 specification | Should |

API-03 prevents the failure mode where a network retry sends the same contract to a client twice.

## Non-Functional Requirements

| Attribute | Target | Rationale |
|---|---|---|
| Signing page interactive | < 2.5s on 4G, mid-range Android | Signers are frequently on phones with poor signal |
| First PDF page rendered | < 1.5s | Perceived responsiveness of the signer experience |
| Sealing job completion | < 15s p95 for a 50-page document | Runs async on a worker; signer sees confirmation immediately |
| Envelope send throughput | 100/min sustained per tenant | Supports bulk send |
| Max document size | 25 MB, 500 pages | Above this, browser memory on mobile becomes the constraint |
| Availability | 99.5% MVP → 99.9% at scale | Signing is time-sensitive but not life-critical |
| RPO / RTO | 1 hour / 4 hours | Documents are durable in object storage; database is the recovery concern |
| Audit retention | 7 years default, configurable per tenant | Matches common statutory contract-retention periods |
| Browser support | Last 2 versions of Chrome, Safari, Firefox, Edge; iOS Safari 15+ | iOS Safari is the highest-risk target for canvas signature capture |

## Assumptions and Open Questions

**Assumptions made in this document:**

1. Tier 1 electronic signatures satisfy the client's legal requirements for the intended document types. If any target use case requires a qualified signature, the roadmap changes materially — see [02-feasibility-and-build-vs-buy.md](02-feasibility-and-build-vs-buy.md).
2. Documents arrive as PDFs. Office-format conversion is not in scope for v1.
3. Multi-tenancy is required from day one, since the platform may serve multiple client organisations.
4. English-only UI for v1, with the data model kept i18n-ready.

**Open questions requiring a decision before Sprint 3:**

| # | Question | Blocks |
|---|---|---|
| 1 | Which regions must documents be stored in? Any EU customers? | Infrastructure setup |
| 2 | Is SMS OTP required at launch, or deferred? | Sprint 5–6 scope, SMS provider contract |
| 3 | Default retention period and whether tenants can override it | Data model, retention job |
| 4 | Is per-tenant branding on emails and the signing page needed at launch? | Sprint 5–6 scope |
| 5 | Expected peak volume in year one | Infrastructure sizing, cost model |
