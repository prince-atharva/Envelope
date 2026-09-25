# 0011. Freeze Jurisdiction Policy at Envelope Creation

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Engineering

## Context

Doc 07 defines `JurisdictionPolicy`: which signature tiers are permitted, the identity assurance
required, whether consent is required and its exact disclosure text, how long to retain the
envelope, where its data must live, and which document categories cannot be sent electronically
there. Doc 07 states the rule directly: *"Policy resolution MUST occur at envelope creation and be
frozen onto the envelope. Resolving it dynamically at signing time means a later policy edit
retroactively changes what an already-signed envelope claims to have complied with — which
destroys its evidentiary value."*

This number was reserved for exactly this decision since doc 11's implementation roadmap (`docs/adr/README.md`, "Planned"), before Phase 6 existed to write it.

Two questions had to be settled to implement the rule:

1. **Where do policies themselves live?** A database table looks like the natural place for
   per-tenant configuration, but a CRUD surface over live policy rows would let anyone quietly
   change what an *already-signed* envelope claims to have complied with, by editing the row after
   the fact — undermining the very rule this ADR exists to satisfy. Doc 07's `JurisdictionPolicy`
   is also the kind of thing a lawyer signs off on, not something senders configure themselves.
2. **What "frozen" means concretely.** A pointer to a policy version is cheap but represents past
   evidence entirely through present-tense code, which is the ADR 0009 mistake (store a reference,
   not the fact) doc 07 explicitly warns against for consent text.

## Decision

We will resolve and freeze policy at envelope creation, before anything else happens:

- **Policies are versioned code, not a database table.** They live in
  `packages/shared/src/jurisdiction.ts` as `JURISDICTION_POLICIES`, agreed with counsel ahead of
  time and changed only by shipping a new `JURISDICTION_POLICY_VERSION`. There is deliberately no
  admin screen to edit a live policy.
- **Resolution order:** the envelope's own `jurisdictionCode` (a sender override for this one
  envelope) if given, otherwise the tenant's default (`Tenant.jurisdictionCode`).
- **The full resolved policy is frozen onto the envelope**, not a pointer to it:
  `Envelope.policySnapshot` (the complete `JurisdictionPolicy`, plus the version number and when
  it was resolved) and `Envelope.policyVersion`. Every later read — the consent notice shown to a
  signer, the blocked-category check, the retention period — reads the snapshot on the envelope,
  never the live table. This is the same evidentiary reasoning as `Recipient.consentText`: store
  the fact, not a reference to something that can move.
- **Blocked document categories are checked against the frozen snapshot at creation**, and the
  rejection names both the category and the jurisdiction (doc 07's requirement), before the file is
  even validated or stored.
- **Consent text comes from the snapshot.** `consentNoticeFor()` (`apps/api/src/signing/consent-text.ts`)
  no longer looks up a jurisdiction code against a live map; it hashes and returns the disclosure
  text the envelope already carries. `CONSENT_TEXT_IS_DRAFT` remains true: this ADR ships the
  freezing mechanism, not lawyer-approved wording.

## Consequences

**Easier:**

- An envelope's compliance record is self-contained: reading one row (plus its audit trail)
  answers "what rules applied when this was sent," with no join to a table that might since have
  changed or been deleted.
- A jurisdiction policy update (a new retention period, a newly blocked category) ships as an
  ordinary code release and only ever affects envelopes created afterwards.

**Harder:**

- Adding a jurisdiction, or correcting a mistake in one, means a code change and a release, not a
  configuration edit — deliberately, since a configuration edit is exactly what this ADR exists to
  prevent from happening silently.
- The frozen snapshot duplicates data that also exists in code at read time; the two can disagree
  once a policy is revised, which is the point, not a bug — an audit export surfaces the version
  that produced the snapshot precisely so that disagreement is legible rather than silent.

**Accepted:**

- Multi-tenant, per-tenant *custom* policies (beyond choosing among the reference jurisdictions)
  are out of scope. Doc 07's compliance checklist already treats every jurisdiction's exact figures
  as "indicative... requiring legal confirmation"; a real deployment ships its lawyer-approved
  values as the next `JURISDICTION_POLICY_VERSION`, the same as the consent text.
