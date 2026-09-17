# Compliance Layer

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering and legal review (Part 2) |
| **What this doc answers** | What does the law require, and how does the system satisfy it? |

> **This is engineering analysis, not legal advice.** It describes how the platform is designed to meet legal requirements as we understand them. Before launching in any country, have a qualified lawyer in that jurisdiction review both this document and the running system.

---

# PART 1 — In Plain Terms

## The Three Questions the Law Asks

Electronic signature law across the world, in every major market, reduces to three questions. Get all three right and you have a binding signature. Miss one and you have a picture of a signature.

```
   1.  DID THEY MEAN TO SIGN?
       Not an accident, not a misclick. A deliberate act.

   2.  DID THEY AGREE TO DO THIS ELECTRONICALLY?
       Nobody can be forced onto a screen instead of paper.

   3.  CAN YOU PROVE NOTHING CHANGED SINCE?
       The document today must be the document they signed.
```

Everything below is about answering those three questions convincingly.

## Question 1 — Did They Mean To Sign?

Raj cannot sign by accident. He has to:

- Open a link addressed specifically to him
- Actively draw or type his signature
- Tap a button labelled **Adopt & Sign**
- Tap a second button labelled **Finish**

Four deliberate acts, each recorded with its exact time. That is meaningfully harder to do by accident than signing a paper someone slides across a desk.

## Question 2 — Did They Agree To Do This Electronically?

This is the requirement people miss, and in the United States it is not optional.

Before Raj can sign, he is shown a clear notice explaining that he is about to sign electronically rather than on paper, and he must tick a box to continue.

Here is the detail that makes it actually defensible, and it is worth understanding:

**We store the exact wording he was shown — word for word — not a reference to it.**

The difference matters enormously. If we merely recorded *"Raj agreed to disclosure template v3"*, and that template were later edited, we could no longer prove what he actually read. Storing the words themselves means that even if the notice changes next year, Raj's record still shows precisely what was on his screen on the day.

That is the difference between evidence and a claim.

## Question 3 — Can You Prove Nothing Changed?

Three layers, covered in detail in [00-how-it-works.md](00-how-it-works.md) and [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md):

- **The fingerprint** — any change at all produces a completely different code
- **The permanent record** — who did what, when, from where, in a log that cannot be edited
- **The one-way storage** — once the finished document is filed, nobody can alter it

## Where This Is Legally Valid

| Country / region | Status | What we rely on |
|---|---|---|
| **United States** | Binding since 2000 | Federal law gives electronic signatures the same force as ink for almost all business contracts. The consent notice is a hard requirement here. |
| **European Union** | Binding, explicitly admissible in court | Union-wide regulation. A signature cannot be rejected by a court simply for being electronic. |
| **United Kingdom** | Binding | Equivalent national rules, retained after leaving the EU. |
| **India** | Recognised | National law recognises electronic signatures. There is a separate government-backed route using Aadhaar for certain document types, which can be added later. |
| **Canada** | Binding | Federal and provincial legislation. |
| **Australia** | Binding | National electronic transactions legislation. |
| **Singapore** | Binding | National electronic transactions legislation. |
| **UAE** | Binding | National electronic transactions legislation. |
| **Brazil** | Binding with conditions | Recognised between parties who agree to it; some official filings need the government's own certificate scheme. |

## Two Limits, Stated Honestly

### Some documents still need ink

No electronic signature platform can change this. It is a limit of the law, not the technology.

Commonly excluded, though the exact list varies by country:

- **Wills and testamentary documents** — excluded nearly everywhere
- **Certain property transfers** — many countries require a notary or registration
- **Some family law documents** — adoption, divorce papers in various places
- **Certain negotiable instruments** — cheques, bills of exchange
- **Some court filings** — where a specific format is mandated
- **Certain notices** — eviction, utility disconnection, insurance cancellation in some US states

**What we do about it:** the platform lets an organisation mark document types as blocked, so nobody sends one of these by mistake. The list is configured per country. Agreeing on it is a kickoff task, and it needs your lawyer's input, not ours.

### Europe's higher tier is not included

The EU offers a top tier called a *qualified* signature, where each signer holds a government-recognised digital identity issued by a licensed provider. It carries automatic legal equivalence to a handwritten signature.

It is required only for a narrow set of cases — certain high-value or regulated transactions.

We have deliberately left it out, for reasons worth being clear about: it requires contracting a licensed provider, with a lead time measured in months and meaningful ongoing cost. For everyday business contracts it is genuinely unnecessary — the tier we are building is already binding and admissible.

The system is designed so it can be added later without rebuilding anything. If you think you might need it, say so at kickoff, because the provider contract is the long pole, not the software.

## Privacy

Separately from signature law, documents contain personal information, so privacy law applies too — the EU's GDPR, India's DPDP Act, and various US state laws.

The main points:

