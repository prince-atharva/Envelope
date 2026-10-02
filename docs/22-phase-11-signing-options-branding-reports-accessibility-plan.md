# Phase 11: Signing Options, Branding, Reports and Accessibility Plan

| | |
|---|---|
| **Status** | Complete. Built and released as v0.12.0 |
| **Version** | 1.2.0 |
| **Last updated** | 2 October 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 11 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 11 Is

Phases 1 to 10 built a product that is complete for its main job: send a document, have it signed, seal
it, prove it. Phase 11 adds the signing options the specification lists but earlier phases skipped, makes
the product look like each customer's own, tells the workspace how well it is working, and checks that
people who use a keyboard or a screen reader can sign.

```
   A. DELEGATION ─────► A signer can pass their part to someone else, if the sender allowed it.
   B. IN-PERSON ──────► A sender hands their own device to a signer, for example at a front desk.
   C. BRANDING ───────► A workspace sets a logo and a colour; recipients see them.
   D. REPORTS ────────► How many were sent, how many finished, how fast, where people give up.
   E. ACCESSIBILITY ──► Every screen is checked by tools and by keyboard-only signing; the fixes land.
```

**Deliberately not in this phase:**

- **Production work.** No deployment, monitoring, hosting or release planning. Email stays on Gmail SMTP.
- **Several documents in one envelope** (ENV-02 in docs/01, a MUST). It was never built and was not
  recorded as deferred. The owner moved it to a later phase on 1 October 2026. See "Deferred" below.

## What You Can Do at the End of Phase 11

1. Tick "let signers pass this on" when sending. A signer then enters a name and an email; that person
   gets their own link, the old link stops working, and the sender is told.
2. Press "Sign in person" next to a person on a sent document. The page signs you out, the signer signs
   on your device, and the certificate says it was done in person and by whom.
3. Set a logo and colour in Settings. Invitations, reminders, completion emails, the signing page and the
   download page show them.
4. Open Reports (Owners and Admins) and see sent, completed, completion rate, time to first signature,
   and where signers drop off, for the last 7, 30 or 90 days or a range.
5. Sign a document with the keyboard alone, and rely on automated accessibility checks that run with the
   browser tests.

## The Phase 11 Finish Line

- [x] A sender can allow delegation when sending; a signer can pass their part on once; the old link says
  so; the delegate signs; the envelope completes; counts never include the passed-on row.
- [x] Delegation is refused when not allowed, to a second hop, and to someone already on the envelope.
- [x] A sender can host a signer in person; the emailed link stops working; the audit and certificate say
  in person and name the host; an API key or embedded session cannot start it.
- [x] Handing over signs the sender out of that browser and the dashboard is unreachable from it.
- [x] No raw token reaches a log, table or Redis key in the in-person flow (leak audit extended).
- [x] A workspace admin can set, replace and remove a logo and colour; unsafe images and low-contrast
  colours are refused; emails and the signing and download pages show the brand; the sealed PDF does not.
- [x] Reports match hand-computed numbers on seeded data, are limited to Owner/Admin and to the caller's
  workspace, and refuse a window over 366 days.
- [x] Axe reports no serious or critical violations on every listed screen, on desktop and both phones.
- [x] A full signing works with the keyboard only; signing controls are at least 44x44 px; reduced motion
  and 320 px reflow are honoured.
- [x] Existing tests pass without weakening any assertion; the known baseline failures are unchanged (the two Pixel 7 embed failures were seen again; the two iPhone clipboard tests were not rerun this phase).

## What We Need From You

