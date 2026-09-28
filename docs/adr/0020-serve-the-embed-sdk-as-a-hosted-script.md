# 0020. Serve the Embed SDK as a Hosted Script

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.0.0 |
| **Last updated** | 28 September 2026 |
| **Audience** | Engineering and integrators |
| **What this doc answers** | How does a partner application load the embedded-editor SDK without joining this monorepo? |

## In Plain Terms

A partner adds one `<script>` tag pointing at a URL Envelope serves, the same way widely used
embeddable widgets work. Nothing needs installing, building or bundling on the partner's side.

## Technical Detail

**Date:** 2026-09-28
**Deciders:** Project owner (approved 28 September 2026)

### Context

`@envelope/embed`'s built `dist/index.js` imports `@envelope/shared` (for `EMBED_PROTOCOL_VERSION`
and `embedEventSchema`) at runtime. `@envelope/shared` is itself private, CommonJS, and depends on
zod. Both packages are `"private": true` with no registry or CDN publication path
(`packages/embed/README.md`). The only way the SDK currently loads in a browser is a hashed Vite
build artifact (`apps/web/vite.config.ts`'s `embed-sdk` entry) served through the web app's own
asset pipeline and consumed by test code (`apps/web/e2e/embed-host.ts`) that reads the Vite
manifest to find the current hash. A real partner outside this repository has no equivalent path:
it cannot `npm install` a private package, and the hashed filename is not a stable URL to link to.

### Decision

Make `packages/embed` self-contained: replace its runtime dependency on `@envelope/shared`'s zod
schema with a small hand-written protocol validator inside the package, checked against the shared
schema by a parity test so the two cannot silently diverge. `@envelope/shared` moves to a
dev-only dependency, used solely by that test. Build the package with Vite in library mode,
producing both an ES module and an IIFE global (`EnvelopeEmbed`), so it works with either a
`<script type="module">` or a plain `<script>` tag.

Serve it from the API at a stable, versioned URL (`GET /api/v1/embed/sdk/v1/envelope.js` and
`.mjs`), not from a CDN or npm. The API already owns the one other piece of infrastructure a
partner's browser loads cross-origin — the embed frame HTML (`embed-frame.controller.ts`) — so it
also owns the header discipline (`Cross-Origin-Resource-Policy: cross-origin`,
`Access-Control-Allow-Origin: *`, caching, an ETag) a script loaded from a different origin needs;
`helmet()`'s default `same-origin` CORP would otherwise silently block the load in a partner's
browser. The `v1` path segment is the versioning mechanism: a breaking SDK change ships at `/sdk/v2/`
rather than mutating what `/sdk/v1/` serves.

Publish a runnable, dependency-free example partner application (`examples/embedded-partner/`) that
uses this hosted script, and have the existing browser end-to-end suite exercise that example
directly (via `embed-host.ts`) instead of a parallel, partner-invisible fixture.

Rejected: publishing to npm or a public CDN now (adds an external release and support obligation
this phase does not need — the hosted-script path already solves "a partner can use this without
joining the monorepo"); keeping the Vite-hashed asset as the distribution mechanism (the filename
changes on every build, so nothing outside this repository can link to it reliably); rewriting the
SDK to avoid a build step entirely by hand-authoring plain JavaScript (loses TypeScript source and
the existing test suite for no benefit once the package builds cleanly on its own).

### Consequences

**Easier:** a partner integrates with one `<script>` tag and no build step; the SDK's protocol
logic is exercised by its own tests without depending on the shared package's zod version at
runtime; the package could be published to npm later with no further extraction work, since it
already has no runtime workspace dependency.

**Harder:** the protocol validator and the shared zod schema must be kept in sync by the parity
test, rather than sharing one implementation; the API takes on serving and versioning a static
asset it previously never needed to.

**Accepted:** no CDN, npm publication or subresource-integrity hash in this phase — the API-hosted
script is the sole distribution mechanism, versioned by path segment only.
