# 0025. Enforce Workspace Two-Factor at Sign-In and Refresh, with an Owner Reset

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

ADR 0024 lets a person turn two-factor on for themselves. A workspace that handles other people's
documents will want to require it of everyone. Two things make requiring it hard:

- **Enforcement must be on the server.** A page that nags is not a control: anyone holding a password
  can call the API directly. But the person being required to enrol has no factor yet, so the
  enrolment path must work without a full session.
- **Recovery must exist.** A required factor plus a lost phone is a lockout, and it happens.

## Decision

We will add `Tenant.requireTwoFactor` (default false) and:

1. **An Owner sets it** with `PUT /tenant/two-factor`. It cannot be turned on unless the Owner is
   enrolled, so the person who sets the rule can always satisfy it.
2. **Enforced at sign-in.** When the password is right, the workspace requires two-factor and the
   user has none, `POST /auth/login` answers `{ mfaEnrolmentRequired: true, challengeToken }` and
   issues no session. The token carries `purpose: "mfa-enrol"` and works only on
   `POST /auth/2fa/enrol/start` and `POST /auth/2fa/enrol/finish`. Finishing verifies a code, stores
   the factor, returns the recovery codes and signs the person in.
3. **Enforced at refresh.** `POST /auth/refresh` refuses a session, and revokes it, when the
   workspace requires two-factor and the user has none. A rule turned on today therefore reaches an
   already-signed-in person within one access-token lifetime, not at their next password entry.
4. **Cannot be turned off by a member.** While the rule is on, disabling one's own factor is refused
   with `TWO_FACTOR_REQUIRED`.
5. **An Owner can reset someone else's factor.** `DELETE /users/:id/two-factor` clears the secret and
   recovery codes and revokes that person's sessions. If the rule is on they enrol again at next
   sign-in. It is Owner only, tenant scoped, logged and emailed to the affected person, and it does
   not apply to oneself.
6. **API keys and recipients are out of scope.** A key acts as the workspace's service account and a
   recipient signs by link (docs/10); neither has a sender password.

We rejected:

- **A restricted session for enrolment.** It needs a new state in the access-token guard on every
  route; a purpose-scoped challenge token confines the risk to two routes.
- **Enforcing only in the web app.** Not a control.
- **Enforcing only at sign-in.** A weekly-refreshing session would keep an unenrolled person in
  for the length of the refresh token.
- **Owner self-service reset via email.** It would make the mailbox a way around the factor, which
  is what the factor is for.

## Consequences

**Easier:**

- One workspace switch makes every human account use a second factor, and it is enforced where the
  data is, not where the screen is.
- Lockouts have a documented, audited way out that needs no database access.

**Harder:**

- Refresh now reads the tenant's rule, one more indexed read on a path that already loads the user.
- Two more public routes (the enrolment pair) whose only credential is a short-lived token, so they
  are rate limited and tested for misuse (a challenge token used as an access token, and the reverse).

**Accepted:**

- The last Owner locked out of their own account has no in-product recovery; it is a database step,
  documented in the runbook when that exists.
- A rule switched on reaches signed-in people within one access-token lifetime, not instantly.
