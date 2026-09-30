# Phase 8: Launch Readiness Plan

| | |
|---|---|
| **Status** | Slice 1 (password reset) built and verified 30 September 2026. Slices 2 to 4 approved 30 September 2026, in progress |
| **Version** | 1.2.0 |
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
   SLICE 2 ── PLANNED ──► Change password: a signed-in person changes their own password in an
                           Account page, and every other place they were signed in is signed out.
   SLICE 3 ── PLANNED ──► Two-factor sign-in: an authenticator-app code after the password, with
                           recovery codes; an Owner can require it for the whole workspace.
   SLICE 4 ── PLANNED ──► Malware scanning: every uploaded PDF is checked by ClamAV; a file that
                           fails is refused, and a scanner outage is alerted, not silent.
```

Phase 8 is exactly these four slices. Production packaging, monitoring, a real mail provider and a
backup runbook, which the roadmap also lists under launch readiness, are not part of it by decision
on 30 September 2026 and stay on the roadmap for a later phase. A release is cut only when the user
asks for one.

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

## What You Can Do at the End of Slices 2 to 4

1. **Change your own password** from a new Account page (a link beside Sign out, for every role):
   enter the current one and a new one. You stay signed in here; everywhere else is signed out, and you
   get a "password changed" email.
2. **Turn on two-factor sign-in** on the same page: scan a QR code with an authenticator app, confirm
   with a code, and keep ten one-time recovery codes. From then on, signing in asks for a code after
   the password.
3. **Use a recovery code** if you lose your phone. It works once, and you are emailed that it was used.
4. **Require two-factor for your workspace** (Owners, in Settings → Users). Everyone must then enrol
   at their next sign-in, and no one can turn it off.
5. **Reset a colleague's two-factor** if they lose both phone and recovery codes (Owners). They are
   signed out and told by email.
6. **Trust that uploads are scanned.** A file with a known virus is refused with a clear message. If the
   scanner is down, uploads still work and the operators are alerted.
7. **Keep working exactly as before if you are an existing user.** Nothing is switched on for you, no
   one is forced to enrol on the day this ships, your open sessions carry on, and your workspace keeps
   working until an Owner chooses to require two-factor.

## The Finish Line for Slices 2 to 4

Slice 2 (change password):

- [ ] Changing the password needs the current one; a wrong current password changes nothing.
- [ ] A successful change signs out every other session, keeps this one, and sends the
      "password changed" email.
- [ ] The Account page is reachable by every signed-in role, and the change is rate limited per user.

Slice 3 (two-factor):

- [ ] Enrolling needs a valid code from the authenticator app; ten recovery codes are shown once and
      stored only as HMACs; the TOTP secret is stored encrypted and is never logged or returned again.
- [ ] Sign-in with a factor enrolled gives no session until a valid code (or a recovery code) is sent;
      a code cannot be used twice; a recovery code works once.
- [ ] A challenge token cannot be used as an access token, and an access token cannot answer a challenge.
- [ ] Password reset does not bypass the factor.
- [ ] Turning the factor off needs the password and a code. An Owner can require it for the workspace
      (enforced at sign-in and at refresh), cannot do so before enrolling, and can reset another
      person's factor; a member cannot switch it off while it is required.
- [ ] Attempts are rate limited per challenge and per account, and nothing secret reaches a log line,
      a Redis job or a response after enrolment.

Slice 4 (malware scanning):

- [ ] With `MALWARE_SCANNER=clamav`, an infected upload is refused with `MALWARE_DETECTED` and a clean
      one is stored unchanged.
- [ ] With the scanner unreachable or slow, the upload is accepted, a warning is logged for it and the
      `malware-scanner-unavailable` alert is raised.
- [ ] Production refuses to start with scanning off unless that is chosen explicitly.

Existing users and data (all slices):

- [ ] After the migrations, every existing user signs in, refreshes and works exactly as before: no
      factor is required, no prompt appears, open sessions and refresh cookies stay valid.
- [ ] Existing workspaces have two-factor off; turning it on later reaches existing users (signed in or
      not, and pending invitees) at their next sign-in or refresh, with a way to enrol.
- [ ] Existing data is untouched: no rewrite of any row, stored webhook secrets still decrypt, jobs
      already queued still render, stored documents are not rescanned.

All slices:

- [ ] Every new screen and email is covered by a test, and the browser tests run each flow.
- [ ] docs/08 and docs/10 carry "As built" notes; ADRs 0024, 0025 and 0026 are accepted.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Approval of slices 2 to 4 and ADRs 0024 to 0026 | No code for them is written before it | Given 30 September 2026 |
| Approval of one new dependency: `qrcode` in `apps/web` | To draw the enrolment QR code. TOTP and the ClamAV client are written in-house | Given 30 September 2026 |
| A new `TOTP_SECRET_ENC_KEY` in your local `.env` | The API will not start without it. `.env.example` gets a placeholder, tests and the browser stack use their own | Before step 10 is run locally |
| A running ClamAV container if you want scanning locally | `docker compose up -d clamav`; it downloads its signature database on first start and needs internet | Optional, step 16 |

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

### Decisions for slices 2 to 4

| Question | Decision |
|---|---|
| Scope of Phase 8 | Password reset, change password, two-factor, malware scanning. Nothing else |
| Second factor | Authenticator app (TOTP, RFC 6238) plus ten recovery codes (ADR 0024) |
| Who must use it | Optional per person; an Owner can require it for the workspace (ADR 0025) |
| Lost phone and codes | An Owner resets the person's factor; a lone Owner needs a database step (ADR 0025) |
| Sign-in shape | `POST /auth/login` may answer `{ mfaRequired, challengeToken }` instead of a session (ADR 0024) |
| Scanner | ClamAV over `clamd`, protocol client written in-house (ADR 0026) |
| Scanner down | Accept the upload, log it, raise the `malware-scanner-unavailable` alert (ADR 0026) |
| New env vars | `TOTP_SECRET_ENC_KEY`; `MALWARE_SCANNER`, `MALWARE_SCANNER_ALLOW_NONE`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` |
| New dependency | `qrcode`, in `apps/web` only |
| Account page | `/account`, for every role; it holds the password form and the two-factor section |
| Audit | Still no envelope, so structured logs and emails, not audit rows |
| Release | Not part of any slice; a release is cut only when the user asks |

