# 0022. Store Password-Reset Tokens as HMACs in Their Own Table

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

A sender who forgets their password has no way back in. A reset link is a bearer credential: whoever
holds it can set a new password for the account, so it must be treated at least as carefully as a
signing link (ADR 0009). Four forces shape the design:

- **Where the token lives.** An invitation token is two columns on `User` (`inviteTokenHash`,
  `inviteTokenExpiresAt`). A person can ask for a reset several times, and each request must be
  able to be single use, expire, and be voided by the next one.
- **Where the raw token exists.** Minting it in the API and queueing the link would keep the raw
  token in Redis for as long as BullMQ keeps the job (ADR 0009).
- **Account enumeration.** "No account with that address" tells an attacker which addresses are
  registered. The response, and how long it takes, must not depend on whether the account exists.
- **Who may be reset.** A service account (docs/18) has an unusable password and must never receive
  a link. A pending invitee has not chosen a password yet and must use their invitation.

## Decision

We will store reset tokens in a new `PasswordResetToken` table, one row per issued link, and:

1. **HMAC only.** The token is 32 random bytes in hex. Only `HMAC-SHA256(SIGNING_TOKEN_SECRET,
   "password-reset\0" + rawToken)` is stored, in `tokenHash`. The label keeps a reset token from
   passing for a signing, download or invitation token, the same scheme `hashInviteToken` uses.
2. **Mint in the worker.** The `password-reset` email job carries the requested address. The worker
   decides whether the account is eligible, mints the token, writes the row, sends the email and
   discards the raw value. The raw token is never in Redis, Postgres or a log line.
3. **Uniform answer.** `POST /auth/password/forgot` always answers `202` with the same body and
   always enqueues a job, whether or not the account exists. The worker sends nothing and logs the
   reason for an unknown, disabled, service or pending account.
4. **Single use, newest wins.** A successful reset sets `usedAt` on the token and on every other
   unused token of that user, and revokes every active session of the user.
5. **One hour.** A link expires 60 minutes after it was minted.
6. **Rate limited twice.** Per address, and per account (the email in the body), so one mailbox
   cannot be flooded from many addresses.

The job carries an email address, not an id. That is the one deliberate exception to "jobs carry ids
only": the API cannot look the account up without answering differently for a known and an unknown
address. The existing `welcome` job already carries an address, so nothing new is stored in Redis.

We rejected:

- **Two more columns on `User`.** Only one link at a time, no history to purge or audit, and it mixes
  a second meaning into a row that already carries the invitation token.
- **A stateless signed token (JWT).** It cannot be made single use, or revoked when a newer link is
  requested or the password changes, without storing state anyway.
- **Telling the requester the address is unknown.** Friendlier, but it is an enumeration oracle.
- **Signing the person in after a reset.** It would turn the emailed link into a full login.

## Consequences

**Easier:**

- Several links can be outstanding, each single use, and a newer one voids the older ones.
- A database dump yields no usable link; the raw token exists only in the worker's memory and the
  person's inbox.
- The uniform answer means the forgot page needs no special error handling.

**Harder:**

- A new table, migration and purge job (expired and used rows are removed with the session cleanup).
- The person cannot be told immediately that the address is wrong; a typo simply never gets an email.
- Redis briefly holds an email address in a job, including addresses that are not accounts.

**Accepted:**

- Delivery is still Gmail SMTP, which confirms only that a message was handed to a mail server. A
  link that never arrives cannot be detected until the mail-provider slice of Phase 8.
- A flood of requests still creates queue jobs, bounded by the two rate limits.
