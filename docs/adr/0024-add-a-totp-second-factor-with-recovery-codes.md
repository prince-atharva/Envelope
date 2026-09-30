# 0024. Add a TOTP Second Factor with Recovery Codes

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

A sender's password is the only thing between the internet and every document in their workspace.
Phishing, credential stuffing and reuse are the ordinary ways an account is lost, and password reset
(ADR 0022) makes the mailbox a second way in. Phase 8 adds a second factor for sender sign-in. Four
forces shape it:

- **Which factor.** SMS needs a provider, costs money per message and is weak against SIM swaps.
  Email codes depend on Gmail SMTP, which cannot confirm delivery, and add nothing when the mailbox
  is what was compromised. An authenticator app (RFC 6238) needs neither.
- **Where the secret lives.** A TOTP secret must be recovered in full to check a code, so, like a
  webhook secret (ADR 0015), it cannot only be hashed. It must be encrypted at rest.
- **A half-signed-in state.** After the password is right and before the code is, the person is not
  signed in. Whatever represents that state must never work as an access token.
- **Getting locked out.** A lost phone must not lock a workspace out for good.

## Decision

We will add TOTP as the one second factor, with recovery codes, and:

1. **RFC 6238, in-house.** SHA-1, 30 seconds, 6 digits, accepting the previous and next step. The
   algorithm is about thirty lines on `node:crypto`, so it needs no dependency and is tested against
   the RFC's published vectors. Codes are compared in constant time.
2. **No replay.** The last accepted time step is stored on the user; a code for that step or an
   earlier one is refused, so an observed code cannot be used twice.
3. **Encrypted secret, its own key.** The secret is stored AES-256-GCM encrypted under a new
   `TOTP_SECRET_ENC_KEY`, separate from `WEBHOOK_SECRET_ENC_KEY`, so rotating one never breaks the
   other. A secret is pending (`totpEnabledAt` null) until a valid code confirms it.
4. **Recovery codes.** Enabling issues ten single-use codes, shown once. Only their HMAC is stored,
   under the label `recovery-code\0` with `SIGNING_TOKEN_SECRET` (ADR 0009). Using one is logged and
   emailed to the account.
5. **A challenge token, not a session.** When the password is right and a factor is enrolled,
   `POST /auth/login` answers `{ mfaRequired: true, challengeToken }` and sets no cookie. The token
   is a five-minute JWT with `purpose: "mfa"` and no session id, so the access-token guard, which
   requires an active session, refuses it. `POST /auth/2fa/challenge` exchanges it plus a code for
   a normal sign-in. Attempts are limited per challenge token and, through the sign-in limits, per
   account.
6. **Turning it off needs the password and a code.** A stolen session alone cannot remove it.
7. **Password reset does not bypass it.** A reset revokes sessions and signs no one in, so the next
   sign-in still asks for the code.

We rejected:

- **SMS or email codes.** Cost, a provider, and weaker guarantees, as above.
- **WebAuthn and passkeys.** The better factor, and a candidate for later, but a larger front-end and
  enrolment story than this slice.
- **"Remember this device".** It needs a device credential of its own and weakens the point.
- **A library for TOTP.** The algorithm is small and stable; a dependency would add supply-chain
  surface for little.

## Consequences

**Easier:**

- Sign-in survives a leaked password, and reset cannot become a way around the second factor.
- No provider, cost or delivery dependency for the factor itself.
- The challenge token cannot be mistaken for an access token, by construction and by an explicit
  `purpose` check in the guard.

**Harder:**

- A new env var, a new table (recovery codes), new columns on `User`, a second step in the sign-in
  screen and an enrolment flow.
- Every path that issues a session (sign-in, refresh, invitation accept) must respect the factor;
  a new one that forgets reintroduces the gap, so each is covered by a test.

**Accepted:**

- No passkeys, no trusted devices, no SMS in this phase.
- A person who loses both device and recovery codes needs an Owner to reset their factor (ADR 0025);
  a lone Owner in that position needs a database operation.
- Rotating `TOTP_SECRET_ENC_KEY` makes stored secrets unreadable; every enrolled user would have to
  re-enrol, so it is not rotated casually.
