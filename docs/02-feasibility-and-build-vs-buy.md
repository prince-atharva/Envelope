# Feasibility, and Build vs Buy

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering and finance (Part 2) |
| **What this doc answers** | Can we actually build this, what must we buy, and is it cheaper than paying DocuSign? |

---

# PART 1 — In Plain Terms

## Can We Build This? Yes.

Let us answer the question directly rather than burying it.

**Yes. A small team can build this in about ten weeks, and it will work properly.**

This is not a research project or a gamble on unproven technology. Electronic signatures have existed for twenty-five years, the legal framework is settled, and every technical component we need is mature, free, and widely used. Nothing here requires inventing anything.

That said, it is not trivial either, and it is worth being precise about which parts are genuinely hard, because that is where the ten weeks actually go.

### The easy parts

Uploading files, storing them, sending emails, tracking status, building the dashboard — this is ordinary web development. Any competent team does it without drama.

### The genuinely hard parts

**Getting the signature in exactly the right place.** People sign on phones, tablets, laptops, and enormous monitors, at different zoom levels, in portrait and landscape. The signature has to land on precisely the same physical spot on the document every single time. There is also a subtlety that catches most teams out: screens and PDF files measure position from opposite corners of the page. Get it wrong and every signature appears mirrored onto the wrong half of the sheet. This is solvable, it is well understood, and it needs to be done carefully once. It is fully worked through in [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md).

**Making the proof genuinely hold up.** Anyone can paste a picture of a signature onto a PDF. What makes it a *product* is being able to prove, years later and to a hostile party, exactly who signed, when, from where, and that nothing changed afterwards. That takes disciplined design of the record-keeping, and it is the part that cannot be retrofitted — it has to be right from the first line of code.

**Working properly on phones.** Most people sign on phones. Drawing a signature with a fingertip on a small screen, on a bad connection, in a browser you cannot control, is where cheap implementations visibly fall apart. iPhone Safari in particular has long-standing quirks with drawing on screen that need specific handling and real device testing.

None of these are unknowns. They are known problems with known solutions, which is exactly what a ten-week estimate should be built on.

## What We Have To Buy

Almost everything we need is free and open source. The genuinely unavoidable purchases are small:

| What | Why we cannot build it | Rough cost |
|---|---|---|
| **Email delivery** | Sending email that reliably reaches inboxes rather than spam folders requires reputation with the big mail providers, built over years. This is bought, never built. | $10 – $50/month |
| **File storage** | Cheap and reliable, and not worth running ourselves. | $5 – $25/month |
| **Database hosting** | Same reasoning. | $25 – $120/month |

That is the entire list for the product as specified. Total running cost is covered in section 4 below.

**One thing we would need to buy later, if requirements change.** If the client ever needs the higher European *qualified* signature tier, or India's Aadhaar-based route, those require a contract with a licensed provider. You cannot self-issue government-recognised digital identities — that is the whole point of them. This is deferred deliberately, the system is designed so it can be added without rework, and the lead time on such a contract is measured in months, so it must be started early if it is ever needed.

## What We Build Ourselves

Everything that makes the product distinctive:

- The workflow — who signs, in what order, what happens when someone declines
- The drag-and-drop editor for placing signature boxes
- The signing experience recipients actually see
- The engine that puts the signature into the document and seals it
- The permanent record and the certificate page
- Independent verification of any finished document
- Templates, reminders, dashboards, and the connections to other software

## Build It, or Just Pay DocuSign?

The honest comparison. Three real options:

### Option A — Build it and run it yourself *(recommended)*

Ten weeks of development, then roughly $60 to $545 a month to run depending on volume.

You own it completely. Documents never leave your infrastructure. You can build exactly the workflow your business needs. Costs barely move as volume grows.

The trade-off: an upfront build, and you own the maintenance forever.

### Option B — Pay a commercial platform

Live in days rather than weeks. Nothing to maintain.

The trade-off: you pay for every document, forever. Your documents live on someone else's servers. You get their workflow, not yours. At high volume the bill becomes genuinely painful.

### Option C — Build the interface, pay someone else to do the signing

A middle road: your own interface, their signing engine underneath.

