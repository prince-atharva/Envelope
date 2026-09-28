# 0017. Bind Embedded Origins to API Keys

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.1.0 |
| **Last updated** | 28 September 2026 |
| **Audience** | Engineering and tenant administrators |
| **What this doc answers** | How should any tenant configure origins during API-key creation? |

## In Plain Terms

Every tenant can integrate its own application. HealthProHub is an example, not an access
restriction. Create one key per integration and optionally enter its embedded editor website
origins in the same dialog. Backend-only integrations need no origins. Each key has separate
iframe permissions, even within the same tenant.

## Technical Detail

**Date:** 2026-09-28  
**Deciders:** Project owner; approval pending

### Context

ADR 0016 binds sessions to tenant, key, parent origin and one envelope, with tenant-wide origin
management. The user requests origin setup when creating a key. A shared tenant list lets every
full key launch editors for every registered integration origin.

### Decision

Supersede only ADR 0016's tenant-wide origin management. Keep one-envelope sessions and hosted
signing. Store exact canonical origins per API key. Key creation MAY include up to ten
`embedOrigins`, defaulting to empty. Empty means backend-only; headless routes retain their
existing behavior and embedded issuance is denied. Read-only keys MUST have an empty list.

Human tenant ADMIN/OWNER JWT sessions manage origins. API keys and embedded bearers MUST NOT.
Issuance, bearer validation and transactional upload binding check tenant, key and parent origin.
An unmatched or missing origin at issuance returns the existing `403 EMBED_ORIGIN_NOT_ALLOWED`
(ADR 0016) rather than a new code — the failure is the same shape whether the origin was never
registered or was registered to a different key. Removing an origin or revoking its key invalidates
live sessions on the next request. Origins control iframe placement; they do not authenticate staff
or make browser API keys safe.

Editing origins on a revoked key returns `409 CONFLICT`, not `401 API_KEY_INVALID`: the caller is
an authenticated human session, and the web client treats any `401` from any endpoint as an expired
session and silently attempts a token refresh (`apps/web/src/lib/api.ts`) — a `401` here would be
misread as the admin's own session expiring, not the target key's.

Use an additive `ApiKeyEmbedOrigin` migration. Backfill the old tenant list onto that tenant's
non-revoked full-access keys to preserve current grants. The tenant-wide `EmbedOrigin` table and
its `GET`/`PUT /embed/origins` routes were built in this same unreleased phase (workstream 6,
`v0.7.0` did not include them) and have no external callers yet, so this decision removes the
routes outright instead of leaving a deprecated shim: there is no compatibility obligation for a
contract nothing outside this repository has ever called. The `EmbedOrigin` table itself is kept,
unread, as a rollback path for the migration only. See docs/18 workstream 7.

Rejected: hiding a shared tenant list inside key creation (unclear authority); mandatory origins
for headless keys (breaks clients); browser Origin as authentication (does not prove authority);
a HealthProHub-only registry (contradicts universal tenant integration); a deprecated `410` shim
for the old routes (adds a permanent code for a contract nothing has ever depended on).

### Consequences

**Easier:** one setup flow, independent origin changes per integration, universal tenant use.

**Harder:** additive migration, nested key-summary metadata, origin-edit UI and backfill/cutover
checks. Administrators SHOULD review inherited lists after migration.

**Accepted:** the unreleased origin-management contract changes before its first release. Backend
keys keep their current tenant-wide headless authority. No OAuth onboarding, embedded recipient
signing, package publication or automatic partner deployment is added.