| Needed | Why | When |
|---|---|---|
| A logo and brand colour to try | The email colour is still a placeholder (docs/11, week 2) | Before step 8 |
| A screen-reader pass on real devices (VoiceOver, TalkBack, NVDA) using the manual script | Automation cannot certify WCAG | After step 12 |
| One in-person run on a real tablet or phone | Hand-over is a physical flow | After step 5 |
| A branded email opened in a real inbox with a public `APP_URL` | Many mail clients block remote images | After step 7 |
| Go-ahead for step 0 (mask invitation links in logs) | It is outside this phase's modules | Before batch 1 |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Delegation, in-person signing, branding, reports, accessibility. Production work and several-documents-per-envelope are out (owner's call, 1 October 2026) |
| Delegation default | Off; the sender enables it in the Send dialog; frozen at send; not offered on template or bulk sends yet |
| Who can delegate | SIGNER or APPROVER with a link, once; a delegate cannot delegate again |
| Delegation model | New `Recipient` row; the delegator stays as `DELEGATED` history (ADR 0032) |
| In-person link | Minted in the request, returned once to the signed-in sender, UI only; `IN_PERSON_LINK_TTL_MINUTES` default 120 (ADR 0033) |
| Hand-over | Signs the sender out of that browser (ADR 0033) |
| Branding | Logo (PNG/JPEG, re-encoded) and accent colour on recipient-facing emails, signing page, end screens and download page; certificate and PDF unchanged (ADR 0034) |
| Reports | Owner/Admin only, live queries over existing columns, window up to 366 days |
| Accessibility proof | axe-core on every screen, keyboard-only signing, size checks, plus a manual pass by the owner (ADR 0035) |
| Build process | Two batches, each with its own verification run: steps 1 to 5, then steps 6 to 14. Release points are the owner's call |

## ADRs Written in This Phase

- [ADR 0032](adr/0032-delegate-by-adding-a-recipient-and-keeping-the-delegator-as-history.md): Delegate by adding a recipient and keeping the delegator as history
- [ADR 0033](adr/0033-mint-in-person-signing-links-in-the-request-and-end-the-hosts-session.md): Mint in-person signing links in the request and end the host's session on hand-over
- [ADR 0034](adr/0034-brand-recipient-facing-surfaces-with-a-workspace-logo-and-accent-colour.md): Brand recipient-facing surfaces with a workspace logo and accent colour
- [ADR 0035](adr/0035-gate-accessibility-with-axe-core-keyboard-only-and-device-size-checks.md): Gate accessibility with axe-core, keyboard-only and device-size checks

## Steps

