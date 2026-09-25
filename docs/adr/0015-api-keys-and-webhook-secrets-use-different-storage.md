# 0015. API Keys and Webhook Secrets Use Different Storage

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Engineering

## Context

Phase 6b's foundation slice (docs/18) needed two new kinds of secret: an API key a third party
sends on every request, and a webhook secret the platform uses to sign every outbound delivery.
Doc 08's authentication table gives both the same one-line treatment — "shown once, stored hashed,
revocable" — and the codebase's one existing precedent for a bearer credential, `Session.tokenHash`
(`auth/session.service.ts`, ADR 0009's pattern applied to a login token), stores only
`HMAC-SHA256(secret, rawToken)` and never the raw value again.

That precedent fits an API key exactly: the server only ever needs to *verify* a presented key
against what it stored, the same shape as a refresh token or a signing link. It does not fit a
webhook secret. Docs/08's signature scheme is `HMAC_SHA256(secret, "{timestamp}.{raw_body}")`,
recomputed fresh on every delivery — the server has to produce a valid signature, not just check
one, which means it needs the *raw* secret back. An HMAC hash is one-way by design; there is no
way to sign a new payload from only the hash of the secret that signed the last one.

A second, unrelated gap: `Envelope.ownerId` (`prisma/schema.prisma`) is a real `onDelete: Restrict`
foreign key to `User`. Docs/08 describes an API key's scope as "whole tenant," but an API key is
not a `User` row and cannot itself satisfy that foreign key.

## Decision

**API keys are hashed, following the existing `Session.tokenHash` pattern exactly.**
`ApiKey.keyHash = HMAC-SHA256(API_KEY_HASH_SECRET, rawKey)`, a dedicated secret distinct from every
other HMAC key in `env.schema.ts`. The raw key (`eak_` + 32 random bytes) is returned once, at
creation, and never stored.

**Webhook secrets are encrypted, not hashed**, specifically because delivery needs them back.
`WebhookEndpoint.secretCiphertext = AES-256-GCM(WEBHOOK_SECRET_ENC_KEY, rawSecret)`, decrypted only
inside the delivery processor, immediately before signing one outbound request. `WEBHOOK_SECRET_ENC_KEY`
is a dedicated 32-byte key, unrelated to any HMAC secret in the system: rotating it makes every
stored webhook secret unrecoverable (endpoints would need to be re-created), which is an accepted,
explicit cost of key rotation rather than a silent one.

**An API key acts through one hidden, per-tenant service-account `User` row.** The first API key a
tenant creates lazily provisions a `User` with `isServiceAccount: true`, `role: ADMIN`, and an
unusable random `passwordHash` — the same locking trick `UsersService.invite()` already uses for an
account pending acceptance. Every subsequent key for that tenant reuses this one row as
`ApiKey.actingUserId`, which becomes `Envelope.ownerId` for anything the key creates. Because the
row's role is `ADMIN`, `ownership.ts`'s `assertCanManage`/`ownerScopeOf` — which only special-case
`MEMBER` — need no change at all: an API-key caller already reads and writes the whole tenant,
matching docs/08's "whole tenant" scope, for free. `isServiceAccount` excludes the row from
`UsersService.list()` and every other human-facing user surface.

We considered binding a key to one existing ADMIN/OWNER human instead (no schema change). Rejected:
it ties "whole tenant" behavior to that specific person remaining ADMIN/OWNER, and every envelope
an integration creates would appear owned by whichever employee happened to generate the key —
a worse audit story than a named service principal.

## Consequences

**Easier:**

- API keys reuse a pattern the codebase already trusts, with its own dedicated secret so rotating
  one HMAC key never invalidates another.
- Every controller, rate-limit bucket, and ownership check that already reads `AuthenticatedUser`
  works unmodified for an API-key caller (`auth/jwt-auth.guard.ts`'s extension only needs to
  populate the same shape).

**Harder:**

- This is the first at-rest encryption (rather than hashing) the codebase performs, so it needs a
  new key, a new small cipher helper, and its own rotation story — none of which had a precedent to
  copy from.
- A service-account `User` row is a slightly unusual shape: a "person" that never logs in, never
  appears in the team list, and exists only to satisfy a foreign key. Anyone reading `Envelope.owner`
  needs to know this convention exists.

**Accepted:**

- Losing `WEBHOOK_SECRET_ENC_KEY` (not just rotating it, but losing it) makes every registered
  endpoint's secret permanently unrecoverable; the only recovery is asking the tenant to re-create
  its endpoints. This is treated the same way losing `SIGNING_TOKEN_SECRET` invalidates every open
  signing link — an operational risk documented here, not a case the system tries to survive.
- A tenant's first API key silently creates a `User` row. This is invisible in the UI beyond the
  key itself, by design — the service account is an implementation detail of "whole tenant" scope,
  not a seat a tenant is meant to manage directly.