## ADRs Written in This Phase

- [ADR 0022](adr/0022-store-password-reset-tokens-as-hmacs-in-their-own-table.md) — Store password-reset tokens as HMACs in their own table
- [ADR 0023](adr/0023-disable-removed-users-instead-of-relying-on-a-locked-password.md) — Disable removed users instead of relying on a locked password
- [ADR 0024](adr/0024-add-a-totp-second-factor-with-recovery-codes.md) — Add a TOTP second factor with recovery codes
- [ADR 0025](adr/0025-enforce-workspace-two-factor-at-sign-in-and-refresh.md) — Enforce workspace two-factor at sign-in and refresh, with an Owner reset
- [ADR 0026](adr/0026-scan-uploads-with-clamav-and-accept-them-when-it-is-down.md) — Scan uploads with ClamAV and accept them when it is down

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Contracts and schema: shared schemas, error codes, limit constant, migration, token helpers | ✅ Built (`e567345`) |
| 2 | Disable removed users: `disabledAt`, session revoke on removal, sign-in refusal | ✅ Built (`77e2a65`) |
| 3 | Request a reset: forgot route, queue, mailer, email template, rate limits | ✅ Built (`6291efb`) |
| 4 | Complete a reset: preview and reset routes, session revocation, change notice, token purge | ✅ Built (`ed1b806`) |
| 5 | Web: forgot and reset pages, sign-in link, client, browser test, UI gallery | ✅ Built (`5741318`) |
| 6 | Documentation: docs/08 and docs/10 notes, changelog, this plan marked done | ✅ Built (`2296d86`) |
| 7 | Change password: route, revoke other sessions, notice email, per-user limit | ✅ Built |
| 8 | Web: Account page with the password form, header link | ✅ Built |
| 9 | Documentation for slice 2 | ✅ Built |
| 10 | Two-factor foundations: schema, env var, cipher, TOTP and recovery-code helpers | Planned |
| 11 | Enrol and manage a factor: setup, enable, disable, regenerate codes, notices | Planned |
| 12 | Sign in with a second factor: login challenge, challenge route, refresh check, limits | Planned |
| 13 | Workspace policy and Owner reset: require flag, enrolment-token routes, reset route | Planned |
| 14 | Web: enrolment, second sign-in step, workspace switch, per-user reset, QR code | Planned |
| 15 | Documentation for slice 3 | Planned |
| 16 | Malware scanning: config, `ClamdMalwareScanner`, alert on outage, compose service, tests | Planned |
| 17 | Documentation for slice 4, and the phase's changelog | Planned |

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