The trade-off: you get most of the cost and almost none of the benefit. You still pay per document, you still depend on them, and you have still built and must maintain software. This is usually the worst of both worlds.

### The numbers

| Documents per month | Build and run it | Commercial platform |
|---|---|---|
| 100 | ~$60 / month | ~$40 – $80 / month |
| 1,000 | ~$60 – $85 / month | ~$800 – $1,600 / month |
| 10,000 | ~$150 – $250 / month | ~$6,000 – $12,000 / month |
| 50,000 | ~$395 – $545 / month | ~$6,000 – $12,500 / month |

At very low volume, commercial platforms are perfectly reasonable and building your own is hard to justify on cost alone.

The lines cross at roughly **300 to 500 documents a month.** Past that, the gap widens fast — and past a few thousand a month it stops being a comparison at all. At 50,000 documents monthly you are weighing roughly **$6,000 a year against $75,000 to $150,000.**

### When you should choose the commercial platform instead

Being honest about this is more useful than selling you something:

- **You send fewer than 300 documents a month** and have no plans to grow. The savings will not repay the build.
- **You need it live in two weeks.** Ten weeks is ten weeks.
- **You need government-issued qualified signatures immediately.** That means a licensed provider contract with months of lead time, and a commercial platform has already done that work.
- **You have nobody to maintain it.** Software you own is software you must look after. Without a developer available, renting is genuinely the better choice.
- **You need deep integrations with a dozen enterprise systems on day one.** The big vendors have built hundreds of connectors over many years.

If none of those apply — and for a business at moderate volume with development capacity, they usually do not — building it is the better decision on cost, control, and data ownership together.

## What Could Go Wrong

| Risk | How likely | How bad | What we do about it |
|---|---|---|---|
| Signatures land in the wrong place on some device | Medium | Severe — destroys trust instantly | Solve positioning once, in one place in the code, in week 3. Test on real phones, not simulators. Automated tests across screen sizes. |
| iPhone Safari drawing problems | High | Moderate | Known issue with known workarounds. Budgeted for. Tested on real devices from week 5. |
| Client later needs qualified signatures | Low | High — months of lead time | Confirm at kickoff. System designed so it can be added later without rework. |
| Some documents legally need wet ink | Medium | Moderate | Documented in [07-compliance-layer.md](07-compliance-layer.md); the product can block those document types. |
| Emails going to spam | Medium | High — signers never see the link | Use a proper delivery provider from day one, configure sender authentication correctly in week 1. |
| Scope grows during the build | High | Moderate | Non-goals are written down in [01-product-requirements.md](01-product-requirements.md). Additions go on a list for after launch. |

## Before We Start

A short checklist. None of these are hard, but each blocks something if left:

- [ ] Confirm ordinary electronic signatures are sufficient — no qualified-signature requirement
- [ ] Confirm which countries' customers will use this
- [ ] Decide where documents must be stored geographically
- [ ] Have a lawyer in each target market confirm the approach
- [ ] Decide the retention period for completed documents
- [ ] Choose and set up an email delivery provider
- [ ] Agree the list of document types that must be blocked
- [ ] Agree who maintains this after launch

---
---

# PART 2 — Technical Detail

> Written for engineering and finance. Non-technical readers can stop here.

## Technical Feasibility Assessment

