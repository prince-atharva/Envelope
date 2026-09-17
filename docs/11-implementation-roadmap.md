# Implementation Roadmap

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering and project management (Part 2) |
| **What this doc answers** | What gets built when, what does it cost, and when can we see it working? |

---

# PART 1 — In Plain Terms

## Ten Weeks, Five Blocks

```
  WEEKS 1–2    FOUNDATION
               Upload a document and see it on screen.

  WEEKS 3–4    THE FIELD BUILDER
               Drag signature boxes onto pages and save them.

  WEEKS 5–6    THE SIGNING EXPERIENCE
               A signer opens a link and draws their signature.

  WEEKS 7–8    THE SEALING ENGINE          ◄── THE KEY MILESTONE
               The signature goes into the document, the certificate
               is added, and you get the finished file back.
               THE PRODUCT WORKS END TO END HERE.

  WEEKS 9–10   HARDENING
               Multiple signers in order, reminders, tested on real
               phones, security reviewed. Ready for customers.
```

**At the end of every block there is something real you can try.** Not a progress report — a working thing on a screen.

## What You Can See at Each Stage

### End of week 2 — "It knows what a document is"

Log in, upload a PDF, and see it displayed properly, page by page. That is all it does. It sounds modest, but everything else is built on top of it, and displaying PDFs correctly across browsers is genuinely fiddly.

### End of week 4 — "I can set up a document"

Upload a contract, add the people who need to sign, drag boxes onto the pages, and save. Nothing is sent yet, but the entire preparation side works.

**This is the first block worth demonstrating to anyone.** It is visual and it looks like the real product.

### End of week 6 — "Someone can actually sign"

Send a document. It arrives by email. Open the link on your phone, agree to the notice, draw your signature, tap Finish.

The signature is captured and stored but not yet placed into the document. Half the loop is closed.

### End of week 8 — "It works" ◄ the milestone that matters

Everything connects. Send a document, sign it, get the finished PDF back with the signature in exactly the right place and the certificate page on the back. Check the fingerprint yourself and confirm it matches.

**From this point the product is genuinely usable.** You could send a real contract to a real client. Weeks 9 and 10 make it robust enough to do that routinely.

### End of week 10 — "It is ready for customers"

Multiple signers in sequence. Reminders and deadlines. Decline handling. Tested on real iPhones and Android devices. Security reviewed. Cancellation, expiry, and every awkward edge case handled properly.

## What It Will Cost To Run

| Documents per month | Monthly running cost |
|---|---|
| 1,000 | **$60 – $85** |
| 10,000 | **$150 – $250** |
| 50,000 | **$395 – $545** |

Compare against a commercial platform at the same volumes:

| Documents per month | Build and run | Commercial platform | Annual saving |
|---|---|---|---|
| 1,000 | ~$900 / year | ~$10,000 – $20,000 / year | ~$9k – $19k |
| 10,000 | ~$2,400 / year | ~$70,000 – $140,000 / year | ~$68k – $138k |
| 50,000 | ~$5,600 / year | ~$75,000 – $150,000 / year | ~$70k – $145k |

The reason the gap widens is structural: commercial platforms charge per document sent, while infrastructure costs are driven by storage and computing, which barely move as volume grows.

## The Three Real Risks

Honest assessment, with what we do about each.

**1. Signatures landing in the wrong place on some device.**
The highest-severity thing that can go wrong, because it destroys client confidence instantly. We solve positioning once, in one place in the code, in week 3, and test it on real phones from week 5 rather than desktop simulations.

**2. Drawing problems on iPhones.**
A known, documented quirk in Apple's browser: the page can scroll under your finger while you draw. It has a known fix, it is budgeted for, and it is tested on a real device from week 5. The failure mode if missed is severe, because iPhone is the most common signing device.

**3. Scope growing during the build.**
The most likely thing to actually happen. What is in and out is written down in [01-product-requirements.md](01-product-requirements.md). New ideas go on a list for after launch rather than into the current ten weeks. Nobody is saying no to them — just not now.

