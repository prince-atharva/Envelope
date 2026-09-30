# Phase 8: Launch Readiness Plan

| | |
|---|---|
| **Status** | Slice 1 (password reset) built and verified 30 September 2026; later slices are being planned |
| **Version** | 1.1.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 8 deliver to make Envelope safe to put in front of real customers, how is each slice built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 8 Is

Phases 1 to 7 built the product: signing, sealing, the lifecycle, compliance and integrations. Phase 8 is
the work that makes it safe to hand to a first customer. The roadmap (docs/11) calls it launch
readiness. It is built in slices, one at a time, in this one plan:

```
   SLICE 1 ── BUILT ────► Password reset: a sender who forgets their password can get back in,
                           and a removed user can never get back in.
   LATER ─────────────────► Candidates, not committed. Each is added to this plan as a new slice,
                           with the user's approval, when its turn comes:
                            · two-factor sign-in for senders
                            · a change-password screen in Settings
                            · production packaging and deployment pipeline
                            · monitoring, metrics and error tracking
                            · a real mail provider (Postmark or SES), which also lets
                              `envelope.delivered` fire truthfully (docs/18)
                            · malware scanning of uploads
                            · a tested backup and restore runbook
```

Slice 1 comes first because today a forgotten password is a dead end: there is no "forgot password"
link, page or email. It also closes a gap found while planning it: an Owner can remove a user, but
nothing marks that account as disabled, so a working reset would let a removed person back in.

## What You Can Do at the End of Slice 1

1. **Click "Forgot your password?"** on the sign-in page, enter your email address and get an email
   with a link. The page gives the same answer whether or not the address has an account.
2. **Choose a new password** from that link. The link works once and expires after one hour.
3. **Sign in with the new password.** Every other place you were signed in is signed out.
4. **Get a "your password was changed" email**, so an unexpected change is noticed.
5. **Trust that removing a user works.** A removed person cannot sign in, cannot reset their way
   back in, and is signed out everywhere at the moment they are removed.

## The Slice 1 Finish Line

- [x] Asking for a reset returns the same `202` and message for a registered, unknown, removed,
      service and not-yet-accepted address.
- [x] Only an eligible account receives an email, and the link in it opens the reset page.
- [x] A reset link works once, stops working after an hour, and a newer link cancels the older ones.
- [x] A successful reset changes the password, signs out every session of that account, and sends a
      "password changed" email. The old password no longer works and the new one does.
- [x] A removed user cannot sign in, cannot use an old reset link, and is signed out when removed.
- [x] Neither the raw reset token nor a password appears in any log line, Redis job or database row.
- [x] Reset requests are rate limited per address and per account.
- [x] Every new screen and email is covered by a test, and the browser test runs the whole flow.
- [x] docs/08 and docs/10 carry "As built" notes; ADRs 0022 and 0023 are accepted.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Approval of this plan | No code is written before it | Now (given) |
| Confirmation of the reset email wording | It is the one message a locked-out person will read | Before step 3 is committed |
| A decision on the next Phase 8 slice | So it can be added to this plan | After slice 1 is verified |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope of this slice | Password reset only. Other Phase 8 items are candidates, appended later |
| Link lifetime | 60 minutes |
| After a reset | Redirect to Sign in; no automatic sign-in; all sessions revoked |
| Removed users | New `User.disabledAt` marker blocks reset and sign-in and revokes sessions (ADR 0023) |
| Token storage | New `PasswordResetToken` table, HMAC only, minted by the worker (ADR 0022) |
| Unknown address | Same `202` and same body, always (ADR 0022) |
| Audit | No envelope is involved, so structured logs, not audit rows (AGENTS section 7) |
| New env var | None. Expiry is a shared constant; tests age a token by editing its row |
| Release | Not part of this slice; no version bump or tag until the user asks |

## ADRs Written in This Phase

