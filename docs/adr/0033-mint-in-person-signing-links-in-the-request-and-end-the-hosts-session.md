# 0033. Mint In-Person Signing Links in the Request and End the Host's Session on Hand-over

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Product owner, engineering

## Context

In-person signing (REC-08, docs/09) lets a signed-in sender hand their own device to a signer. Two
rules from the docs collide with how the product works today:

- ADR 0009 mints signing tokens only in the email worker, so a raw token is never in Redis, Postgres
  or a log. An in-person signer has no email to wait for.
- docs/09 requires that "the signer never sees the sender's dashboard". The sender's session lives in a
  refresh cookie in the same browser, so Back, or typing a URL, would open the sender's account.

## Decision

1. **The link is minted in the API request** (`POST /envelopes/:id/recipients/:recipientId/in-person`),
   with the same `mintSigningToken` and the same HMAC-only storage, and returned once, in the response
   to the signed-in sender, with `Cache-Control: no-store`. It is never queued, emailed or logged
   (request logs already mask `/sign/<token>`). The reason in ADR 0009 for worker-only minting, that a
   raw token must not sit in a job payload, is unchanged. The route is for the web app only: no API
   key and no embedded session may call it.
2. The link lives `IN_PERSON_LINK_TTL_MINUTES` (default 120), or until the envelope expires if sooner.
   It replaces any emailed link, and an emailed link minted later replaces it. A host marker on the
   recipient (`inPersonHostUserId`) is set while the current link is an in-person one.
3. **Starting in-person signs the sender out of that browser** before the signer's page opens.
   Handing the device back means signing in again (with two-factor, if on).
4. The audit records `IN_PERSON_STARTED` (the host) and the signature or decline carries `inPerson`
   and the host's id and name. The certificate says the signature was made in person on the host's
   device, so that address is never read as the signer's own location.

Rejected: **keeping the host signed in and relying on trust** (leaves the account open on a device
that is no longer theirs); **a PIN-locked "return" screen** (client-side only, so weaker than it
looks); **a second, JWT-protected signing API** (a parallel copy of the signing surface to keep in sync).

## Consequences

**Easier:** The whole signer portal, consent gate and rate limits are reused unchanged.

**Harder:** The sender signs in again after every in-person signature, which is deliberate friction.
The token-leak audit gains an in-person flow.

**Accepted:** The link sits in the browser history of the handed device until it is used or expires.
The short life and single use are what bound that.