## What We Need From You

To keep the timeline, these are needed at the times shown:

| When | What we need | Blocks |
|---|---|---|
| **Before week 1** | Confirmation that ordinary electronic signatures are sufficient | The entire approach — a qualified-signature requirement changes everything |
| **Before week 1** | Which countries your customers are in | Legal configuration |
| **Before week 1** | Where documents must be stored geographically | Infrastructure setup |
| **Week 2** | The exact wording of the electronic-signing notice, approved by your lawyer | The signing screen. **We must not write this text ourselves.** |
| **Week 2** | Your logo and brand colours | Emails and the signing page |
| **Week 4** | Which document types must be blocked | Legal configuration |
| **Week 6** | Two or three real (anonymised) documents for testing | Realistic testing |
| **Week 8** | People available to try it and give feedback | Fixing the right things in weeks 9–10 |

The week-2 item is the one that most often slips. Lawyers take time, and the signing screen cannot be finished without that text.

---
---

# PART 2 — Technical Detail

> Written for engineering and project management. Non-technical readers can stop here.

**Assumption:** one full-stack developer working full time. Two developers compresses this to roughly 6–7 weeks, but not to 5 — weeks 7–8 are on the critical path and are hard to parallelise.

## Sprint 1–2 — Foundation

**Goal:** a document can be uploaded, stored, fingerprinted, and rendered.

- [ ] Next.js + TypeScript repo; strict mode; ESLint/Prettier; GitHub Actions
- [ ] Docker Compose: Postgres, Redis, MinIO
- [ ] Prisma schema per [05-data-model.md](05-data-model.md); initial migration
- [ ] **Audit table privileges** — `REVOKE UPDATE, DELETE` verified in CI
- [ ] Auth for senders: Argon2id, session/JWT, tenant scoping middleware
- [ ] Upload endpoint with the full hardening pipeline (doc 10)
- [ ] SHA-256 fingerprinting; `DocumentVersion` 0 created on upload
- [ ] Object storage abstraction with region routing
- [ ] PDF.js viewer: high-DPI, responsive, page navigation, zoom
- [ ] SPF/DKIM/DMARC configured with the mail provider

**Exit criteria:** upload a 12-page PDF, see it rendered correctly at 100% and 200% on desktop and mobile, with version 0 and its hash persisted. Audit privileges verified in production configuration.

**Risks:** PDF.js worker configuration under the Next.js App Router is a known friction point — budget a day. Get email authentication done now; DNS propagation and reputation warm-up take time.

## Sprint 3–4 — Field Builder

**Goal:** fields can be placed and persisted as ratios.

- [ ] **`src/lib/coordinates.ts`** — the single chokepoint, with full unit tests, **written first**
- [ ] Overlay layer dimensionally locked to the PDF.js canvas
- [ ] Drag-and-drop palette: signature, initials, date, text, checkbox
- [ ] Resize handles, 4pt snapping, alignment guides
- [ ] Per-recipient colour coding, WCAG AA
- [ ] Recipient management: add, remove, roles, routing order
- [ ] Field persistence with server-side ratio validation
- [ ] **Zoom-independence test**: identical ratios at 100% and 200%
- [ ] Keyboard nudging and deletion
- [ ] Envelope composition and review screen

**Exit criteria:** place fields for two recipients across multiple pages, reload, and see them in identical positions. Ratios byte-identical across zoom levels. Coordinate unit tests green.

**Risks:** this sprint contains the highest-risk component in the project. `coordinates.ts` MUST be written and tested before the UI consumes it — retrofitting a chokepoint after conversions have scattered through components is far more expensive than establishing it up front.

## Sprint 5–6 — Signer Portal

**Goal:** a signer can open a link, consent, and submit a signature.

