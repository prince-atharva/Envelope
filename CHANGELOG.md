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
- Document upload (`POST /api/v1/envelopes`, multipart `file` plus optional `title`), following the
  docs/10 upload-hardening pipeline:
  - Size is checked from Content-Length before the body is read, then again by multer (25 MB).
  - The content must start with `%PDF-`. File names and Content-Type are never trusted.
  - Damaged and password-protected PDFs are rejected, as are PDFs with more than 500 pages.
  - Malware scanning sits behind an interface. For now it is a pass-through that logs clearly that
    no scanning happens.
  - Active content is removed: JavaScript, Launch/Submit/Import/remote actions, automatic
    additional actions, embedded files, file attachments and XFA. Web links are kept. Clean files
    are stored byte-for-byte as uploaded.
  - Each step is logged at debug level, and the outcome at info or warn. File names and titles are
    never logged.
  - Uploads are limited to 20 per minute per tenant.
- Envelopes:
  - A draft envelope, DocumentVersion 0 (SHA-256, page count, size) and an `ENVELOPE_CREATED` audit
    event are created in one transaction. If that transaction fails, the stored file is deleted
    again.
  - Documents are stored in S3/MinIO under `tenants/<tenant>/envelopes/<id>/v0-<uuid>.pdf`.
  - `GET /api/v1/envelopes` (newest first, cursor pagination), `GET /:id` (with versions and audit
    trail) and `GET /:id/file?version=` (streamed PDF).
- Tenant isolation: a Prisma extension adds the signed-in tenant to every envelope query and
  refuses to run a query without one or to write another tenant's rows. Other tenants' ids, and
  malformed ids, get the same 404 as ids that do not exist.
- Hash-chained audit trail:
  - `eventHash = SHA-256(prevHash | action | timestamp | canonical payload)`.
  - A per-envelope `sequence` column (second migration) and an advisory lock keep the chain in
    order.
  - `AuditService.verify()` reports the exact broken event and logs it with `alert: true`. A failed
    audit write is also logged as an alert.
- `/health` now also checks object storage.
- Tests: a 12-page upload whose download's SHA-256 matches, sanitising (checked by an independent
  PDF inspector), each rejection path, a 26 MB upload, tenant isolation, cursor paging, the
  per-tenant upload limit, and that the app role cannot update, delete or truncate audit rows.
- Email through a BullMQ queue and a separate worker process (`apps/api/src/worker.ts`):
  - The API only adds jobs. The worker renders and sends them over real SMTP (Gmail by default)
    with pooled connections and required STARTTLS.
  - At startup the worker checks the SMTP login and logs a clear error for bad credentials (for
    example Gmail's 535 "Username and Password not accepted", with a reminder that Gmail needs an
    App Password). The password is never logged.
  - Failed sends are retried 5 times with exponential backoff (10s, 20s, 40s, 80s). Each retry is
    logged as `warn`, and a job that fails permanently is logged as `error` with `alert: true`.
  - Every log line written during a job carries the job id and the id of the API request that
    queued it, so API and worker logs can be matched.
- Welcome email on sign-up. It is branded, every user-supplied value is HTML-escaped, and there is
  one per user (idempotent job id). If the queue is unavailable, registration still succeeds and
  the failure is logged as an error.
- `MAIL_TRANSPORT=memory` keeps sent messages in memory for tests, so no real email is sent.
  `QUEUE_PREFIX` and `EMAIL_RETRY_BASE_DELAY_MS` are configurable.
- `pnpm --filter @digitalsign/api dev` now compiles once and runs the API and the worker together.
  `start:worker` runs the built worker.
- Tests: an e2e suite runs the real worker in the test process and covers delivery, request-id
  propagation, retries, permanent failure alerts and a queue outage during sign-up. A unit test
  covers the template and its HTML escaping.