| Capability | Maturity | Library / approach | Risk |
|---|---|---|---|
| PDF rendering in browser | Very mature | `pdfjs-dist` (Mozilla, powers Firefox's PDF viewer) | Low |
| PDF mutation server-side | Mature | `pdf-lib` — pure JS, no native dependencies | Low |
| Signature capture | Mature | `signature_pad` — Bézier smoothing, variable width | Low, except iOS Safari touch handling |
| Image processing | Very mature | `sharp` — libvips bindings | Low |
| Fingerprinting | Standard | Node built-in `crypto`, SHA-256 | None |
| Coordinate normalisation | Custom | Documented in doc 06 | **Medium — highest-risk component** |
| Append-only audit with hash chain | Standard pattern | PostgreSQL + application-level chaining | Low |
| Write-once storage | Managed service | S3 Object Lock in compliance mode | Low |

The only medium-risk item is coordinate normalisation, and its risk is entirely about discipline rather than difficulty: the conversion must happen at exactly one place in the codebase. Scattered conversions drift, and drift produces misplaced signatures. Doc 06 specifies the single chokepoint.

## Build vs Buy — Component Analysis

**Must be procured (cannot be self-built):**

| Component | Reason | Options |
|---|---|---|
| Transactional email | Deliverability reputation is accrued, not engineered | Postmark, AWS SES, Resend |
| Object storage | Commodity; self-hosting is a false economy | AWS S3, Cloudflare R2, MinIO |
| Managed PostgreSQL | Same | Supabase, Neon, AWS RDS |
| SMS (if OTP required) | Carrier relationships | Twilio, AWS SNS |
| *Certificate Authority / QTSP* | **Legally impossible to self-issue.** Only for Tier 2. | eMudhra, NSDL, Entrust, GlobalSign |
| *Timestamp Authority* | Only for Tier 2 | DigiCert, Sectigo, FreeTSA |

**Built in-house:**

Envelope workflow state machine, field placement editor, signer portal, `PdfSealingService`, hash-chained audit trail, verification service, templates, webhooks, tenant management.

**Explicitly rejected:**

- *iText* for PDF manipulation — AGPL or paid commercial licence. Using it in a proprietary product without a commercial licence would require open-sourcing the whole application. `pdf-lib` is MIT and sufficient for Tier 1.
- *Building our own email infrastructure* — deliverability would be poor for years.
- *A custom PDF renderer* — `pdfjs-dist` is battle-tested by hundreds of millions of Firefox users.

## Cost Model

### Running costs

| Component | MVP (1k docs/mo) | Scale (50k docs/mo) |
|---|---|---|
| Compute (Vercel Pro / ECS Fargate) | $20 – $40 | $150 – $300 |
| PostgreSQL (Supabase Pro / RDS) | $25 | $120 |
| Redis (Upstash / ElastiCache) | $0 – $10 | $50 |
| Object storage (Cloudflare R2 — no egress fees) | $5 | $25 |
| Email (Postmark / SES) | $10 | $50 |
| **Total** | **$60 – $85 / month** | **$395 – $545 / month** |

Cloudflare R2 is specified deliberately: signed documents are downloaded repeatedly over their lifetime, and R2's zero egress pricing removes the cost that would otherwise grow with usage rather than storage.

### Commercial comparison

| Volume | Self-hosted / yr | DocuSign Business Pro (est.) | Annual saving |
|---|---|---|---|
| 1,000/mo | ~$900 | ~$10,000 – $20,000 | ~$9k – $19k |
| 10,000/mo | ~$2,400 | ~$70,000 – $140,000 | ~$68k – $138k |
| 50,000/mo | ~$5,600 | ~$75,000 – $150,000 | ~$70k – $145k |

Commercial pricing is indicative — enterprise contracts are negotiated and vary widely. The order of magnitude is reliable; treat exact figures as estimates.

### Break-even

Assuming a build cost of roughly 10 developer-weeks:

- At 1,000 docs/month: payback in approximately 4 to 8 months
- At 10,000 docs/month: payback in under 1 month
- Below ~300 docs/month: does not pay back on cost alone — justify on data ownership and control instead

## Tier 2 Escalation Path

If qualified signatures are ever required, the additions are:

1. **Provider contract** — QTSP (EU) or CCA-licensed CA / ESP (India). *Lead time: 2–4 months.* This dominates the schedule and must start first.
2. **Key custody** — HSM or cloud KMS. FIPS 140-2 Level 3 for qualified signatures. $1,000–$5,000/month for managed HSM.
3. **Timestamp authority** — RFC 3161 provider, ~$0.01–0.10 per timestamp.
4. **Signing service** — `pdf-lib` cannot produce PAdES B-LTA. Options: `@signpdf`, or an isolated Python (`pyHanko`) or Java (EU DSS) microservice. See [04-technology-stack.md](04-technology-stack.md).
5. **Long-term validation** — embedding revocation data and document timestamps so signatures still verify after certificates expire.

Estimated additional effort: 6–10 weeks of engineering, plus the procurement lead time, plus $1k–6k/month ongoing.

The architecture in [03-architecture.md](03-architecture.md) isolates the signing service specifically so this can be swapped in without touching the rest of the system.