- **You control where documents are stored.** Choose a region, and they stay there. For EU customers this is a legal requirement and a genuine advantage over commercial platforms that route documents through their own infrastructure.
- **We collect only what the law requires us to record** — the details that make the signature provable.
- **Retention is configurable**, and defaults to seven years.

**One genuine tension worth explaining**, because it surprises people:

Privacy law gives individuals a right to have their data deleted. Contract law requires signed agreements to be retained. These conflict directly.

The resolution generally accepted is this: a person's *account* details can be deleted, but a *signed contract* usually cannot, because retaining it is itself a legal obligation — and a legal obligation is a lawful basis for keeping it. In practice we can remove someone from the system while preserving the signed documents they are party to.

This is a real conflict with a real answer, and it needs your lawyer's confirmation for your specific situation rather than a blanket assurance from us.

---
---

# PART 2 — Technical Detail

> Written for engineering and legal review. Non-technical readers can stop here.

## Requirements-to-Implementation Mapping

| Framework | Requirement | Implementation | Evidence stored |
|---|---|---|---|
| **ESIGN Act (US), 15 U.S.C. §7001** | Consumer consent to electronic records, with prior disclosure | Blocking consent modal before document access; verbatim text stored | `Recipient.consentText`, `consentGivenAt` |
| **ESIGN / UETA** | Intent to sign | Explicit *Adopt & Sign* then *Finish*, each audited | `AuditTrail` `CONSENT_GIVEN`, `RECIPIENT_SIGNED` |
| **ESIGN / UETA** | Signature attributable to the signer | Single-use token to a verified email; IP and user agent captured; optional SMS OTP | `Recipient.tokenHash`, `signedFromIp`, `signedFromUa` |
| **ESIGN / UETA** | Signature associated with the record | Signature burned into page content, not annotated | `DocumentVersion` chain |
| **ESIGN §101(c)** | Retention and accurate reproduction | Immutable sealed PDF; identical copies to all parties; Object Lock | `completedFileUrl`, `finalHash` |
| **eIDAS (EU) 910/2014, Art. 25** | Non-discrimination — cannot be denied legal effect for being electronic | Satisfied by producing a signature at minimum SES level | Full audit trail |
| **eIDAS Art. 26 (AES)** | Uniquely linked to the signatory | 256-bit single-use token to a verified address; optional OTP | `tokenHash`, `accessCode` |
| **eIDAS Art. 26 (AES)** | Capable of identifying the signatory | Email verification, IP/UA capture, optional SMS second factor | `Recipient.*` telemetry |
| **eIDAS Art. 26 (AES)** | Under the signatory's sole control | Single-use token, expiry, no shared credentials | `tokenUsedAt`, `tokenExpiresAt` |
| **eIDAS Art. 26 (AES)** | Detects any subsequent change | SHA-256 chain per version + hash-chained audit log | `DocumentVersion.hash`, `AuditTrail.eventHash` |
| **India IT Act 2000, §3A** | Electronic signature reliability | SES with full audit trail; Aadhaar eSign route available as a later addition | Full audit trail |
| **GDPR Art. 5, 17, 32** | Minimisation, erasure, security | Per-tenant region routing, encryption at rest and in transit, documented retention | `Envelope.jurisdictionCode` |

## Signature Assurance Tiers

| Tier | Standard | Requirements | Our support |
|---|---|---|---|
| **SES** — Simple | eIDAS Art. 3(10) | Data in electronic form used to sign | **Built. This is the product.** |
| **AES** — Advanced | eIDAS Art. 26 | Unique link, identification, sole control, tamper detection | **Substantially met** by the token model and hash chain. Legal confirmation required per use case. |
| **QES** — Qualified | eIDAS Art. 3(12) | AES + qualified certificate from a QTSP + a qualified signature creation device | **Not built.** Designed for; see doc 04 escalation path. |

The AES claim is worth stating carefully. The four Article 26 criteria are functional, not prescriptive — they do not mandate certificates. A well-designed token-and-audit system can satisfy them. Whether a specific implementation does is ultimately a legal determination, not an engineering one, so the docs claim *substantially met, pending legal confirmation* rather than asserting AES compliance outright.

## JurisdictionPolicy

Resolved per tenant, overridable per envelope, via `Envelope.jurisdictionCode`.

```typescript
export interface JurisdictionPolicy {
  code: string;                          // ISO 3166-1 alpha-2, or 'EU'

  permittedTiers: ('SES' | 'AES' | 'QES')[];
  minimumIdentityAssurance: 'EMAIL' | 'EMAIL_OTP' | 'ID_VERIFIED';

  // ESIGN and equivalents. Stored verbatim on consent.
  consentRequired: boolean;
  consentDisclosureText: string;

  retentionYears: number;
  dataResidencyRegion: string;           // 'eu-west-1', 'ap-south-1', ...

  requireTimestamp: boolean;             // Tier 2 only

  // Document categories that MUST NOT be sent electronically here.
  blockedDocumentCategories: string[];
}
```

