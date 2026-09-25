# Phase 6: Compliance Plan

| | |
|---|---|
| **Status** | In progress. Built as `v0.6.0` |
| **Version** | 1.0.0 |
| **Last updated** | 25 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 6 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 6 Is

Doc 16 split doc 11's "Hardening" block into three phases. Phase 5 (docs/16) covered everything
that happens to a document after it is sent. Phase 6 answers the questions a compliance officer or
a lawyer asks about it:

```
   WHICH RULES APPLIED? ──► frozen onto every envelope the moment it is created, so a later
                             policy change can never retroactively alter what an already-signed
                             envelope claims to have complied with
   WHO CAN DO WHAT? ───────► roles enforced: a MEMBER manages their own documents; an ADMIN or
                              OWNER manages the whole tenant's
   HOW LONG DO WE KEEP IT? ► drafts and cancelled documents are purged on a schedule; legal hold
                              stops the clock; the audit trail itself is never deleted
   CAN YOU PROVE IT? ──────► the audit trail exports as a file anyone can re-verify without this
                              platform
```

Doc 16 originally scoped Phase 6 as "Compliance and Integrations" together. That bundle turned out
to be roughly two phases: the integration half — API keys, webhooks, delegation, in-person signing,
and the HealthProHub embed SDK — needs design documents that do not exist yet (`docs/README.md`
says as much for the embed SDK specifically). **This document covers compliance only.**
Integrations become Phase 6b, once they have a plan of their own.

## What You Can Do at the End of Phase 6

1. **Pick a document category** when you create an envelope. A category the jurisdiction blocks —
   a will, a property transfer — is refused immediately, naming both the category and the
   jurisdiction, before the file is even stored.
2. **The rules that applied are frozen** onto every envelope at creation: the jurisdiction, the
   consent wording shown, and how long it will be kept. Nothing that happens later — an
   administrator changing the tenant's default jurisdiction, a new software release — can change
   what an already-created envelope claims to have complied with.
3. **Roles.** Invite a colleague as a member, an admin, or another owner from **Settings → Users**.
   A member manages only the documents they send; an admin or owner manages every document in the
   workspace, and can place a legal hold, purge, and export the audit trail.
4. **Legal hold.** Put a document on hold from its page, with a reason. Nothing about it can be
   cancelled, extended, or purged until the hold is released — both placing and releasing one are
   recorded.
5. **Retention.** An unsent draft nobody has touched in 90 days, or a cancelled or declined
   document a year old, has its file quietly removed; the record that it existed, and everything
   that happened to it, stays. A completed, signed document is retained for its jurisdiction's
   policy — seven years by default — and is never deleted early: it is locked against deletion at
   the storage layer the moment it is sealed (Phase 4).
6. **Export the audit trail** for any document, as a JSON file with every event's tamper-evident
   hash included, so it can be checked again later without this platform at all — or as a plain CSV
   for a human reader.
7. **An expired large-file download link can ask for a new one**, instead of a dead end.

## The Phase 6 Finish Line

- [x] A document creation naming a blocked category is refused, citing the category and the
      jurisdiction.
- [x] An envelope's frozen policy never changes after creation, even if the reference policy it was
      resolved from is edited afterwards.
- [x] A MEMBER sees and manages only the envelopes they own; cancelling or extending someone else's
      is refused.
- [x] A legal hold blocks cancel, extend and purge until released; both are audit events.
- [x] The retention sweeper removes an old draft's or a cancelled envelope's file, but never its
      audit trail, and never a sealed document under Object Lock.
- [x] An audit export's JSON re-verifies with the same algorithm the nightly chain check uses.
- [x] An expired download link can be renewed, once a day.
- [ ] Cross-tenant isolation test suite, table-driven over every route.
- [ ] `docs/11` and `CHANGELOG.md` updated; release tagged `v0.6.0`.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Legal review of the reference jurisdiction policies (`packages/shared/src/jurisdiction.ts`) and blocked-category defaults | They are engineering's best-effort reading of doc 07, marked "requires legal confirmation" throughout | Before real use |
| The ESIGN/consent disclosure text, per jurisdiction, approved by counsel | Still the same DRAFT placeholder carried from Phase 3, now shown for every jurisdiction rather than only `US` | Before real use |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Compliance only. Integrations (API keys, webhooks, delegation, in-person signing, the HealthProHub embed SDK) move to Phase 6b, pending their own design docs |
| Where jurisdiction policies live | Versioned code (`packages/shared/src/jurisdiction.ts`), never a database table — see ADR 0011 |
| What "frozen" means | The complete resolved policy, not a pointer to it, on `Envelope.policySnapshot` |
| What retention deletes | Storage objects (and pseudonymises recipient PII). Never the audit trail, never a sealed document under Object Lock — see ADR 0014 |
| Consent shown to every jurisdiction, regardless of `consentRequired` | Showing more protection than the law strictly requires is never wrong, and it means a wrong or stale `consentRequired` value can never accidentally skip a required consent |
| Role staleness | A role is baked into the access token at issue time, the same as tenant id; a change takes effect within one access-token lifetime (≤15 minutes), propagated automatically by the existing proactive refresh |
| "Parallel routing alongside sequential" (doc 11) | Already built in Phase 3 — `currentRoutingGroup()` implements "everyone at once" and the sender already chooses it. The remaining gap was *mixed* routing (equal `routingOrder` inside a sequential envelope); see step 11 |

