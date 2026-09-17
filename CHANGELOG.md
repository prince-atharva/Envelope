# Changelog

All notable changes to Digital Sign by HealthProHub are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- pnpm workspace monorepo: `apps/*` and `packages/*`, Node 22, TypeScript 6 in strict mode.
- Biome 2 for linting and formatting (no ESLint or Prettier). NestJS parameter decorators are
  enabled, `dangerouslySetInnerHTML` is an error, and `console.log` is not allowed.
- `@digitalsign/shared` package: brand constants, upload and password limits, and the full error
  catalog (codes and HTTP statuses) from docs/08 plus the upload-hardening errors.
- Local infrastructure in `docker-compose.yml` (project name pinned to `digitalsign`, ports bound
  to 127.0.0.1): PostgreSQL 16 on 5545, Redis 7 on 6391 (AOF, `noeviction` for BullMQ), and MinIO
  on 9102 (S3 API) and 9103 (console), with `digitalsign-documents` and `digitalsign-test` buckets.
- Postgres init script: creates the restricted runtime role `digitalsign_app` and the
  `digitalsign_test` database.
- `.env.example` documents every variable, including Gmail SMTP with an App Password. There is no
  Mailpit.
- Database schema (Prisma 7 with the `pg` driver adapter) following docs/05, plus `Tenant`,
  `Session` (refresh-token rotation) and `User.role`. All ids are native `uuid` columns.
  Migrations run as the schema owner (`DIRECT_DATABASE_URL`).
- Initial migration with hand-written invariants:
  - field ratio range and stay-on-page CHECKs;
  - positive page numbers, routing orders and page counts;
  - at most one final `DocumentVersion` per envelope;
  - audit hashes must be 64-character hex.
- Runtime role grants: `digitalsign_app` gets CRUD on every table, but only SELECT/INSERT on
  `AuditTrail`. It has no access to the migration ledger.
- AuditTrail foreign keys use `RESTRICT` on delete and update. Postgres runs cascades as the table
  owner, so docs/05's `CASCADE`/`SET NULL` would have let the app remove or rewrite audit rows.
- NestJS 12 API foundation (`apps/api`), served under `/api/v1`, with Swagger UI at `/api/docs`
  (off by default in production).
- Startup config check (zod): the API refuses to boot with a missing or weak setting. Error messages
  name the variable, never its value.
- Structured logging with pino:
  - One line per request: method, route pattern, status, duration, IP, user agent and error code.
    4xx is logged as `warn`, 5xx as `error`.
  - `X-Request-Id` is accepted or generated, returned on every response, and included in every log
    line and error body.
  - Daily-rotated JSON files: `logs/api.<date>.<n>.log`, plus `logs/api-error.<date>.<n>.log` for
    errors only (14 files kept by default).
  - Readable single-line console output in development.
  - Passwords, tokens, cookies, `Authorization` headers, secrets, signing links and URL credentials
    are redacted. A unit test fails if any of them leaks.
  - Also logged: startup config summary (no secrets), dependency checks, slow queries (over
    `DB_SLOW_QUERY_MS`), Redis connection problems (throttled), rate-limit hits, graceful shutdown,
    and fatal crashes. Buffered log lines are flushed before the process exits.
- RFC 7807 `application/problem+json` for every error, built from the shared error catalog.
  Unexpected errors hide their detail from the client and are logged with a stack trace.
- `GET /api/v1/health` (Postgres and Redis, 503 when degraded) and `GET /api/v1/health/live`.
- `POST /api/v1/client-logs`: browser error reports go into the server logs. Limited to 20/min per
  IP and 8 KB per report.
- Global rate limit of 300 requests/min per IP, plus helmet security headers, cookie parsing and
  optional CORS.
- Sender accounts:
  - `POST /api/v1/auth/register` creates a workspace (tenant) and its owner. Limited to 10/hour per
    IP.
  - `POST /api/v1/auth/login` (limited to 10/min per IP), `refresh`, `logout`, and `GET me`.
  - Passwords are hashed with Argon2id (19 MiB, t=2, p=1, OWASP parameters). Old hashes are
    upgraded on login. Unknown emails take the same time and get the same error as wrong
    passwords.
  - Access tokens are 15-minute HS256 JWTs, kept in memory by the browser. Every route requires one
    unless it is marked `@Public()`, and the token's session must still be active.
  - Refresh tokens are 32 random bytes in an httpOnly, SameSite=Strict cookie scoped to
    `/api/v1/auth`. Only an HMAC of the token is stored, and it is rotated on every use.
  - Reusing an old refresh token revokes every session from that login. A 30-second grace window
    lets two tabs refresh at once without logging the user out.
  - Auth events are logged: registration, login success or failure (with the reason), refresh,
    token reuse (warn), logout, and invalid tokens. Emails are partly masked. User and tenant ids
    are attached to the rest of each request's log lines.
- End-to-end test suite (`pnpm --filter @digitalsign/api test:e2e`):
  - Runs against the `digitalsign_test` database, Redis db 1 and the `digitalsign-test` bucket,
    with in-memory email.
  - The schema is applied with `prisma migrate deploy`, and tables are emptied between suites.
    Prisma refuses `migrate reset` when an AI agent runs it, and deploy never drops anything.
  - Tests check what was logged and that no password or token ever reached a logger.