| # | Step | Status |
|---|---|---|
| 0 | *(optional, needs the owner's OK)* Mask invitation links in logs | ✅ Done |
| 1 | Groundwork for delegation and in-person signing | ✅ Done |
| 2 | API: a signer passes a document on | ✅ Done |
| 3 | Web: pass it on, and the sender's switch | ✅ Done |
| 4 | API: host a signer in person | ✅ Done |
| 5 | Web: sign in person | ✅ Done |
| 6 | API: workspace logo and accent colour | ✅ Done |
| 7 | API: brand emails sent to recipients | ✅ Done |
| 8 | Web: branding settings and branded signing pages | ✅ Done |
| 9 | API: workspace signing numbers | ✅ Done |
| 10 | Web: Reports page | ✅ Done |
| 11 | Accessibility: harness and sender screens | ✅ Done |
| 12 | Accessibility: signing portal and public pages | ✅ Done |
| 13 | Tests: the finish line | ✅ Done |
| 14 | Documentation | ✅ Done |

Proposed commit subjects: `feat(api,shared): groundwork for delegation and in-person signing`,
`feat(api): let a signer pass a document to someone else`, `feat(web): pass to someone else, and the
sender's switch for it`, `feat(api): host a signer in person from the sender's session`, `feat(web): sign
in person on the sender's device`, `feat(api): workspace logo and accent colour`, `feat(api): brand emails
sent to recipients`, `feat(web): branding settings and a branded signing page`, `feat(api): signing and
completion numbers for a workspace`, `feat(web): Reports page`, `feat(web): accessibility audit harness and
fixes to the sender app`, `feat(web): accessible signing portal and public pages`, `test: cross-tenant, role
and token-leak checks for Phase 11`, `docs: Phase 11 built; record it across the docs`.

## Step 0: Mask invitation links in logs (optional)

Add `accept-invite` and `auth/invitations` to the `SIGNING_PATH` patterns in
`apps/api/src/logging/redact.ts` and `apps/web/src/lib/logger.ts`; extend their unit tests and
`token-leak` coverage. Open since docs/19. Needs the owner's go-ahead because it is outside this phase.

## Step 1: Groundwork for delegation and in-person signing

One additive migration (review the SQL; do not use the new enum value inside it):

- `RecipientStatus` gains `DELEGATED`.
- `Recipient`: `delegatedFromId` (self-relation), `delegatedAt`, `inPersonHostUserId` (to `User`), `inPersonStartedAt`.
- `Envelope`: `allowDelegation Boolean @default(false)`.

Shared (`packages/shared`): `delegateSchema {name, email}`; `SigningSession.allowDelegation` and
`SigningSession.inPerson`; `allowDelegation` on `sendEnvelopeSchema` and the envelope responses and the
integration contract (additive); error codes `DELEGATION_NOT_ALLOWED` (403) and `TOKEN_DELEGATED` (410),
reusing `RECIPIENT_EMAIL_TAKEN`; webhook event `recipient.delegated` (ADR 0018); audit actions
`RECIPIENT_DELEGATED` and `IN_PERSON_STARTED` in `apps/api/src/audit/audit.service.ts`. New env var
`IN_PERSON_LINK_TTL_MINUTES` (15 to 1440, default 120) in `env.schema.ts`, `.env.example`,
`apps/api/test/test-env.ts` and `apps/web/e2e/stack/stack.mjs`. No behaviour changes in this step.
Tests: schema and error-catalog unit tests; the drift tests regenerate `openapi.json` and `errors.md`.

## Step 2: API: a signer passes a document on

`POST /sign/:token/delegate`, public, under the signing routes' existing rate limit. One transaction:
resolve through `TokenGuardianService`, `lockOpenEnvelope`, check `allowDelegation`, role, that the
person has a link and is not already a delegate, and that the email is not on the envelope; create the
delegate (status `SENT`, same role, routing order, colour; `invitedAt` now); move the delegator's fields;
mark the delegator `DELEGATED`; write one `RECIPIENT_DELEGATED` audit row (ids only). After commit:
invitation to the delegate (new `delegated` kind in `renderSigningLinkEmail`), notices to the delegator
and the sender (pattern: `sender-notice.mailer.ts`), webhook, and deletion of the delegator's adopted
signature images. `checkSignerAccess` returns `TOKEN_DELEGATED` for the old link.

**Every place that lists recipient statuses must ignore `DELEGATED`** (about 25 files; start from
`grep -rnE "'SIGNED'|'DECLINED'|RecipientStatus"`): signing, envelope-views raw SQL, expiry sweep,
auto-reminder, retention, sealing, cancel and extend, sender-notice, `packages/shared` helpers and the web
progress and dashboard code. The certificate gains one "Delegated by ..." line
(`sealing/certificate.ts`; check `certificate-extract.test.ts`). Logging: `Recipient delegated` with the
envelope and both recipient ids; emails through `maskEmail`.

Tests: `apps/api/test/delegation.e2e.test.ts` (off and on, single hop, fields moved, old link 410, counts,
sequential order, cancel, expiry, reminders, audit chain still verifies, three emails, webhook, certificate
line, cross-tenant 404); unit tests per changed query.

## Step 3: Web: pass it on, and the sender's switch

"Pass to someone else" in `SigningWorkspace` (only when `allowDelegation`) with a dialog, end-screen
states in `features/signing/end-states.ts` and `EndScreen.tsx`, a checkbox in
`features/sending/SendDialog.tsx`, and "Passed to ..." and "Delegated by ..." in `RecipientProgress.tsx`.
Search `apps/web/e2e` before touching any existing text. Tests: component and state unit tests, plus a
browser spec for the signer flow.

## Step 4: API: host a signer in person

`POST /envelopes/:id/recipients/:recipientId/in-person` on `SendingController` beside remind: same
authorisation as remind, `LIMITS.lifecycle`, not `@ApiKeyAllowed`, not `@EmbedAllowed`. Eligible: open
envelope, SIGNER or APPROVER, their turn, not finished. It mints with `mintSigningToken`, replaces any
emailed link, sets the host columns, writes `IN_PERSON_STARTED`, and returns `{ signingPath, expiresAt }`
with `Cache-Control: no-store`. `SigningLinkMailer`'s claim update clears the host columns.
`RECIPIENT_SIGNED` and `RECIPIENT_DECLINED` metadata carry `inPerson` and the host's id and name;
`signedFromIp` stays the host device's address and the certificate labels it. `SigningSession.inPerson`
carries the host's name. Logging: `In-person signing started` (envelope, recipient, host user id,
`tokenRef` only).