## ADRs Written in This Phase

- [ADR 0011](adr/0011-freeze-jurisdiction-policy-at-envelope-creation.md) — Freeze jurisdiction
  policy at envelope creation
- [ADR 0014](adr/0014-retention-purges-document-bodies-not-the-audit-chain.md) — Retention purges
  document bodies, not the audit chain

## Steps

| # | Step | Status |
|---|---|---|
| 0 | This plan, ADR 0011, ADR 0014 | ✅ Done |
| 1 | Shared: jurisdiction policies, document categories, error codes, role helpers | ✅ Done |
| 2 | Database: tenant jurisdiction, policy snapshot, category, legal hold and purge columns | ✅ Done |
| 3 | Resolve and freeze the policy at creation; consent text reads the snapshot | ✅ Done |
| 4 | Blocked document categories, refused with the category and the jurisdiction named | ✅ Done |
| 5 | Roles enforced: claims, guard, and MEMBER scoping | ✅ Done |
| 6 | Settings → Users: invite, change role, remove | ✅ Done |
| 7 | Legal hold: API, audit events, and the envelope page control | ✅ Done |
| 8 | The retention sweeper | ✅ Done |
| 9 | Audit export, re-verifiable offline | ✅ Done |
| 10 | Renewable download links | ✅ Done |
| 11 | Mixed routing: parallel groups inside a sequential envelope | ✅ Done |
| 12 | The `AuditTrail` partitioning decision | ✅ Done (deferred; see ADR 0014) |
| 13 | Tests: the finish line, including cross-tenant isolation | ⏳ In progress |
| 14 | Documentation and release `v0.6.0` | ⏳ In progress |

## Step 1: Shared Contracts

`packages/shared/src/jurisdiction.ts` — `JurisdictionPolicy`, the four reference configurations
(`US`, `EU`, `IN`, `UK`) from doc 07, `resolvePolicySnapshot()` and `isCategoryBlocked()`.
`document-categories.ts` — the twelve categories a sender may pick, six of them blocked by default
pending legal confirmation. `errors.ts` gained `FORBIDDEN_ROLE`, `LAST_OWNER`,
`ENVELOPE_ON_LEGAL_HOLD`, `ENVELOPE_PURGED` and `DOWNLOAD_RENEW_TOO_SOON`; `DOCUMENT_CATEGORY_BLOCKED`
already existed, unused, and is now wired up. `auth.ts` gained `ROLE_RANK` and `hasAtLeast()`, the
one ordering the guard and the web app both read. `audit-export.ts` and `download.ts` hold the new
response shapes; `limits.ts` gained the retention windows.

## Step 2: Database

One migration, `20260925091256_phase6_compliance`: `Tenant.jurisdictionCode`;
`Envelope.documentCategory`, `.policySnapshot`, `.policyVersion`, `.legalHoldAt`,
`.legalHoldReason`, `.legalHoldByUserId`, `.purgedAt`; `CompletionDownload.lastRenewedAt`. Every
pre-existing envelope is backfilled with the `US` v1 snapshot in the same migration, so
`policySnapshot` is never null for a row that predates this phase. A hand-written partial index,
`Envelope_retention_candidates_idx` on `(status, updatedAt)` excluding held and already-purged
rows, is the sweeper's own working set — the same pattern as the Phase 5 attention index.
`retentionDueAt` deliberately has **no** stored column: it is computed at read time from status,
timestamps and the frozen policy (`envelopes.service.ts#retentionDueAt`), so a draft edit or an
extension never needs to remember to keep a second column in sync.

## Step 3: Freeze the Policy

`apps/api/src/compliance/jurisdiction.service.ts` resolves the tenant's default (or the sender's
per-envelope override) and freezes it onto the envelope in `EnvelopesService.create()`, before the
PDF is even validated. `ENVELOPE_CREATED`'s audit metadata gains `jurisdictionCode` and
`policyVersion`. `signing/consent-text.ts` reads the frozen snapshot instead of a live map.

## Step 4: Blocked Categories

`JurisdictionService.assertCategoryAllowed()` throws `DOCUMENT_CATEGORY_BLOCKED` naming both the
category and the jurisdiction, per doc 07's explicit requirement, before any file is stored.

## Step 5: Roles Enforced