Reference configurations:

| Code | Tiers | Identity | Consent | Retention | Residency |
|---|---|---|---|---|---|
| `US` | SES, AES | EMAIL | **Required** — ESIGN disclosure | 7y | `us-east-1` |
| `EU` | SES, AES | EMAIL_OTP | Recommended | 10y | `eu-west-1` |
| `IN` | SES, AES | EMAIL_OTP | Recommended | 8y | `ap-south-1` |
| `UK` | SES, AES | EMAIL | Recommended | 6y | `eu-west-2` |

Policy resolution MUST occur at envelope creation and be **frozen** onto the envelope. Resolving it dynamically at signing time means a later policy edit retroactively changes what an already-signed envelope claims to have complied with — which destroys its evidentiary value.

## Blocked Document Categories

Configurable per jurisdiction. Indicative defaults requiring legal confirmation:

| Category | US | EU | IN | Notes |
|---|---|---|---|---|
| Wills and testamentary | Blocked | Blocked | Blocked | Excluded essentially everywhere |
| Property transfer / conveyance | Blocked | Blocked | Blocked | Notarisation or registration typically required |
| Family law (adoption, divorce) | Blocked | Varies | Blocked | Jurisdiction-specific |
| Negotiable instruments | Blocked | Blocked | Blocked | Cheques, bills of exchange |
| Court filings | Varies | Varies | Varies | Often format-mandated |
| Utility / eviction / insurance cancellation notices | Varies by state | — | — | US state-specific carve-outs |

Enforcement: a required `documentCategory` on envelope creation, validated against the resolved policy. Rejection MUST cite the category and jurisdiction so the sender understands why.

## Consent Capture

```
   1. Recipient opens /sign/:token
   2. Token validated → ENVELOPE_VIEWED audited
   3. IF policy.consentRequired AND recipient.consentGivenAt IS NULL:
        → render blocking modal with policy.consentDisclosureText
        → document content is NOT accessible behind it
   4. Recipient ticks and continues
   5. Persist:
        consentText   = policy.consentDisclosureText   ← VERBATIM COPY
        consentGivenAt = now()
      → CONSENT_GIVEN audited with IP and user agent
   6. Document becomes accessible
```

**The critical detail is step 5.** Store the string, not a foreign key to a template. A template row can be edited or deleted; a stored string is what the person actually saw. This single decision is the difference between provable consent and an assertion about consent.

The ESIGN disclosure must also cover: the right to receive paper instead, how to withdraw consent and its consequences, whether consent covers one transaction or an ongoing relationship, how to request a paper copy and any fee, and the hardware and software needed to access the records.

## Data Residency

`JurisdictionPolicy.dataResidencyRegion` routes object storage and, at scale, the database.

| Requirement | Implementation |
|---|---|
| EU documents stay in the EU | Storage bucket selected per tenant region at write time |
| India DPDP | `ap-south-1` for `IN` tenants |
| No cross-region replication of document bodies | Replication is configured per bucket, never globally |
| Metadata may be centralised | Only if it carries no document content or personal data beyond identifiers — confirm with counsel |

This is a v1 architectural decision even though multi-region deployment is deferred. Retrofitting residency means migrating live signed documents across regions, which is materially harder and legally awkward.

## Retention vs Erasure

| Request | Response |
|---|---|
| Delete my account | Erase or pseudonymise the `User` record; **retain envelopes** under legal obligation |
| Delete a completed contract I signed | Refuse while a retention obligation subsists; explain the basis; log the request and the refusal |
| Delete a draft that was never sent | Honour it |
| Delete a voided envelope | Honour it after the shorter voided-retention window |
| Export my data | Honour it — envelope list, audit events, signed copies |

The lawful basis for retention is legal obligation (GDPR Art. 6(1)(c)) and, where applicable, establishment or defence of legal claims (Art. 17(3)(e)). Every erasure request and its outcome MUST itself be audited.

**Legal hold** overrides all retention. Both placing and releasing a hold are audit events.

## Compliance Checklist Before Launch

- [ ] Counsel review in every target jurisdiction
- [ ] ESIGN disclosure text drafted and approved by counsel — not written by engineers
- [ ] Blocked document categories confirmed per jurisdiction
- [ ] Retention periods confirmed against sector-specific requirements
- [ ] Data residency confirmed with the client and configured
- [ ] Privacy policy and DPA published
- [ ] Sub-processor list published (email, storage, SMS providers)
- [ ] Erasure and export request procedures documented and tested
- [ ] Certificate of Completion reviewed by counsel for evidentiary sufficiency
- [ ] Audit trail export format confirmed as acceptable for disclosure
- [ ] Legal hold procedure documented and tested