Tests: `apps/api/test/in-person.e2e.test.ts` (eligibility, replaced emailed link, expiry, audit and
certificate wording, API key and embed refused, leak audit extended in `token-leak.e2e.test.ts`).

## Step 5: Web: sign in person

"Sign in person" on the envelope page, a dialog that says the sender will be signed out, then
`useAuth().logout()` and navigation to the returned path (confirm there is no flash of the sign-in
page), a banner on the signing page, and a hand-back end screen with a "sign in" link. Tests: unit tests
and a browser spec proving the sender is signed out and the dashboard is unreachable from that browser.

## Step 6: API: workspace logo and accent colour

Additive migration: `Tenant.brandColor`, `brandLogoKey`, `brandLogoRef @unique`. Routes `GET` and `PATCH
/branding`, `PUT` and `DELETE /branding/logo` (`@Roles('ADMIN')`, new `LIMITS.branding`), public
`GET /branding/logo/:ref` (immutable cache, `nosniff`, fixed content type). Image handling follows
`apps/api/src/signing/signature-image.ts`: bytes must be PNG or JPEG, at most 512 KB, a pixel limit, `sharp`
re-encode to PNG fitted inside 480x160, metadata dropped; stored with `StorageService.put` and `delete`
under `branding/<tenantId>/`. The colour must be `#rrggbb` and reach 4.5:1 with white text; the contrast
helper lives in `packages/shared`. `SigningSession.brand` carries name, colour and logo URL. Tenant-admin
actions are structured logs, not audit rows. Tests: unit (contrast, SVG, oversize, pixel bomb,
metadata) and API e2e (upload, serve, replace, delete, role floor, cross-tenant).

## Step 7: API: brand emails sent to recipients

`layout()` and `button()` in `apps/api/src/mail/templates.ts` take an optional brand in place of the fixed
placeholder colour. Applied to signing-link, completion and recipient-facing void and expiry emails; the
mailers load the tenant with the envelope. Staff and account emails are unchanged. Tests: render tests in
`templates.test.ts` and the mailer tests.

## Step 8: Web: branding settings and branded signing pages

`SettingsBrandingPage` and a `SettingsNav` entry for Admin and Owner, with a live preview. The signing
shell, its end screens and the download page override the `--color-brand-*` theme variables that
`apps/web/src/styles/index.css` defines in `@theme` (confirm the override works at build time). Tests:
unit tests, a browser spec, gallery scenarios.

## Step 9: API: workspace signing numbers

`GET /reports/summary?from&to` (`@Roles('ADMIN')`, JWT only, new `LIMITS.reports`), tenant-scoped raw SQL
in the style of `apps/api/src/envelopes/envelope-views.ts`, window at most 366 days. Additive migration:
`@@index([tenantId, sentAt])` on `Envelope`.

| Metric | Definition |
|---|---|
| Sent, completed, declined, cancelled, expired, open | Envelopes with `sentAt` in the window, by current status |
| Completion rate | completed divided by sent, shown beside "still open" |
| Time to first signature | median and p90 of the first signer or approver `signedAt` minus `sentAt` |
| Time to complete | median of `completedAt` minus `sentAt` |
| Drop-off | per invited SIGNER or APPROVER (not `PENDING`, not `DELEGATED`): opened, consented, signed; declined shown separately |

Tests: `apps/api/test/reports.e2e.test.ts` with envelopes seeded across statuses and times.

## Step 10: Web: Reports page

`ReportsPage`, a sidebar entry for Owner and Admin, period picker, tiles, funnel bars and daily bars drawn
in SVG (no chart library). Read the `dataviz` skill before writing chart code. Tests: unit tests and a
browser spec.

## Step 11: Accessibility: harness and sender screens