`role` travels in the access token's claims (`AccessTokenClaims`, `AuthenticatedUser`), set by
`JwtAuthGuard`. `auth/roles.decorator.ts` (`@Roles(minimum)`) and `auth/roles.guard.ts`
(`RolesGuard`, a second `APP_GUARD` registered directly after `JwtAuthGuard` in `AuthModule`, so it
can read `req.user`) enforce it; an unmarked route is unchanged from before this phase. A MEMBER's
visibility is scoped in `EnvelopesService` (list, counts, get) via an `ownerId` filter threaded
through `envelope-views.ts`; a MEMBER viewing another owner's envelope sees `NOT_FOUND`, the same
answer a different tenant's envelope already gave, not a `FORBIDDEN_ROLE` that would confirm it
exists. Cancel, extend and reminders (the lifecycle routes doc 03 already said were "sender or
admin") gate on ownership via `auth/ownership.ts#assertCanManage()`, answering `FORBIDDEN_ROLE`
there instead, since those routes are reached from a document a MEMBER can already see is theirs
to act on or not.

## Step 6: Settings → Users

`GET/POST /users`, `PATCH /users/:id/role`, `DELETE /users/:id` — OWNER only. An owner cannot
demote or remove the tenant's last owner (`LAST_OWNER`). New audit actions `USER_INVITED`,
`USER_ROLE_CHANGED`, `USER_REMOVED`; a new `invitation` email template. The web app's `/settings/users`
route sits under `RequireAuth`/`AppShell`, with a `RequireRole` guard alongside the existing ones.

## Step 7: Legal Hold

`POST /envelopes/:id/legal-hold` and `DELETE` of the same — ADMIN or OWNER. `LEGAL_HOLD_PLACED` and
`LEGAL_HOLD_RELEASED` are audited; the reason itself stays out of the audit metadata, the same
treatment a void reason already gets. Cancel and extend both refuse with `ENVELOPE_ON_LEGAL_HOLD`
while a hold is active.

## Step 8: The Retention Sweeper

`maintenance/retention.service.ts`, registered the same four-edit way every maintenance job is:
the service, a schedule in `MaintenanceScheduler`, a case in `MaintenanceProcessor`, and the
provider in `MaintenanceModule`. Applies ADR 0014's rule exactly: deletes an unlocked draft or
voided/declined envelope's storage object and pseudonymises its recipients' names and emails;
never touches a sealed file (Object Lock forbids it) or any `AuditTrail` row. Held and
already-purged envelopes are excluded by the partial index itself, not filtered in application
code.

## Step 9: Audit Export

`GET /envelopes/:id/audit?format=json|csv` — ADMIN or OWNER, the path doc 08 already reserved.
Reuses `verifyChain()` and `canonicalJson()` from `audit/audit-chain.ts` unchanged, so the export
and the nightly chain check can never quietly disagree about what "valid" means. JSON is the
machine-readable, self-sufficient format (AUD-06); CSV is the same rows without the hashes, for a
human reader. The export itself is audited (`AUDIT_EXPORTED`).

## Step 10: Renewable Download Links

`POST /download/:token/renew` — public, rate-limited, modelled on the `request-more-time`
precedent: it works even on an already-expired link (renewal is the whole point), mints a fresh
token in the mail worker so the raw token never touches the API or Redis (ADR 0009), and is
limited to once per `DOWNLOAD_RENEW_COOLDOWN_HOURS`. `DOWNLOAD_LINK_RENEWED` is audited.

## Step 11: Mixed Routing

The routing core (`currentRoutingGroup()`) and the API (`routingOrderSchema`) already accepted tied
`routingOrder` values — the gap was that the builder's `moveRecipient()` only ever assigned a
strict `1..n`, making a tie unreachable from the UI. `recipient-order.ts` now allows two adjacent
recipients to share a position, with a control in `RecipientPanel` to pair them.

## Step 12: The Partitioning Decision

Recorded in ADR 0014: since retention still never deletes an `AuditTrail` row, monthly partitioning
(deferred in `docs/03`, pending a retention policy) buys no query-speed gain without a delete path
to justify it. The deferral stands; it would be revisited if an archiving strategy — moving old,
closed chains to cold storage rather than deleting them — were designed.

## Deliberate Simplifications

| Simplification | Planned fix |
|---|---|
| MEMBER ownership is enforced on cancel, extend and reminders (the lifecycle routes), and on list/detail visibility — not on every mutating route (draft edits, send, file download) | A MEMBER can still open or download a document they can see was sent by someone else via a direct link if they already have its id; broader field-level enforcement, Phase 6b |
| Jurisdiction policies are fixed reference data for four codes (`US`, `EU`, `IN`, `UK`), not a per-tenant custom policy builder | A real deployment ships its own values as the next `JURISDICTION_POLICY_VERSION`, same as consent text |
| A completed envelope past its policy's `retentionYears` is flagged, not automatically removed, because Object Lock makes early removal impossible and removal after the lock expires is an operational decision, not a nightly default | A follow-up if a deployment wants that automated |
| Consent is shown to every signer regardless of the resolved policy's `consentRequired` | Deliberate and permanent — see "Decisions Made Before Starting" above |
