# 0023. Disable Removed Users Instead of Relying on a Locked Password

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

When an Owner removes a user (`UsersService.remove`, docs/17 step 6), the row cannot be deleted:
`Envelope.ownerId` references it with `onDelete: Restrict`, so everything that person sent keeps its
evidence. The current code instead downgrades the account to MEMBER and replaces the password hash
with a random value nobody knows. That works only while there is no way to set a password.

Password reset is such a way. With it, a removed person could request a link to their own address,
choose a password and sign back in as a MEMBER of the workspace that removed them. The same is true of
any later feature that sets a password. Nothing in the data says the account was removed: a removed
user and an ordinary MEMBER look the same.

## Decision

We will add `User.disabledAt` (nullable timestamp) and treat it as the single source of truth for
"this person no longer has access":

1. `UsersService.remove` sets `disabledAt`, keeps the role downgrade and the scrambled password, and
   revokes every active session of that user, so open tabs lose access at once.
2. Sign-in refuses a disabled account with the same `INVALID_CREDENTIALS` as a wrong password, after
   the normal password check, so it is no new signal to an attacker. The reason is logged.
3. Password reset never sends a link to a disabled account and rejects a token whose account has
   been disabled since it was issued.
4. The workspace user list keeps returning the row as it does today; changing what the list shows is
   a separate decision.

We rejected:

- **Leaving the random password as the only lock.** It is a lock that any password-setting feature
  silently opens.
- **Deleting the user's envelopes or reassigning them.** It destroys or rewrites evidence.
- **A role value such as `DISABLED`.** It would touch every role comparison (`ROLE_RANK`, guards, the
  web app's `RequireRole`) for what is a separate property.

## Consequences

**Easier:**

- One field answers "may this person sign in or reset?", and later features (2FA enrolment, SSO)
  check the same field.
- Removal takes effect immediately, including for sessions already open.

**Harder:**

- Every path that authenticates or issues a credential must check `disabledAt`. A new one that forgets
  reintroduces the gap, so the check is covered by tests on sign-in, refresh, and reset.

**Accepted:**

- Users removed before this change have no marker and cannot be told apart from ordinary MEMBERs. An
  Owner removes them again to set it. There is no bulk backfill because the data cannot support one.
- There is no "re-enable" action in this slice; inviting the same address again still answers
  `EMAIL_ALREADY_REGISTERED`.