Add the dev dependency `@axe-core/playwright`. `apps/web/e2e/accessibility.spec.ts` runs axe over every
sender-app screen and popup the gallery reaches, on desktop and both phone projects. Fix what it finds.
Known places to look first: dialog focus return, error-message association, muted-text contrast, headings
and landmarks. Never rename a visible label.

## Step 12: Accessibility: signing portal and public pages

Axe over the signing flow, Verify, download, accept-invite and the embedded editor. A keyboard-only signing
spec (typed signature, focus order, visible focus, live-region progress), a 44x44 px touch-target check, a
`prefers-reduced-motion` check and a 320 px reflow check. Look first at field labels such as "Signature
field, required, page 4 of 12" and a text alternative for the PDF canvas. Write the manual screen-reader
script (VoiceOver, TalkBack, NVDA) for the owner.

## Step 13: Tests: the finish line

Cross-tenant and role-floor tests for every new route, the in-person leak audit, regenerated
`openapi.json` and `errors.md`, and gallery scenarios for the new screens.

## Step 14: Documentation

This plan marked built with As Built notes; `As built` notes beside the affected sections of docs 01, 05, 08,
09, 10 and 11; `CHANGELOG.md` `[Unreleased]`; the docs index. No version bump, tag or release unless the
owner asks.

## As Built

All fifteen steps are built, reviewed, verified once on the whole tree, and committed one per step. The
code was written in one batch without per-step snapshots, so the per-step commits were cut afterwards, line
by line, from the finished tree; each commit was then checked to build on its own (lint, typecheck and unit
tests). Nothing in this phase is released: no version bump or tag.

Differences from the plan, and things the plan did not spell out:

- **Step 0 was done** at the owner's request ("complete all remaining code"): `accept-invite` and
  `auth/invitations` are masked in `apps/api/src/logging/redact.ts` and `apps/web/src/lib/logger.ts`, with unit
  tests. The `token-leak` e2e was not extended for it: a known gap, covered only by those unit tests.
- **One route the plan did not list:** `GET /download/:token/brand`, so the download page can wear the
  workspace look even when the link has expired. It reads no document and does not count as a download.
- **Brand data on the signing session.** `SigningSession.brand` is `{ name, color, logoUrl }`; the logo URL is
  a path on the site (`/api/v1/branding/logo/:ref`), made absolute only inside emails.
- **`LIMITS.branding` and `LIMITS.reports`** were added to the keyed rate limits (20 and 30 a minute per workspace).
- **Contrast is enforced twice.** The server refuses a colour below 4.5:1 with white (`packages/shared/src/branding.ts`),
  the settings page checks as you type, and the email templates re-check the stored colour before drawing it.
- **A branded look needs a colour or a logo.** A workspace with only a name keeps the product look.
- **Reports** define the window on `sentAt` in UTC days; "open" is SENT, DELIVERED or PARTIALLY_SIGNED; time to
  complete has a median only. The daily series is "sent per day". Charts are plain SVG and HTML bars; every
  number is also in a table under the charts.
- **`@axe-core/playwright`** was added to `apps/web` as a dev dependency (step 11), with the lockfile.
- **Accessibility fixes.** Muted text that used `text-slate-400` on light backgrounds is now `text-slate-600`;
  three `brand-600`, `emerald-600` and `amber-600` text uses darkened a step; the PDF canvas has a text
  alternative; the scrolling document area is focusable. The first axe run then found three more, fixed in
  steps 8 and 12: the zoom buttons were under 24 px (now larger), the branding preview's header text used
  `opacity-85` and fell below contrast, and the axe harness now waits for fade-in animations to finish before
  scanning (it read one half-way as low contrast on the iPhone project).
- **Review and verification findings fixed before the commits:** the in-person link field `signingPath` is
  redacted from logs; `hostOf` filters by tenant; a signer who passed their part on is left out of the
  envelope page's "Signers & Setup" card and of "Save as template" (API and web), with a test; the sealing
  helper's comment was moved back onto its function; `GET /download/:token/brand` has a positive-case test;
  the reports seed satisfies the table's check constraints; the 44 px test measures Start before the fields
  are filled and Finish after.