- [ ] Token minting: `randomBytes(32)`, HMAC-SHA256 storage, expiry
- [ ] Token Guardian: validation, single-use, revocation
- [ ] **Token redaction across logs, APM, and error reporting** — verified, not assumed
- [ ] `/sign/:token` route, unauthenticated, code-split
- [ ] Consent gate as a **server-side precondition**, storing verbatim text
- [ ] `signature_pad` capture at 2–3× DPR, transparent PNG
- [ ] Typed-signature alternative, equal prominence
- [ ] **iOS Safari touch handling** — `touch-action: none`, `preventDefault` on `touchmove`
- [ ] Guided field navigation ordered by page then vertical position
- [ ] `localStorage` draft persistence for connection loss
- [ ] Decline flow with required reason
- [ ] Invitation and reminder emails
- [ ] Telemetry capture: IP, user agent, timestamp
- [ ] **Playwright on real iOS Safari and Android Chrome**

**Exit criteria:** receive an email on a real iPhone, open it, consent, draw a signature, submit. Values persisted, token invalidated, audit events written. Zero tokens present in any log or trace.

**Risks:** iOS Safari canvas behaviour is the known hazard — test on hardware from day one of this sprint, not at the end. Deliverability problems surface here; if invitations land in spam, nothing else matters.

## Sprint 7–8 — Sealing Engine ◄ critical path

**Goal:** signatures are burned in, the certificate is appended, the document is sealed.

- [ ] `PdfSealingService.burnFields()` per [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md)
- [ ] **`fitPreservingAspect()`** applied to every signature — Correction 1
- [ ] **`DocumentVersion` per signing round** — Correction 2
- [ ] Rotation handling for `/Rotate 90 | 180 | 270`
- [ ] Per-page dimension reads (mixed page sizes)
- [ ] `sharp` trim plus metadata read
- [ ] Text fitting for date and text fields
- [ ] Certificate generator with multi-page overflow
- [ ] `sealFinal()` and `Envelope.finalHash` — Correction 3
- [ ] Sequential routing: advance to the next recipient on version creation
- [ ] BullMQ seal queue, **idempotent on `(envelopeId, versionNumber)`**
- [ ] S3 Object Lock on the final version only
- [ ] `POST /v1/verify`
- [ ] Completion emails with identical copies to all parties
- [ ] Integration tests: known image at known ratio, position asserted within tolerance

**Exit criteria:** end-to-end on a real device. Signature lands within 1pt of the intended position on a rotated page in a mixed-size document. Certificate lists the full version chain. `sha256sum` on the downloaded file matches `finalHash`. Three-signer sequential envelope produces a contiguous version chain.

**Risks:** the highest-complexity sprint. The three corrections are all implemented here and each has a plausible failure mode that passes single-signer testing — test with three signers before declaring the sprint done.

## Sprint 9–10 — Hardening

**Goal:** production-ready.

- [ ] Parallel routing alongside sequential
- [ ] Reminder scheduler and expiry sweeper
- [ ] Void flow with synchronous token invalidation
- [ ] Delegation and in-person signing
- [ ] Webhooks: HMAC signing, retry, redrive
- [ ] Sender dashboard sorted by "needs attention"
- [ ] `JurisdictionPolicy` resolution, frozen at envelope creation
- [ ] Blocked document category enforcement
- [ ] Retention sweeper with legal hold
- [ ] Nightly audit chain verification job with alerting
- [ ] Cross-tenant isolation test suite
- [ ] Rate limiting across all surfaces
- [ ] Accessibility audit: WCAG 2.2 AA, keyboard-only signing
- [ ] Full Playwright matrix on real devices
- [ ] Load test: 100 envelopes/min, 50-page seal p95 under 15s
- [ ] Penetration test and remediation
- [ ] Pre-launch security checklist (doc 10)
- [ ] Runbooks and on-call rota

**Exit criteria:** every checklist item in doc 10 complete. Load targets met. Accessibility audit passed. Penetration findings remediated.