## Step 7: Change Password (API)

- `packages/shared/src/auth.ts`: `changePasswordSchema` (`{ currentPassword, newPassword }`, the new one
  through `passwordSchema` and refused if equal to the current one).
- `packages/shared/src/errors.ts`: `CURRENT_PASSWORD_INCORRECT` (422, not 401: a 401 makes the web
  client try a silent refresh). Listed in `NON_INTEGRATION_ERROR_CODES` and the web message map.
- `common/throttling/keyed-rate-limit.guard.ts`: `by: 'user'` (the signed-in user's id) and
  `LIMITS.passwordChangePerUser` (5 an hour). The existing `by: 'account'` reads an email from the body
  and does not fit an authenticated route.
- `auth/auth.controller.ts`: `POST /auth/password/change`, JWT only (closed to API keys), `204`.
  `AuthService.changePassword(userId, sessionId, input, client)`: verify the current password with
  `PasswordService.verify`, hash the new one, and in one transaction set it and revoke every active
  session of the user except the current one, reason `password-change` (added to `RevokeReason`).
  After commit, enqueue the change notice.
- `mail/mail.types.ts`: `PasswordChangedEmailJob` gains `via: 'reset' | 'change'` (default `reset`, so
  queued jobs from before the deploy still render). `renderPasswordChangedEmail` words the two cases:
  a reset signed everything out; a change kept the device that made it.
- Logging: `Password changed` (user id, revoked session count) and `Password change rejected`
  (reason `wrong-current-password`). Never a password.
- Tests: `apps/api/test/password-change.e2e.test.ts` (new): wrong current password changes nothing,
  success keeps this session and ends the others (their refresh cookies are rejected), old password
  fails and new one works, the notice arrives, the limit answers 429 on the sixth, an API key and an
  anonymous caller are refused, a MEMBER may use it, the password never appears in logs. Schema tests
  in `auth.test.ts`, renderer cases in `templates.test.ts`.

## Step 8: Change Password (Web)

- `apps/web/src/pages/AccountPage.tsx` at `/account` inside `RequireAuth` and `AppShell`, for every
  role. A "Password" section: Current password, New password, "Change password". On success a status
  message and the form clears; a wrong current password shows the server message on that field.
- `AppShell.tsx`: an "Account" link beside Sign out, on the desktop header and the mobile menu.
- `lib/api.ts`: `changePassword`. `lib/errors.ts`: message for `CURRENT_PASSWORD_INCORRECT`.
- Tests: a component test for the form; `apps/web/e2e/account.spec.ts` (change the password, sign out,
  sign in with the new one, a second signed-in browser is signed out); the Account page added to the
  UI gallery at three widths. Search `apps/web/e2e` first: the new link must not collide with an
  existing accessible name.

## Step 9: Documentation for Slice 2

- `docs/08-api-specification.md`: an "As built" note for the route and the error code, and the limit
  row. `docs/10-security-and-threat-model.md`: the limit row. `CHANGELOG.md` `[Unreleased]`. This plan's
  steps table and an "As Built (Slice 2)" section.

## Step 10: Two-Factor Foundations

- `apps/api/prisma/schema.prisma`, migration `<timestamp>_two_factor` (`migrate diff` is used if
  `migrate dev` is blocked by dev-database drift; review the SQL):
  - `User.totpSecretCiphertext String?`, `User.totpEnabledAt DateTime?`, `User.totpLastStep Int?`.
  - `RecoveryCode { id uuid(7), userId -> User (Cascade), codeHash String @unique, usedAt DateTime?,
    createdAt }` with `@@index([userId])`.
  - `Tenant.requireTwoFactor Boolean @default(false)`.
- New env var `TOTP_SECRET_ENC_KEY` (AES-256 key, base64, the same `aes256Key` validator): in
  `env.schema.ts` with a `superRefine` check that it differs from `WEBHOOK_SECRET_ENC_KEY` and the
  other secrets; `.env.example`; `apps/api/test/test-env.ts`; `apps/web/e2e/stack/stack.mjs`.
- `apps/api/src/common/crypto/aes-gcm.ts`: the AES-256-GCM helper factored out of
  `WebhookSecretCipher` (same ciphertext layout, so stored webhook secrets keep working);
  `auth/totp-secret.cipher.ts` uses it with the new key.
- `auth/totp.ts`: `generateSecret` (20 random bytes, base32), `totpCode(secret, step)`,
  `verifyTotp(secret, code, now, lastStep)` returning the accepted step or null (window ±1, constant-time
  compare, refuses `step <= lastStep`), `otpauthUri(secret, accountName)`. `auth/recovery-codes.ts`:
  `mintRecoveryCodes` (ten `xxxxx-xxxxx` codes from an unambiguous alphabet), `hashRecoveryCode`
  (HMAC under `recovery-code\0`).
- `packages/shared`: schemas `totpCodeSchema`, `enableTwoFactorSchema`, `disableTwoFactorSchema`,
  `twoFactorChallengeSchema`, types `TwoFactorStatus`, `TwoFactorSetup`, `LoginResponse`, and
  `twoFactorEnabled` on `TenantUser`; errors `TWO_FACTOR_CODE_INVALID` (401), `TWO_FACTOR_REQUIRED`
  (403), `TWO_FACTOR_CHALLENGE_INVALID` (401), `TWO_FACTOR_ALREADY_ENABLED` (409).
- `logging/redact.ts`: `challengeToken`, `totpSecret`, `otpauthUri`, `recoveryCodes` added to the
  sensitive keys.
- Tests: unit tests for `totp.ts` against the RFC 6238 vectors, replay refusal, window edges and
  constant-time comparison; the cipher round trip and that a webhook secret encrypted before the
  refactor still decrypts; recovery-code format, uniqueness and hashing; env-schema tests for the key.

## Step 11: Enrol and Manage a Factor

- `auth/two-factor.service.ts` and routes on `AuthController` (JWT, not API keys, `@RateLimit` per user):
  - `GET /auth/2fa` → `{ enabled, recoveryCodesRemaining, required }`.
  - `POST /auth/2fa/setup` → generates a secret, stores it encrypted and pending, returns `{ secret,
    otpauthUri }`. Repeatable until enabled; `TWO_FACTOR_ALREADY_ENABLED` after.
  - `POST /auth/2fa/enable` `{ code }` → verifies against the pending secret, sets `totpEnabledAt` and
    `totpLastStep`, creates ten recovery codes, returns them once. Logs and queues the notice.
  - `POST /auth/2fa/disable` `{ password, code }` (a recovery code also works) → refused with
    `TWO_FACTOR_REQUIRED` when the workspace requires it; otherwise clears the secret and codes,
    revokes the user's other sessions, notifies.
  - `POST /auth/2fa/recovery-codes` `{ password, code }` → replaces the codes and returns the new ones.
- `mail`: `TwoFactorNoticeJob { template: 'two-factor-notice', userId, event }` with events `enabled`,
  `disabled`, `recovery-used`, `reset-by-owner`; `renderTwoFactorNoticeEmail`; worker mailer beside
  `PasswordResetMailer`. Ids only.
- Logging: `Two-factor setup started`, `enabled`, `disabled`, `recovery codes regenerated`, and
  `Two-factor code rejected` with a reason. Never a secret, a code or a URI.
- Tests: `apps/api/test/two-factor.e2e.test.ts` (new): the enrol path with a code computed by the test's
  own TOTP helper, a wrong code, a repeated code refused, setup after enabling refused, disable and
  regenerate need password and code, codes shown once and stored as HMACs, the secret is ciphertext in
  the row and absent from every log and response after setup, notices sent, cross-tenant isolation,
  rate limits.

## Step 12: Sign In with a Second Factor

- `AuthService.login`: after the password check and the disabled check, if the user has
  `totpEnabledAt`, return `{ mfaRequired: true, challengeToken }` and create no session or cookie.
  `AuthController.login` sets the cookie only for a full result.
- `auth/mfa-challenge.ts`: sign and verify the five-minute challenge JWT (`purpose: 'mfa'`, `sub`, no
  `sid`), with `JWT_ACCESS_SECRET` and its own `typ`.
- `POST /auth/2fa/challenge` `{ challengeToken, code }`: verify the token, then the TOTP code (advancing
  `totpLastStep` in a guarded update so two requests cannot both spend one code) or a recovery code
  (marked used in a guarded update, notice queued). Success is exactly the normal sign-in result.
  `@RateLimit` `by: 'challenge'` (a hash of the token, 5 attempts in 5 minutes) and a per-IP `@Throttle`.
- `jwt-auth.guard.ts`: explicitly refuses a token carrying a `purpose` claim.
- `AuthService.refresh` and `acceptInvite` are reviewed and covered so neither issues a session around
  the factor. `acceptInvite` is completed in step 13, when a workspace can require one.
- Tests: extend `two-factor.e2e.test.ts` and `auth.e2e.test.ts`: no cookie and no session before the
  code, a right code signs in, a wrong code and a replayed code do not, a recovery code works once, an
  expired or tampered challenge is refused, a challenge token as a Bearer token gets 401 and an access
  token as a challenge gets `TWO_FACTOR_CHALLENGE_INVALID`, a password reset then sign-in still asks for
  the code, the sixth attempt is 429, and no code or token is logged.

## Step 13: Workspace Policy and Owner Reset

- `PUT /tenant/two-factor` `{ required }`, OWNER only, `@RateLimit(LIMITS.lifecycle)`: refused with
  `TWO_FACTOR_REQUIRED` when turning on while the caller has no factor. `GET /auth/2fa` reports it.
- `AuthService.login`: password right, workspace requires it, user has none → `{ mfaEnrolmentRequired:
  true, challengeToken }` (`purpose: 'mfa-enrol'`), no session. `POST /auth/2fa/enrol/start` and
  `/enrol/finish` accept that token in the body: start returns a pending secret and URI, finish verifies
  a code, stores the factor, returns the recovery codes and the normal sign-in result.
- `AuthService.refresh`: a session of a user with no factor in a requiring workspace is revoked and
  answers `SESSION_EXPIRED`.
- `AuthService.acceptInvite`: in a requiring workspace, accepting an invitation sets the password and
  answers `{ mfaEnrolmentRequired: true, challengeToken }` instead of a session, the same as sign-in.
  `register` creates a new workspace, whose rule is off, so it is unchanged.
- `DELETE /users/:id/two-factor`, OWNER only, tenant scoped through `findInTenant`, refused for oneself:
  clears the secret and recovery codes, revokes the person's sessions, queues the `reset-by-owner` notice,
  logs actor and target.
- `users.service.ts`: `twoFactorEnabled` on the listed users. Users list unchanged otherwise (ADR 0023).
- Tests: `two-factor-policy.e2e.test.ts` (new): the Owner cannot require it before enrolling; once
  required, an unenrolled member gets `mfaEnrolmentRequired` and no session, can enrol through the two
  routes and is then signed in; an enrolment token does nothing on any other route; an already
  signed-in unenrolled member is ended at refresh; a member cannot disable while required; the Owner
  reset ends sessions and notifies; a pending invitee who accepts into a requiring workspace must enrol
  before getting a session; a MEMBER or ADMIN gets 403; another tenant's user gets 404; API
  keys are unaffected.

## Step 14: Two-Factor (Web)

- `package.json` (`apps/web`): add `qrcode` and `@types/qrcode`; the lockfile changes with it.
- `AccountPage.tsx` "Two-factor authentication" section: off → "Set up" opens a dialog with the QR code
  (drawn in the browser from the URI, so the secret never leaves the page), the secret in text as a
  fallback, a code field and "Turn on"; then a one-time screen listing the recovery codes with Copy and a
  required "I have saved these" step. On → status, "Show new recovery codes" and "Turn off", both asking
  for the password and a code.
- `LoginPage.tsx`: a `mfaRequired` answer swaps the form for a "Enter your code" step (six digits, a
  "Use a recovery code instead" link, "Back"); `mfaEnrolmentRequired` shows the same dialog as a
  blocking enrolment. The existing Email address, Password and Sign in labels are untouched.
- `SettingsUsersPage.tsx`: an Owner switch "Require two-factor for everyone", a per-user "Two-factor on"
  badge and a "Reset two-factor" action with a confirmation step.
- `lib/api.ts`, `lib/auth.tsx` (the login result becomes a union), `lib/errors.ts`.
- Tests: component tests for the sign-in second step, the enrolment dialog and the recovery-code
  screen; `apps/web/e2e/two-factor.spec.ts` (enrol with a code computed in the test from the displayed
  secret, sign out, sign in with a code, use a recovery code, an Owner requires it and a member is
  forced to enrol, an Owner resets a member); all new screens in the UI gallery at three widths.

## Step 15: Documentation for Slice 3

- `docs/08`: the routes, the changed login response and the error codes. `docs/10`: the factor, the
  challenge token, replay protection, encryption at rest, the policy and the reset, and the threat-model
  rows it changes (credential stuffing, account takeover). `docs/05` "As built" note for the new columns
  and table. `.env.example` comments. `CHANGELOG.md`. This plan's "As Built (Slice 3)".

## Step 16: Malware Scanning

- `env.schema.ts`, `.env.example`, `apps/api/test/test-env.ts`, `apps/web/e2e/stack/stack.mjs`:
  `MALWARE_SCANNER` (`none` | `clamav`, default `none`), `MALWARE_SCANNER_ALLOW_NONE` (flag, default
  false), `CLAMAV_HOST` (default `127.0.0.1`), `CLAMAV_PORT` (default 3310), `CLAMAV_TIMEOUT_MS` (default
  15000). A `superRefine` requires `MALWARE_SCANNER_ALLOW_NONE=true` to run production with `none`.
- `uploads/clamd-malware-scanner.ts`: `ClamdMalwareScanner extends MalwareScanner`, engine `clamav`. It
  connects with `node:net`, sends `zINSTREAM\0`, streams the file in length-prefixed chunks and a zero
  terminator, and parses `stream: OK`, `stream: <signature> FOUND` and `... ERROR`. `ScanResult` gains
  `unavailable?: boolean`; a connect error, timeout or `ERROR` reply resolves with
  `{ clean: true, unavailable: true }` and raises `malware-scanner-unavailable` through `AlertService`
  (fields: engine and reason only). `uploads.module.ts` selects the class from config.
- `pdf-validator.service.ts`: when `unavailable`, log `Upload accepted without a malware scan` at warn
  with the reason; a detection still throws `MALWARE_DETECTED`. No other pipeline change.
- `docker-compose.yml`: a `clamav` service (`clamav/clamav`, pinned, bound to `127.0.0.1:3310`, a named
  volume for the signature database, a healthcheck). Documented in the file's header comment.
- Tests: `clamd-malware-scanner.test.ts` runs the real client against a real local TCP server that speaks
  the `clamd` reply format: clean, `FOUND` (an EICAR-style marker string), `ERROR`, a server that closes
  early, a server that never answers (timeout), a large file over many chunks. `apps/api/test/malware-scan.e2e.test.ts`
  (new) boots the app with `MALWARE_SCANNER=clamav` pointed at that server and proves: an infected upload
  gets 422 `MALWARE_DETECTED` and stores nothing, a clean one is stored byte-for-byte, and with the server
  stopped the upload is accepted, the warning is logged and the alert is raised once. A config test
  covers the production guard.

## Step 17: Documentation for Slice 4

- `docs/10`: "As built" notes on the scanner, the fail-open rule and the alert; `docs/03` or `docs/04`
  if either lists services. The root `README.md` local-services table gains ClamAV. `CHANGELOG.md`
  `[Unreleased]`.  This plan: every step marked with its commit, the finish
  lines ticked, an "As Built (Slices 2 to 4)" section and the results of the verification run.

## As Built (Slice 2)

Built as planned. The Account link is a plain "Account" link beside Sign out, in `UserBar`, so it
shows on desktop and phones alike. The generated developer docs (`openapi.json`, `errors.md`) were
regenerated again for the new route and error code.

## Existing Users and Data

Everything here already exists in a running database, so each slice is written to change nothing for
the people using it until they, or an Owner, choose otherwise.

| Who or what exists today | What the slices do |
|---|---|
| Users, sessions and refresh cookies | Migrations only add nullable columns and a default-false flag. No row is rewritten and no session is revoked. An existing user signs in exactly as before |
| Workspaces (`Tenant`) | `requireTwoFactor` defaults to false. Nothing is required until an Owner turns it on |
| Users with no factor when an Owner turns the rule on | Signed out of nothing at once. At their next sign-in they get `mfaEnrolmentRequired`; a signed-in session ends at its next refresh (within one access-token lifetime) and they enrol at the next sign-in |
| Invitations already sent and not yet accepted | Accepting works as today; in a requiring workspace it ends in the enrolment step (step 13) |
| Users removed before slice 1 | Unchanged from slice 1: no marker, so not told apart from ordinary members (ADR 0023). An Owner removes them again to disable them |
| Service accounts (API keys) | No sender password and no factor; excluded from every new check |
| Jobs already in Redis | `PasswordChangedEmailJob.via` defaults to `reset`, so a job queued before the deploy renders as it did |
| Stored webhook secrets | The cipher refactor keeps the ciphertext layout; a unit test decrypts a secret encrypted by the old code |
| Stored documents | Scanning applies to new uploads only; nothing is rescanned or re-stored |
| Scanner setting | `MALWARE_SCANNER` defaults to `none`, so a deployment that has not opted in behaves as today; production must choose (ADR 0026) |
| The development database | Apply with `prisma migrate deploy` (or `db:migrate`); the migrations are additive and need no reset. The dev database's earlier checksum drift was repaired in slice 1 |

Each of these is a test, not an assumption: a migration test loads a user, a workspace and a session created
before the migration and shows they behave unchanged, and the policy tests start from users who existed
before the rule was turned on.

## Deliberate Simplifications

- Slice 1 has no change-password screen (slice 2 adds it), no email change, no password-strength meter
  and no breached-password check.
- No CAPTCHA. Per-address and per-account limits only.
- Users removed before this ships have no marker and stay reset-eligible until removed again (ADR 0023).
- The reset email says nothing about the device or place the request came from.
- Delivery is still Gmail SMTP; a link that never arrives cannot be detected until a real mail provider
  is added, which is outside Phase 8.
- Two-factor is TOTP only: no SMS, email codes, passkeys or "remember this device". A person who loses
  both device and recovery codes needs an Owner; a lone Owner needs a database step (ADR 0025).
- A workspace rule reaches already-signed-in people within one access-token lifetime, at refresh.
- Malware scanning is one engine at upload time. Unscanned uploads accepted during an outage are not
  marked on the document and are not rescanned later (ADR 0026).
- The change-password screen does not offer email change, a strength meter or a breached-password check.
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
- Slices 2 to 4 add to the same run: API e2e `password-change`, `two-factor`, `two-factor-policy`,
  `malware-scan`, `auth`, `roles`, `token-leak`, `cross-tenant`; browser `account` and `two-factor`
  specs; the gallery; the drift check for the new migration. The scanner tests use a local socket, never
  a real `clamd`, never the internet.
- Isolation: memory mail transport for the API suite, file transport for the browser stack, test
  databases and Redis databases only. Nothing reads `.env`, touches the dev database or sends mail.