- **A real bug found by the iPhone run:** handing the device over briefly showed the sign-in page, because the
  app saw the sign-out and redirected before the page was replaced. `logout({ silent: true })` ends the session
  without telling the app, for this one caller, with a unit test. Desktop and Pixel only passed on timing.
- **Where things landed, against the plan:** the web `progress.ts` helper (the new status, `Passed to ...`) is in
  step 1, not 3, because the shared status type is exhaustive there and would not compile otherwise;
  `SigningSession.allowDelegation`, `.inPerson` and `.brand` arrive with steps 2, 4 and 6 (the code that
  fills them), not all in step 1. The openapi snapshot and the leak audit are in step 13 as planned.
- **Manual script:** [docs/23](23-accessibility-manual-test-script.md).
- **Gallery:** one new scenario, "signing options, branding and reports".
- **Known baseline, not from this phase:** the two Pixel 7 `embed.spec.ts` failures. Unit tests also time out
  (5 s) for two tests when the three workspaces' runners run in parallel (`pnpm test`); each passes alone in about
  1 s and all pass with `--workspace-concurrency=1`.
- **Still to do by hand:** every item under "What We Need From You" (logo and colour to try, real-device
  screen-reader pass, an in-person run on a tablet, a branded email in a real inbox).

## Deferred

- **Several documents in one envelope (ENV-02).** The envelope holds one PDF
  (`Envelope.originalFileUrl`, one `DocumentVersion` chain, a single-file upload) and that assumption
  appears in about 34 source files. Two designs were weighed. *One combined PDF*, joined at creation,
  keeps sealing, verify and the field builder as they are and records each original's name, page range
  and fingerprint on the certificate (about 4 steps). *Separate sealed PDFs* keep a version chain per
  document, like DocuSign, and change the schema, sealing, verify, completion emails, templates, bulk
  send, the embedded editor and the API (about 10 steps, on the highest-risk code). A later phase
  chooses.
- Production packaging, deployment, monitoring, backups and a live bounce check.

## Deliberate Simplifications

- Delegation is one hop, once, off by default, and not offered on template or bulk sends.
- In-person signing is web-only; handing the device back means the sender signs in again.
- Branding has no custom domain, no white-labelling of the product name, no certificate or PDF branding and no SVG logos.
- Reports have no CSV export, no per-user breakdown and no scheduling; they are live queries.
- Accessibility is automated checks plus a manual script; no formal conformance statement is produced.
- Still open from earlier phases: SMS OTP, SSO, conditional fields, passkeys, template editing, and the four
  baseline browser failures (iPhone clipboard x2, Pixel embed x2).

## Verification

Run once per batch (AGENTS.md section 5): `pnpm lint`, `pnpm typecheck`, `pnpm test`, API e2e on Node
22.19.0, browser e2e `desktop-chrome` plus `mobile-iphone14` and `mobile-pixel7` for signing and
accessibility, and `pnpm --filter @envelope/web ui:gallery` inspected for the new screens. Each rebuilt step
snapshot is checked to build alone before it is committed. Do not run other CPU work while the browser suite
runs.

### Results (2 October 2026)

On the final tree: `pnpm lint` and `pnpm typecheck` clean (the old `jurisdiction.test.ts` failure no longer
reproduces); unit tests shared 200, API 294, web 277, embed 41 (run one workspace at a time; see As Built);
API e2e on Node 22.19.0, 62 files and 478 tests; browser e2e `desktop-chrome` 67 passed; phones
(`mobile-iphone14`, `mobile-pixel7`) over the signing, delegation, in-person, branding, accessibility and embed
specs, 42 passed and the 2 known Pixel 7 embed failures; the in-person spec 18 of 18 across the three projects
after the sign-in-page fix. The gallery ran 47 of 48 scenarios on its first pass, the new one passing on desktop,
tablet and mobile; the one failure, the HealthProHub embedded editor on desktop, timed out waiting for the
iframe (15 s) during the full run and passed 3 of 3 alone. Its cause was not found; it is recorded here as an
unexplained intermittent, not as a pass.

Each of the fifteen commits was also checked on its own in a scratch worktree: lint, typecheck of all four
packages, and the shared, API and web unit tests.
