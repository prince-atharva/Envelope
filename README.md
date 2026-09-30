# Envelope powered by HealthProHub

An electronic signature platform. Upload a PDF, mark where people sign, and send them a link.
Signers sign in their browser on any device without creating an account. Every signature is burned
into the PDF, sealed with a certificate and backed by a tamper-evident audit trail.

> **Status:** Phases 1–6 are complete and Phase 7 (integrations) is released; the latest version is in
> [`CHANGELOG.md`](CHANGELOG.md). The specification is in [`docs/`](docs/README.md), and each phase
> has its own plan, from [Phase 1](docs/12-phase-1-foundation-plan.md) to
> [Phase 7](docs/18-phase-7-integration-plan.md).

## Building on Envelope

Any application can send documents for signature, hear about the result and embed the sender editor:

| I want to… | Start here |
|---|---|
| Send and track documents from my server | [`docs/developers/quick-start.md`](docs/developers/quick-start.md) |
| Receive signed notifications | [`docs/developers/webhooks.md`](docs/developers/webhooks.md) |
| Put the editor in my own page | [`docs/developers/embedded-editor.md`](docs/developers/embedded-editor.md) and the runnable [`examples/embedded-partner`](examples/embedded-partner/README.md) |
| Generate a client | [`docs/developers/openapi.json`](docs/developers/openapi.json), or `/api/docs` in development |

The [developer guide](docs/developers/README.md) is a standalone folder a partner can be handed. It
and the served OpenAPI document are generated from one catalog
([ADR 0021](docs/adr/0021-one-integration-contract-catalog.md)) that tests compare with the code.

## Repository layout

```
apps/
  api/        NestJS API and background worker   (@envelope/api)
  web/        React + Vite sender app            (@envelope/web)
packages/
  shared/     schemas, error codes, limits, the integration contract   (@envelope/shared)
  embed/      the embedded-editor SDK, served by the API as a script   (@envelope/embed)
examples/     runnable, dependency-free partner example
docker/       Postgres init script (restricted role, test database)
docs/         specification, architecture, roadmap, phase plans, developers/ guide
logs/         JSON log files, rotated daily (never committed)
```

The API and the web app are separate on purpose. See
[ADR 0012](docs/adr/0012-nestjs-api-and-react-vite-web.md).

## Requirements

- Node 22 (see `.nvmrc`) and pnpm 10
- Docker and Docker Compose
- A Gmail account with an **App Password** for outgoing email
- `jq`, `curl` and `uuidgen` if you want to run the quick-start script

## Setup

```bash
cp .env.example .env      # then set the Gmail SMTP values and two random secrets
docker compose up -d      # Postgres :5545, Redis :6391, MinIO :9102 (console :9103)
docker compose up -d clamav   # optional: ClamAV :3310 for MALWARE_SCANNER=clamav (first start downloads signatures)
pnpm install
pnpm db:deploy            # apply migrations (or pnpm db:migrate to create one)
pnpm dev                  # shared (watch) + API + worker + web
```

Generate the two secrets with `openssl rand -base64 48`. `JWT_ACCESS_SECRET` and
`REFRESH_TOKEN_SECRET` must differ, and the API refuses to start if either is missing or weak.

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:4000/api/v1/health | API health (database, Redis, storage) |
| http://localhost:4000/api/docs | Swagger UI and `openapi.json` (development, or `API_DOCS_ENABLED=true`) |
| http://localhost:9103 | MinIO console (user `digitalsign`) |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Everything together, in watch mode |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome (no ESLint or Prettier) |
| `pnpm typecheck` | TypeScript, strict, across all packages |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm --filter @envelope/api test:e2e` | API end-to-end tests against the test database |
| `pnpm --filter @envelope/web test:e2e` | Playwright browser tests, on their own isolated stack |
| `pnpm build` | Build every package, including the embed SDK the API serves |
| `pnpm db:migrate` / `db:deploy` / `db:studio` | Prisma |

Before every commit: `pnpm lint && pnpm typecheck && pnpm test`, plus the API e2e tests when the
API changed.

**Tests never touch your development setup.** Neither test suite reads `.env`, uses the
`digitalsign` database, or sends real email:

- The API e2e suite uses the `digitalsign_test` database, Redis database 1, the `digitalsign-test`
  bucket and in-memory email.
- The browser tests build and start their own API, worker and web app on ports 4100 and 5174
  (`apps/web/e2e/stack`). They use the same test database, Redis database 2 and file-only email,
  which is written to `apps/web/.e2e/outbox`. They run happily while `pnpm dev` is running.
- `E2E_REUSE_STACK=1` reuses a stack that is already running, for quick repeat runs.
- The API refuses `MAIL_TRANSPORT=smtp` whenever `NODE_ENV=test`.

## Logging

Logging is part of every feature, not an afterthought.

- Terminal output is readable in development, JSON elsewhere.
- Files are written to `logs/api.<date>.<n>.log` and `logs/worker.<date>.<n>.log`, with
  errors-only companions, rotated daily and kept for 14 days.
- Every line carries `time`, `level`, `service`, `env`, `version`, and, where known, `requestId`,
  `userId` and `tenantId`. Worker lines add `jobId` and `queue`.
- Follow one request end to end: `grep '"requestId":"<id>"' logs/*.log`. The id comes from the
  `X-Request-Id` response header or from an error body.
- **Never logged:** passwords, tokens, cookies, `Authorization` headers, secrets, signing links,
  file names or document titles (they can contain patient data). Emails appear masked, as
  `r***@example.com`. Unit tests fail if any of these leak.

## Naming

The product was renamed from "Digital Sign" to **Envelope powered by HealthProHub**. The
packages are `@envelope/*`. Infrastructure identifiers deliberately keep the old name — the
`digitalsign_app` database role, the `digitalsign` Compose project, the bucket names and the
`urn:digitalsign:error:` problem type. Renaming them would mean recreating volumes, writing a
migration and breaking existing error references, for no functional gain.

## Deliberate simplifications

Each phase plan lists what it chose not to build, and why, under "Deliberate Simplifications":
see [docs/17](docs/17-phase-6-compliance-plan.md) and [docs/18](docs/18-phase-7-integration-plan.md)
for the current ones. Nothing in this README is a substitute for those lists.

## Changing the integration surface

Which routes accept an API key, what each webhook carries and what each error means live in
`packages/shared/src/integration-contract.ts`. After changing it, regenerate the reviewable copies
and commit them with the change:

```bash
UPDATE_DEVELOPER_DOCS=1 pnpm --filter @envelope/api test     # docs/developers tables
UPDATE_OPENAPI=1 pnpm --filter @envelope/api test:e2e           # docs/developers/openapi.json
```

## Security

- Passwords use Argon2id. Refresh tokens are rotated, and reuse revokes every session from that
  login.
- The audit trail is hash-chained, and the application's database role cannot update or delete it.
- Uploads are checked by magic bytes, parsed, page-limited and stripped of active content.
- Never commit `.env`, `logs/`, `dist/` or the generated Prisma client.