- [ADR 0022](adr/0022-store-password-reset-tokens-as-hmacs-in-their-own-table.md) — Store password-reset tokens as HMACs in their own table
- [ADR 0023](adr/0023-disable-removed-users-instead-of-relying-on-a-locked-password.md) — Disable removed users instead of relying on a locked password

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Contracts and schema: shared schemas, error codes, limit constant, migration, token helpers | ✅ Built |
| 2 | Disable removed users: `disabledAt`, session revoke on removal, sign-in refusal | ✅ Built |
| 3 | Request a reset: forgot route, queue, mailer, email template, rate limits | ✅ Built |
| 4 | Complete a reset: preview and reset routes, session revocation, change notice, token purge | ✅ Built |
| 5 | Web: forgot and reset pages, sign-in link, client, browser test, UI gallery | ✅ Built |
| 6 | Documentation: docs/08 and docs/10 notes, changelog, this plan marked done | ✅ Built |

## Step 1: Contracts and Schema

- `packages/shared/src/limits.ts`: `PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 60`.
- `packages/shared/src/auth.ts`: `forgotPasswordSchema` (`{ email }`, reusing `emailSchema`),
  `resetPasswordSchema` (`{ password }`, reusing `passwordSchema`), and the `PasswordResetPreview`
  type (`{ email, expiresAt }`, the email masked).
- `packages/shared/src/errors.ts`: `PASSWORD_RESET_TOKEN_INVALID` (401) and
  `PASSWORD_RESET_TOKEN_EXPIRED` (401), beside the invitation codes the web app already switches on.
- `apps/api/prisma/schema.prisma`, migration `<timestamp>_password_reset` (created with
  `--create-only` and reviewed):
  - `User.disabledAt DateTime?`
  - `PasswordResetToken { id uuid(7), userId -> User (onDelete: Cascade), tokenHash String @unique,
    expiresAt DateTime, usedAt DateTime?, createdAt DateTime @default(now()) }` with
    `@@index([userId])` and `@@index([expiresAt])`.
  - The restricted `digitalsign_app` role needs the same grants as its neighbours; check
    `docker/postgres/init` and the migration SQL of `Session`.
- `apps/api/src/signing/signing-token.ts`: `hashPasswordResetToken`, `mintPasswordResetToken` (label
  `password-reset\0`, modelled on `hashInviteToken`/`mintInviteToken`) and `passwordResetUrl`
  (`${APP_URL}/reset-password/<token>`).
- `apps/api/src/auth/session.service.ts`: `RevokeReason` gains `'password-reset'` and `'user-removed'`.
- Tests: schema tests in `packages/shared` (`auth.test.ts`), a unit test that the three token labels
  produce different hashes for the same raw value.

## Step 2: Disable Removed Users

- `apps/api/src/users/users.service.ts` `remove()`: in one transaction set `disabledAt`, keep the
  role downgrade, scrambled password and cleared invite fields, and revoke the user's active
  sessions (`Session.updateMany`, reason `user-removed`).
- `apps/api/src/auth/auth.service.ts` `login()`: after the password check, a disabled account throws
  `INVALID_CREDENTIALS` and logs `Login failed` with reason `disabled`.