## Critical Path

```
   coordinates.ts ──► field placement ──► signer capture ──► sealing ──► verification
     (wk 3)              (wk 3–4)            (wk 5–6)        (wk 7–8)      (wk 8)

   Parallelisable alongside:
     · auth and tenancy         (wk 1–2)
     · email templates          (wk 5–6)
     · dashboard                (wk 9)
     · webhooks                 (wk 9)
     · jurisdiction policy      (wk 9)
```

`coordinates.ts` gates everything downstream. It is small, it is the first thing built in sprint 3, and it is the highest-leverage code in the project.

## Risk Register

| # | Risk | P | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Coordinate drift → misplaced signatures | M | **Critical** | Single chokepoint; zoom-independence test in CI; real-device E2E | Eng |
| 2 | iOS Safari canvas failure | **H** | High | Known fix applied wk 5; real hardware testing | Eng |
| 3 | Scope creep | **H** | Medium | Non-goals documented; additions deferred to post-launch | PM |
| 4 | ESIGN disclosure text delayed | M | High | Requested week 2; blocks the consent gate | Client |
| 5 | Email deliverability | M | High | SPF/DKIM/DMARC in week 1; monitor bounce rates | Eng |
| 6 | Qualified signature required late | L | **Critical** | Confirmed at kickoff; 2–4 month procurement lead time | Client |
| 7 | Multi-signer version bug reaches production | M | High | Three-signer test is a sprint 7–8 exit criterion | Eng |
| 8 | Aspect-ratio distortion missed in review | M | Medium | `fitPreservingAspect()` unit-tested; visual regression test | Eng |
| 9 | Audit chain break undetected | L | **Critical** | Nightly verification job; P0 alerting | Eng |
| 10 | Load targets missed | L | Medium | Load test in sprint 9, leaving time to remediate | Eng |

Risks 1, 6, and 9 are rated critical because each undermines the product's core claim rather than merely degrading it.

## Go / No-Go Gates

| Gate | Criteria |
|---|---|
| **End sprint 2** | Upload → render works; audit privileges verified; email auth configured |
| **End sprint 4** | Zoom-independence test green; coordinate unit tests complete |
| **End sprint 6** | Real-iPhone signing works; zero token leakage in logs |
| **End sprint 8** | **Three-signer end-to-end; position within 1pt; `sha256sum` matches** |
| **End sprint 10** | Security checklist complete; penetration findings remediated; accessibility passed |

The sprint 8 gate is the one that matters. If it does not pass, weeks 9–10 are spent fixing it, and launch moves rather than the standard dropping.

## Infrastructure Costs

| Component | MVP (1k/mo) | Scale (50k/mo) |
|---|---|---|
| Compute (Vercel Pro / ECS Fargate) | $20 – $40 | $150 – $300 |
| PostgreSQL (Supabase Pro / RDS) | $25 | $120 |
| Redis (Upstash / ElastiCache) | $0 – $10 | $50 |
| Object storage (Cloudflare R2) | $5 | $25 |
| Email (Postmark / SES) | $10 | $50 |
| **Total** | **$60 – $85** | **$395 – $545** |

Cloudflare R2 is specified for zero egress fees — signed documents are downloaded repeatedly over a multi-year retention period, and egress on a conventional provider grows with usage rather than with storage.

Not included: malware scanning (~$20/mo managed), SMS if OTP is enabled (~$0.01/message), monitoring (free tier adequate at MVP scale).

## Post-Launch Backlog

Deferred deliberately, in rough priority order:

1. Templates and bulk send
2. OpenAPI specification and SDKs
3. SSO / SAML for enterprise tenants
4. Advanced reporting and analytics
5. Conditional fields
6. Payment collection at signing
7. Tier 2 qualified signatures (see [04-technology-stack.md](04-technology-stack.md))
8. Aadhaar eSign for India
9. Multi-region active-active deployment
10. SOC 2 Type II certification
