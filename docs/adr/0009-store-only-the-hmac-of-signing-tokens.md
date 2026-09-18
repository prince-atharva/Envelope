# 0009. Store Only the HMAC of Signing Tokens

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Engineering

## Context

A signer has no account. The link in their invitation email carries a token, and whoever holds the
token can open that recipient's document and sign it. Doc 10 therefore treats the token like a
password: 256 random bits, stored only as an HMAC, never logged, single use, and expiring. It names
token leakage through observability tooling as the most likely real-world failure of the design.

Three details are left open or contradict other documents:

- **Where the raw token lives before the email goes out.** Minting in the API and putting the link in
  the email job would store the raw token in Redis for as long as BullMQ keeps the job: 24 hours after
  success and 14 days after failure (`queue/queue.module.ts`).
- **What a reminder contains.** The raw token is never stored, so the original link cannot be
  resent.
- **How revocation works.** Doc 10 says decline and void null the hash. Doc 09 wants a signer who
  opens a spent link to see "you have already signed" (410) or "cancelled by the sender" (409). With
  the hash gone, the recipient cannot be found and every such visit becomes a bare 401.

## Decision

We will store only `HMAC-SHA256(SIGNING_TOKEN_SECRET, rawToken)` in `Recipient.tokenHash`, and:

1. **Mint in the email worker.** The invitation or reminder job carries `{ recipientId, kind }`. The
   worker checks that the envelope and recipient are still active, generates
   `randomBytes(32).toString('hex')`, writes the HMAC and `tokenExpiresAt`, renders
   `${APP_URL}/sign/${raw}` into the email, sends it, and discards the raw value. A retry mints again.
2. **Rotate on every email.** A reminder mints a new token and overwrites the hash, so only the
   newest link works.
3. **Revoke by state, not by deleting the hash.** Submitting sets `tokenUsedAt` and the recipient
   status `SIGNED`. Declining or voiding moves the envelope to a terminal status in the same
   transaction. The hash stays, so the portal can explain why a link no longer works.
4. **Check in one order.** Unknown or malformed → `TOKEN_INVALID` 401. Envelope `DECLINED` or `VOIDED`
   → `ENVELOPE_TERMINAL` 409. Recipient already signed → `TOKEN_ALREADY_USED` 410. Expired →
   `TOKEN_EXPIRED` 401.
5. **Log only a reference.** Logs carry the first 8 characters of the HMAC, never the token. Paths
   matching `/sign/<token>` are rewritten before any log line is written.

The HMAC key is a dedicated `SIGNING_TOKEN_SECRET`, separate from the JWT and refresh-token secrets,
so rotating one does not invalidate the others. We rejected a plain SHA-256: with the key held
outside the database, a database dump alone cannot be used to test guessed tokens.

## Consequences

**Easier:**

- The raw token exists only in the worker's memory for the length of one send, and in the
  recipient's mailbox. There is no queue, table or log to scrub.
- A resend or reminder needs no stored secret.
- Signers who return to a spent link get a clear, correct screen instead of a generic error.

**Harder:**

- The email worker needs database access and the audit service, which it did not have before.
- If SMTP accepts a message but the worker crashes before recording it, the retry sends a second
  email and the first link stops working. The recipient uses the newer email.
- Revocation depends on every token check reading the envelope and recipient state in the same
  query. `SigningTokenService.resolve` is the only place that check is written.

**Accepted:**

- A reminder invalidates the previous link. A signer who opens an old email sees "this link is no
  longer valid; use the newest email".
- A spent token still identifies its recipient. Holding one reveals only that the document was
  already signed or cancelled, never the document itself.
