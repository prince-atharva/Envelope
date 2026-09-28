# 0021. One Integration Contract Catalog

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.0.0 |
| **Last updated** | 28 September 2026 |
| **Audience** | Engineering |
| **What this doc answers** | How do the API spec, the in-app guide and the served OpenAPI document stay in agreement? |

## In Plain Terms

Which routes accept an API key, what each webhook event contains, and what each error code means
are written down once, in one file the code reads from. The in-app guide, the served API
documentation and a markdown guide in the repository all read that one file instead of each
describing the API separately, so they cannot quietly drift apart the way they already have.

## Technical Detail

**Date:** 2026-09-28
**Deciders:** Project owner (approved 28 September 2026)

### Context

An audit of `docs/08-api-specification.md` against the implementation found roughly 15
contradictions: the documented base URL (`https://api.{host}/v1`) does not match the real one
(`/api/v1`); envelope creation is documented as a JSON call followed by a separate upload endpoint
that does not exist, when it is really one multipart call; documented download routes
(`/documents/original`, `/documents/completed`) do not exist; `Idempotency-Key` is documented as
required "on all creating POSTs" when only send and extend require it; the documented retry schedule
omits that the implementation's attempt count made the last entry unreachable (workstream 8 fixes
the code; this ADR fixes the fact that the two descriptions can disagree in the first place); the
error catalog table is missing every `API_KEY_*`, `WEBHOOK_*` and `EMBED_*` code. The in-app guide
(`apps/web/src/features/integrations/`) was written independently against the real implementation
and does not have these particular errors, but it duplicates the same event and error information a
third time, with no mechanism keeping any of the three in agreement as the API changes.

### Decision

Build one shared catalog, `packages/shared/src/integration-contract.ts`: the list of API-key- and
embed-accessible operations (method, path, access level, idempotency, rate limit, error codes), the
webhook event reference, the delivery header list, and the error guide. Add a reflection-based test
that walks each controller's actual `@ApiKeyAllowed`/`@EmbedAllowed` metadata and fails if it
disagrees with the catalog, so the catalog cannot describe a route access level the code does not
actually enforce.

Generate the OpenAPI document's response schemas, the embed routes' tags, and the security schemes
(`session`, `apiKey`, `embedSession`) from the same shared contracts already used for request-body
validation (`openApiSchema()` on the zod schemas). Commit a snapshot of the generated document
(`docs/developers/openapi.json`) so it can be reviewed in a pull request without running the server,
regenerated only under an explicit `UPDATE_OPENAPI=1` flag.

Publish a standalone developer guide under `docs/developers/` — a new, non-numbered location,
because docs 00–11 are the product specification and 12+ are internal phase plans, and a guide meant
to be handed to a partner with no login is neither. Its reference tables are generated from the same
catalog between marker comments, checked by a markdown-drift test that runs in `pnpm test`, so an
edit to the catalog that is not reflected in the markdown fails the build rather than silently aging.

Rejected: hand-synchronizing the three descriptions with a documentation review checklist (this is
exactly the process that already produced the 15 contradictions); generating `docs/08` itself from
the catalog (docs/08 is the original design specification with its own narrative structure and
"As built" annotation convention; replacing its prose with generated tables would lose that context —
the catalog instead becomes the new source of truth for the in-app guide, OpenAPI and the new
developer guide, while docs/08 keeps its existing "As built" note convention for spec-vs-implementation
drift); a fully generated OpenAPI document with no committed snapshot (a snapshot is what makes the
contract reviewable in a diff; generating it only at runtime hides the change until someone thinks
to run the server and compare).

### Consequences

**Easier:** an error code, event field or route access change made in one place is either reflected
everywhere automatically (the generated tables) or caught by a failing test (the reflection and
markdown-drift checks) instead of silently diverging; a partner can read `docs/developers/` without
a tenant login.

**Harder:** every future integration-surface change needs its catalog entry updated in the same
commit, or the new tests fail; the generated markdown sections cannot be hand-edited independently
of the catalog without the drift test flagging the difference.

**Accepted:** OpenAPI response-schema coverage targets the catalog's documented operations, not
every internal route in the API. The developer guide is markdown in this repository, not a
separately hosted documentation site.