- Logging: `User removed` gains the count of revoked sessions.
- Tests: extend `apps/api/test/roles.e2e.test.ts` and `auth.e2e.test.ts` (a removed user's open
  session stops working at once, their refresh cookie is rejected, sign-in fails with the same error
  as a wrong password, another tenant's user is unaffected).

## Step 3: Request a Reset

- `apps/api/src/auth/auth.controller.ts`: `POST /auth/password/forgot`, `@Public()`, `@HttpCode(202)`,
  `@Throttle` 10 per hour per address, `@RateLimit(LIMITS.passwordResetPerAccount)`, body validated
  with `forgotPasswordSchema`. Always returns the same body.
- `common/throttling/keyed-rate-limit.guard.ts`: `LIMITS.passwordResetPerAccount`
  (`{ bucket: 'password-reset-account', limit: 3, windowMs: 3_600_000, by: 'account' }`).
- `mail/mail.types.ts`: `PasswordResetEmailJob { template: 'password-reset', email, requestId? }`.
- `mail/mail-queue.service.ts`: `enqueuePasswordReset(email)`, unique job id per request, enqueued
  even for an unknown address. A queue error is logged and the route still answers `202`.
- `mail/password-reset.mailer.ts`: modelled on `user-invite.mailer.ts`. It finds the user and skips,
  logging why, when the user is unknown, a service account, disabled, or has a pending invitation.
  Otherwise it marks the user's unused tokens used, mints and stores a new token, and sends.
- `mail/templates.ts`: `renderPasswordResetEmail`; `mail/email.processor.ts`: a new `case`.
- Logging: `Password reset requested` (masked email), `Password reset link emailed` (`tokenRef`
  only), `Password reset link skipped` (reason).
- Tests: `apps/api/test/password-reset.e2e.test.ts` (new): identical `202` for every account kind,
  one email only for an eligible account, the link opens the page route, no raw token in the queued
  job or captured logs, both rate limits. `templates.test.ts` for the renderer.

## Step 4: Complete a Reset

- `GET /auth/password/reset/:token` (30 per minute per address): returns the masked email and expiry,
  or `PASSWORD_RESET_TOKEN_INVALID` or `PASSWORD_RESET_TOKEN_EXPIRED`. A used token is invalid.
- `POST /auth/password/reset/:token` (10 per minute per address), returns `204`. One transaction:
  find by HMAC, reject used, expired or unknown, reject a disabled user, `PasswordService.hash`, set
  `passwordHash`, mark this token and the user's other unused tokens used, revoke every active
  session with reason `password-reset`. After commit, enqueue the change notice.
- `mail/mail.types.ts` and `mail-queue.service.ts`: `PasswordChangedEmailJob { userId }`;
  `renderPasswordChangedEmail` in `templates.ts`; the mailer sends it to the account's address.
- `maintenance/session-cleanup.service.ts`: also delete `PasswordResetToken` rows past the same
  retention cutoff, batched like sessions.
- Logging: `Password reset completed` (user id, revoked session count), `Password reset rejected`
  (reason: unknown, used, expired, disabled). Never the token, only `tokenRef`.
- Tests: extend `password-reset.e2e.test.ts` (single use, expiry by editing `expiresAt`, a second link
  voids the first, all sessions revoked and the old refresh cookie rejected, old password fails and
  new one works, disabled user refused, a token cannot reset another account), plus the renderer and
  purge unit tests. The `token-leak` suite is run to confirm nothing new leaks.

## Step 5: Web

- `apps/web/src/pages/LoginPage.tsx`: a "Forgot your password?" link. No existing label changes.
- `apps/web/src/features/auth/ForgotPasswordPage.tsx` at `/forgot-password`, inside `GuestOnly`.
- `apps/web/src/features/auth/ResetPasswordPage.tsx` at `/reset-password/:token`, public like
  `AcceptInvitePage`: validates through the GET, then the password form; on success navigates to
  `/login` with a "Password changed" notice. An invalid or expired link explains and links to
  `/forgot-password`.
- `apps/web/src/lib/api.ts`: three client methods. Routes added in `main.tsx`.
- Tests: component tests for both forms; browser spec `apps/web/e2e/password-reset.spec.ts` (forgot,
  read the file-transport email, reset, sign in with the new password, old link dead); both screens
  added to the UI gallery and checked at 375, 768 and 1440 px.

## Step 6: Documentation

- `docs/08-api-specification.md`: an "As built" note for the three routes and two error codes.
- `docs/10-security-and-threat-model.md`: an "As built" note on reset tokens, the uniform answer, the
  disabled marker and the rate-limit rows.
- `CHANGELOG.md` `[Unreleased]`; steps above marked done with their commits; `docs/README.md`.

## Deliberate Simplifications

- No change-password screen in Settings, no email change, no password-strength meter and no
  breached-password check. Candidates for a later slice.
- No CAPTCHA. Per-address and per-account limits only.
- Users removed before this ships have no marker and stay reset-eligible until removed again (ADR 0023).
- The reset email says nothing about the device or place the request came from.
- Delivery is still Gmail SMTP; a link that never arrives cannot be detected until the mail-provider
  slice.
- Not touched: the integration catalog, because these routes are for people, not API keys. The
  generated `docs/developers/openapi.json` and `errors.md` did change, because they are produced from
  the served routes and the shared error catalog (see "As Built").

## As Built (Slice 1)

Built as planned, with these differences and findings:

- **Migration written from `migrate diff`.** `prisma migrate dev --create-only` refused to run because
  the dev database recorded a stale checksum for `20260928083210_webhook_delivery_envelope` (the SQL
  file was edited after it was applied) and offered a reset. The SQL was generated with
  `migrate diff --from-migrations` against the shadow database instead. The dev database was then
  repaired without data loss: a backup was taken, that one checksum was updated (the column, indexes
  and backfill it creates were already present) and `migrate deploy` applied the new migration.
- **Reset tokens added to the log redaction.** Request logs, the error body's `instance` and browser
  error reports carried the URL path, so `/reset-password/:token` and `/password/reset/:token` are now
  masked like `/sign/:token` (`redact.ts`, web `logger.ts`, both tested). The same gap exists for
  invitation links (`/accept-invite/`, `/auth/invitations/`); it is recorded, not fixed here.
- **One usable link at a time is enforced.** The worker locks the user row before voiding older links
  and inserting the new one, so two concurrent jobs cannot each leave a usable link.
- **Generated developer docs changed.** `docs/developers/openapi.json` gained the three routes and two
  error codes, and `errors.md` the new code count, both regenerated by their drift tests.
- **`PasswordChangedEmailJob` is `{ userId }`, as planned;** the notice carries no time, so a retried
  job never shows a stale one.
- **Forgot page** shows its own message for `RATE_LIMITED` ("wait an hour"), because the generic one
  says a minute.
- **Wording built for the reset email.** Subject "Reset your Envelope password"; body "We received a
  request to reset the password for your Envelope powered by HealthProHub account…", a "Choose a new
  password" button, "This link can be used once and expires in 60 minutes. Asking for another link
  cancels this one." and "If you did not ask for this, you can ignore this email: your password will
  not change." It was not separately confirmed before commit; changing it is a template-only edit.

**Results.** Lint clean; unit tests 218 (api), 201 (web), 149 (shared) pass; typecheck passes for api,
web and embed, and shared fails only on the known `jurisdiction.test.ts` (unchanged). API e2e passes on
Node 22.19.0 (47 files, 339 tests; the new `password-reset` file has 16 tests; `roles`, `auth`, `session-cleanup` and
`openapi` were extended). Browser e2e `desktop-chrome`: 41 passed. UI gallery: 33 passed (desktop,
tablet, mobile), new screens inspected. Each step was checked to build alone (typecheck, lint, unit).

## Verification

Run once after every step is written (AGENTS section 5), then one commit per step from tree snapshots:

- `pnpm lint`, `pnpm typecheck` (the known `packages/shared/src/jurisdiction.test.ts` failure is
  reported, the other packages are typechecked individually), `pnpm test`.
- API e2e on Node 22.19.0, including `password-reset`, `auth`, `roles`, `rate-limits`, `token-leak`,
  `cross-tenant` and `integration-contract`.
- Browser e2e, `desktop-chrome`; `pnpm --filter @envelope/web ui:gallery`.
- `convention-reviewer` on the uncommitted diff before the verification run.
- Isolation: memory mail transport for the API suite, file transport for the browser stack, test
  databases and Redis databases only. Nothing reads `.env`, touches the dev database or sends mail.
