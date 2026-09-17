# 0012. Build a NestJS API and a React + Vite Web App Instead of One Next.js App

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Engineering, product owner

> Number note: 0002 to 0011 are reserved for the decisions listed as "Planned" in
> [README.md](README.md), so this record takes the next free number.

## Context

[04-technology-stack.md](../04-technology-stack.md) chose **Next.js 14 (App Router)** for both
the screens and the server, plus ESLint and Prettier. That choice rested on two arguments:

1. One language, so the coordinate maths exists once and is shared by browser and server.
2. Route handlers remove the need for a separate API tier in v1.

When the project restarted on 2026-09-17, the product owner asked for a **separate backend and
frontend**. Several forces pointed the same way:

- **The API has to outlive the web app.** The HealthProHub integration (Phase 6) calls the API
  directly, and the signer portal must stay a small, separate bundle.
- **Much of the work isn't request/response.** Sealing, email, reminders and retention run in
  worker processes that share modules with the API: config, logging, Prisma, the audit chain.
  Next.js route handlers don't provide that structure.
- **Next.js adds friction.** The PDF.js worker needs configuring under the App Router (doc 11
  already budgets a day for it). Server components also make it easy to leak server-only code or
  secrets into client bundles.
- **Two tools are slower to run and configure than one.** ESLint and Prettier need separate
  configuration and are slow on a monorepo. Biome is a single tool that lints and formats.

The first argument for Next.js, one shared coordinate module, still has to hold.

## Decision

We will build:

- **`apps/api`: NestJS** (TypeScript, strict, Express). It serves the HTTP API under `/api/v1`,
  and a second entry point (`worker.ts`) runs the BullMQ workers from the same codebase.
- **`apps/web`: React + Vite** (Tailwind CSS, React Router, TanStack Query). It calls the API
  through `/api`, which the Vite dev server proxies and a reverse proxy handles in production.
- **`packages/shared`: `@envelope/shared`**. It holds everything both apps must agree on: zod
  schemas, error codes, limits and, from Phase 2, **the coordinates module**. Both apps import
  the same file, so doc 04's "one module, two consumers, one set of unit tests" still holds.
- **pnpm workspaces** in one repository, as doc 04 already specified.
- **Biome** for linting and formatting, instead of ESLint and Prettier.

The rest of doc 04 stands: PDF.js, pdf-lib, PostgreSQL with Prisma, BullMQ with Redis, S3-compatible
storage, Vitest and Playwright.

## Consequences

**Easier:**

- The API is a first-class product with Swagger, versioning and guards. It isn't a by-product of
  the web app.
- The API and the workers share modules, logging and configuration with no duplication.
- The web app is a static bundle and can be served from a CDN. PDF.js runs with ordinary Vite
  asset handling.
- One fast tool (`biome check .`) lints and formats the whole repository.

**Harder:**

- There are two dev servers, a proxy, and CORS or same-origin setup to think about in each
  environment.
- There is no server-side rendering. The sender app doesn't need it, but the signer portal must
  keep its bundle small by hand (code splitting).
- Anything shared has to be built as a package, so `packages/shared` is compiled on install and
  watched in dev.
- Biome covers fewer rules than the ESLint ecosystem. Some checks, such as type-aware promise
  rules, are still in Biome's nursery.

**Accepted:**

- Diagrams and paths in docs 03, 04, 06 and 09 still mention Next.js and `src/lib/...`. They
  describe the design, and this record explains how the build differs: the paths become
  `packages/shared/src/coordinates.ts`, `apps/web/src/...` and `apps/api/src/...`.
- Deployment is two artefacts (an API container and static web files) instead of one.

**Rejected:**

- **Next.js as the only app** (doc 04): the reasons are listed above.
- **Next.js front end plus a NestJS API**: SSR offers the sender app nothing, and it would
  bring the PDF.js worker friction back.
- **Express or Fastify without NestJS**: Phase 1 already needs dependency injection, guards,
  pipes, filters and a separate worker entry point. Hand-built versions of those would drift.
