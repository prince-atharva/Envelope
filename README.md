# Envelope powered by HealthProHub

An electronic signature platform. Upload a PDF, mark where people sign, and send them a link.
Signers sign in their browser on any device without creating an account.

> **Status:** Phase 1 (Foundation) is complete — `v0.1.0`. Phase 2 (Field Builder) is in progress.
> The full specification is in [`docs/`](docs/README.md); each phase also has its own plan, starting
> with [Phase 1](docs/12-phase-1-foundation-plan.md).

## Repository layout

```
apps/
  api/        NestJS API and background worker   (@envelope/api)
  web/        React + Vite sender app            (@envelope/web)
packages/
  shared/     schemas, error codes, limits, brand constants, coordinates
docker/       Postgres init script (restricted role, test database)
docs/         product specification, architecture, roadmap, phase plans
logs/         JSON log files, rotated daily (never committed)
```

The API and the web app are separate on purpose. See
[ADR 0012](docs/adr/0012-nestjs-api-and-react-vite-web.md).

## Requirements

- Node 22 (see `.nvmrc`) and pnpm 10
- Docker and Docker Compose
- A Gmail account with an **App Password** for outgoing email

## Setup

```bash
cp .env.example .env      # then set the Gmail SMTP values and two random secrets
docker compose up -d      # Postgres :5545, Redis :6391, MinIO :9102 (console :9103)
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
| http://localhost:4000/api/docs | Swagger UI (development only) |
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
| `pnpm build` | Build every package |
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

## Known simplifications (deliberate)

| Simplification | Planned fix |
|---|---|
| PDF checks run inside the upload request, not on an isolated worker | Moves to the worker with the sealing engine (Phase 4) |
| Malware scanning is a pass-through, and says so in the logs | ClamAV in hardening (Phase 5) |
| Rate limits are counted in memory (one API instance) | Redis-backed storage before running several instances |
| No Row-Level Security in Postgres yet; a Prisma extension enforces tenant isolation | RLS as a second layer in hardening |
| The audit table is not partitioned | Monthly partitions when volume requires it |
| Only the welcome email template exists | Invitation, reminder and completion emails in Phase 3 |

## Security

- Passwords use Argon2id. Refresh tokens are rotated, and reuse revokes every session from that
  login.
- The audit trail is hash-chained, and the application's database role cannot update or delete it.
- Uploads are checked by magic bytes, parsed, page-limited and stripped of active content.
- Never commit `.env`, `logs/`, `dist/` or the generated Prisma client.
