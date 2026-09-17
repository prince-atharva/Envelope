# Phase 1: Foundation Plan

| | |
|---|---|
| **Status** | Complete — released as `v0.1.0` |
| **Version** | 1.1.0 |
| **Last updated** | 17 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 1 deliver, how is each part built, how do we run and check it, and what is left? |

---

# PART 1: In Plain Terms

## What Phase 1 Is

Phase 1 is the **foundation** of Envelope by HealthProHub: weeks 1–2 of the roadmap in
[11-implementation-roadmap.md](11-implementation-roadmap.md). It does not collect signatures yet.
It builds the parts everything else stands on:

```
   ACCOUNTS ─────────► people can sign up and sign in securely
   UPLOAD ───────────► a PDF is checked for danger, fingerprinted and stored safely
   VIEWER ───────────► the PDF is shown page by page on a laptop or a phone
   RECORD ───────────► every upload is written into a tamper-evident history
   LOGS ─────────────► every step the system takes is written down, secrets excluded
   EMAIL ────────────► the system can send email (a welcome email for now)
```

## What You Can Do at the End of Phase 1

1. Open the website, create an account, and receive a welcome email.
2. Upload a PDF of up to 25 MB and 500 pages.
3. See the document on screen, zoom from 50% to 200%, and move between pages, on desktop and on a phone.
4. See the document's **fingerprint** (SHA-256) and check it against the file you downloaded.
5. See the document's history. That history cannot be edited or deleted, even by the application itself.

## The Phase 1 Finish Line

Phase 1 is finished when all four of these are true (from doc 11):

- [x] A 12-page PDF uploads and appears correctly at 100% and 200%, on desktop and at phone width
- [x] The first version of the document (version 0) and its fingerprint are saved in the database
- [x] The database refuses any change or deletion of the history (audit trail)
- [x] Automated checks (tests and CI) cover all of the above

## Progress

| # | Step | Status |
|---|---|---|
| 0 | Fresh start: new git history | ✅ Done |
| 1 | Project skeleton (monorepo, pnpm, Biome, TypeScript) | ✅ Done |
| 2 | Local infrastructure (database, queue, file storage) | ✅ Done |
| 3 | Database design and protection of the history | ✅ Done |
| 4 | API foundation and **logging** | ✅ Done |
| 5 | Accounts: sign up, sign in, sessions | ✅ Done |
| 6 | Safe PDF upload, storage and history | ✅ Done |
| 7 | Email through a background worker (Gmail) | ✅ Done |
| 8 | Web app: sign-in pages, dashboard, upload, PDF viewer | ✅ Done |
| 9 | Documentation updates and a record of the stack decision | ✅ Done |
| 10 | Browser tests and automatic checks (CI) | ✅ Done |

## What We Need From You

| Needed | Why | When |
|---|---|---|
| **A Gmail App Password** in `.env` (`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) | Real emails can't be sent without it. A normal Gmail password will not work. | Now |
| HealthProHub logo and brand colours | The app uses placeholder colours until then | Week 2 |
| Lawyer-approved consent wording for e-signatures | Needed before signing (Phase 3) | Before Phase 3 |
| Which countries customers are in, and where data must be stored | Legal settings and storage location | Before Phase 3 |

**How to create a Gmail App Password:** go to Google Account → Security, turn on 2-Step
Verification, open **App passwords**, create one called "Envelope", and copy the
16-character code into `SMTP_PASSWORD` in `.env`. Never share it and never commit it.

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions

| Area | Choice | Note |
|---|---|---|
| Repository | One repo, **pnpm** workspaces: `apps/api`, `apps/web`, `packages/shared` | pnpm 10.20, Node 22 |
| API | **NestJS 12**, TypeScript 6 (strict), Express 5 | Replaces Next.js from doc 04; see ADR 0012 (step 9) |
| Web | **React 19 + Vite 8**, Tailwind CSS 4, React Router 8, TanStack Query 5 | Talks to the API through the Vite proxy (`/api`) |
| Shared code | `@envelope/shared`: zod schemas, error codes, limits, brand | The coordinate module joins it in Phase 2 |
| Database | PostgreSQL 16, **Prisma 7** with the `pg` driver adapter | The app runs as a restricted role |
| Queue | Redis 7 + **BullMQ 6** | The worker is a separate process |
| Files | S3 API: **MinIO** locally, Cloudflare R2 / AWS S3 later | Random object keys |
| Email | **Gmail SMTP** via nodemailer (App Password) | No Mailpit; tests use an in-memory transport |
| PDF | `pdf-lib` on the server, `pdfjs-dist` 6 in the browser | |
| Logging | **pino** (nestjs-pino), JSON files with daily rotation | See "Logging" below |
| Lint and format | **Biome 2** | No ESLint or Prettier |
| Tests | Vitest (unit and API e2e), Playwright (browser) | |

## Repository Layout

```
digital signature/
├── apps/
│   ├── api/                      NestJS API and worker
│   │   ├── prisma/               schema.prisma and migrations (with hand-written SQL)
│   │   ├── src/
│   │   │   ├── main.ts           API entry point (HTTP)
│   │   │   ├── worker.ts         worker entry point (queues, no HTTP)
│   │   │   ├── config/           environment validation (zod)
│   │   │   ├── logging/          pino setup, redaction, request ids
│   │   │   ├── common/           problem+json errors, validation, rate limiting
│   │   │   ├── auth/             sign-up, sign-in, sessions, guard
│   │   │   ├── uploads/          PDF hardening pipeline, active-content removal
│   │   │   ├── envelopes/        upload, list, detail, file download
│   │   │   ├── audit/            hash-chained audit trail
│   │   │   ├── storage/          S3 / MinIO
│   │   │   ├── mail/ queue/      email jobs, templates, worker processor
│   │   │   ├── prisma/ redis/    database and Redis clients, tenant scoping
│   │   │   └── health/ client-logs/
│   │   └── test/                 API e2e suites, fixtures, helpers
│   └── web/                      React app
│       └── src/  app/ lib/ components/ pages/ routes/ styles/
├── packages/shared/              code used by both apps
├── docker/postgres/init/         creates the restricted app role and the test database
├── docs/                         product specification (this folder)
├── docker-compose.yml  biome.json  pnpm-workspace.yaml  tsconfig.base.json
└── .env.example  CHANGELOG.md  README.md
```

## How the Pieces Connect

```
   Browser ──► Vite (web, :5173) ──/api proxy──► NestJS API (:4000)
                                                   │   │    │
                                  PostgreSQL :5545 ◄┘   │    └──► MinIO :9102 (PDFs)
                                                        │
                                          Redis :6391 ◄─┘ (BullMQ "email" queue)
                                                        │
                                   Worker process ◄─────┘──► Gmail SMTP (smtp.gmail.com:587)

   Every log line from the API and the worker goes to stdout and to logs/*.log,
   tagged with the same requestId from the browser through to the worker.
```

---

## Step-by-Step Plan

Every step ends with lint, typecheck, tests and **one git commit**. The commits listed are in
`git log`.

### Step 0: Fresh start ✅

- Removed the old `.git` (old SignFlow history, no remote) and ran `git init -b main`.
- Kept `docs/` as the specification.

### Step 1: Monorepo skeleton ✅ (commit `4901491`)

**Built:** `package.json` (root scripts), `pnpm-workspace.yaml` (workspaces plus the list of
packages allowed to run install scripts), `tsconfig.base.json` (strict), `biome.json`,
`.gitignore`, `.editorconfig`, `.nvmrc`, `CHANGELOG.md`, and `packages/shared` (brand, limits,
full error catalog).

**How:**
```bash
pnpm install          # also builds packages/shared
pnpm lint             # biome check .
pnpm typecheck
pnpm test
```

### Step 2: Local infrastructure ✅ (commit `ff183ae`)

**Built:** `docker-compose.yml` with the project name pinned to `digitalsign`, all ports bound to
127.0.0.1, and `docker/postgres/init/01-roles.sh`.

| Service | Port | Notes |
|---|---|---|
| PostgreSQL 16 | 5545 | Databases `digitalsign` and `digitalsign_test`, role `digitalsign_app` |
| Redis 7 | 6391 | AOF on, `noeviction` (required by BullMQ) |
| MinIO | 9102 (API), 9103 (console) | Buckets `digitalsign-documents` and `digitalsign-test` |

**How:**
```bash
cp .env.example .env       # then fill in Gmail and the two secrets (openssl rand -base64 48)
docker compose up -d
docker compose ps          # all services "healthy"
```

### Step 3: Database ✅ (commit `feb28bf`, plus a second migration in `84c6437`)

**Built:** `apps/api/prisma/schema.prisma`, following doc 05, with these additions:

- `Tenant`, `Session` and `User.role`; every id is a native `uuid`.
- `AuditTrail` foreign keys are **RESTRICT**. Postgres runs cascades as the table owner, so a
  cascade could delete audit rows the app role is not allowed to touch.
- `AuditTrail.sequence` numbers each envelope's events 1, 2, 3, … (second migration).

The migration SQL also includes hand-written rules:

- CHECK constraints on field ratios, page numbers, routing order, versions and hash format;
- a partial unique index allowing one final version per envelope;
- **grants**: `digitalsign_app` gets full read/write access, except that on `AuditTrail` it may
  only `SELECT` and `INSERT`.

**How:**
```bash
pnpm db:migrate    # prisma migrate dev (interactive; run it yourself in a terminal)
pnpm db:deploy     # prisma migrate deploy (non-interactive; CI and production)
pnpm db:studio
```

> **Rule:** never edit a migration that has been committed. Add a new one. If `migrate dev`
> cannot run (for example, no terminal), generate the SQL with
> `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
> save it as a new migration folder, and apply it with `pnpm db:deploy`.

**Verified:** as `digitalsign_app`, UPDATE, DELETE and TRUNCATE on `AuditTrail` fail with
*permission denied*, and deleting an envelope that has history fails the foreign-key check.

### Step 4: API foundation and logging ✅ (commit `e5db0cd`)

**Built:**
- Environment validation: the API refuses to start with a missing or weak setting, and the error
  names the variable but never its value.
- RFC 7807 `application/problem+json` for every error, using the shared error codes.
- `GET /api/v1/health` (database, Redis, storage; 503 when degraded) and `/health/live`.
- `POST /api/v1/client-logs` for browser errors (20/min, 8 KB).
- Global rate limit, helmet, cookies, optional CORS, and Swagger at `/api/docs`.
- **Logging** (see the full section below).

### Step 5: Accounts ✅ (commit `1c0c889`)

**Built:**
- `POST /auth/register` creates a workspace and its owner, then sends a welcome email.
- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` and `GET /auth/me`.
- Passwords are hashed with **Argon2id** (19 MiB, t=2, p=1). Unknown emails take as long as
  wrong passwords, so accounts cannot be discovered by timing.
- **Access token:** a 15-minute JWT held only in browser memory. A global guard checks it, and
  routes that don't need it are marked `@Public()`.
- **Refresh token:** kept in an httpOnly, SameSite=Strict cookie on the `/api/v1/auth` path. Only
  its HMAC is stored in the database, and it changes on every use.
  - Reusing an old refresh token ends every session from that login.
  - A 30-second grace period stops two open tabs from logging each other out.
- Rate limits: registration 10/hour, login 10/min and refresh 30/min, each per IP.

### Step 6: Safe upload, storage and history ✅ (commit `84c6437`)

**Built:** the doc 10 upload pipeline, in this order:

```
 1 size        ─► Content-Length checked before reading; multer caps at 25 MB
 2 magic bytes ─► must start with %PDF-  (name and Content-Type are ignored)
 3 parse       ─► damaged → INVALID_PDF · password-protected → ENCRYPTED_PDF
 4 pages       ─► more than 500 → PAGE_LIMIT_EXCEEDED
 5 scan        ─► malware-scanner interface (pass-through for now, clearly logged)
 6 clean       ─► remove JavaScript, launch/submit actions, auto-actions,
                  attachments and XFA; keep web links; clean files are unchanged
 7 store       ─► tenants/<tenant>/envelopes/<id>/v0-<uuid>.pdf in MinIO
```

Then, in **one database transaction**: the Envelope (DRAFT), DocumentVersion 0 (SHA-256, pages,
size) and the audit event `ENVELOPE_CREATED`. If the transaction fails, the stored file is
deleted again.

- **Endpoints:** `POST /envelopes` (multipart `file`, optional `title`), `GET /envelopes`
  (cursor paging), `GET /envelopes/:id` and `GET /envelopes/:id/file?version=0`.
- **Tenant isolation:** a Prisma extension adds `tenantId` to every envelope query. Another
  tenant's ids and malformed ids get the same 404 as ids that don't exist.
- **Audit chain:** `eventHash = SHA-256(prevHash | action | timestamp | payload)`.
  `AuditService.verify()` finds the exact broken event and logs an alert.
- **Rate limit:** 20 uploads/min per tenant.

**Verified by hand:** a 12-page PDF was uploaded and downloaded, and `sha256sum` of the download
matched the recorded hash.

### Step 7: Email and background worker ✅ (commit `458f473`)

**Built:**
- **Queue:** a BullMQ `email` queue. The API only adds jobs; `src/worker.ts` sends them.
- **Gmail SMTP:** STARTTLS is required and connections are pooled. At startup the worker checks
  the login and explains failures (for example, 535 means *Gmail needs an App Password*).
- **Retries:** 5 attempts at 10s, 20s, 40s and 80s. Each retry is logged as `warn`; a final
  failure is logged as `error` with `alert: true`.
- **Traceability:** each job carries the `requestId` of the API call that created it.
- **Welcome email:** branded, with every user value HTML-escaped. There is one per user, and
  sign-up still succeeds if the queue is down.

**How:**
```bash
pnpm --filter @envelope/api dev   # compiles once, runs API + worker together
pnpm --filter @envelope/api start:worker   # worker only, from a build
```

### Step 8: Web app ✅ (commit `0422b11`)

**Built:**

| Part | What it does |
|---|---|
| `lib/api.ts` | fetch wrapper: access token in memory, `X-Request-Id` on every call, one silent refresh on 401 (shared between callers), problem+json errors, XHR upload with progress |
| `lib/auth.tsx` | `AuthProvider`: restores the session from the cookie on load, login/register/logout, clears cached data on logout |
| `lib/logger.ts` | browser errors (error boundary, `window.onerror`, `unhandledrejection`) → `POST /api/v1/client-logs` with the last request id; de-duplicated, capped, URL without query string |
| Pages | `/login`, `/register`, `/dashboard` (list, load more, empty state), `/dashboard/new` (drag and drop, 25 MB and PDF checks, progress bar), `/dashboard/envelopes/:id` (details, fingerprint with copy button, versions, history, viewer, download) |
| `components/pdf/PdfViewer` | pdf.js 6: pages render only near the screen, sharp on high-DPI screens (canvas size capped for iPhone), zoom from fit-width to 50–200%, page navigation, works at phone width |
| Branding | `Logo` (Envelope · by HealthProHub), favicon, page titles, brand colours in `styles/index.css` (placeholders) |

The viewer was then reworked in the same commit: a minimal toolbar, focal-point wheel zoom
(Ctrl+Scroll or pinch) with an indicator, faster page jumps, and a detail page with the fingerprint
banner, version cards and a vertical audit timeline.

**How:**
```bash
pnpm --filter @envelope/web dev      # http://localhost:5173 (proxies /api to :4000)
pnpm --filter @envelope/web build
```

**Verified:** sign-up → upload a 12-page PDF → viewer shows 12 pages → zooming from 100% to 200%
makes the pages larger → the fingerprint matches the downloaded file.

### Step 9: Documentation ✅ (commit `docs: add ADR 0012 …`)

- `docs/README.md`: new title, the dead links to the HealthProHub integration folder removed (that
  folder was never written; it is Phase 6 work), and this document listed.
- `docs/adr/0012-nestjs-api-and-react-vite-web.md`: why NestJS + React/Vite instead of Next.js, and
  Biome instead of ESLint/Prettier. The one shared coordinate module (doc 04's main argument) is
  kept in `packages/shared`.
  **The number is 0012, not 0002:** the ADR index reserves 0002 to 0011 for decisions already made
  in the design documents, and 0002 belongs to "Store field coordinates as normalised ratios",
  which is written in Phase 2.
- `docs/03` and `docs/04`: stack rows and diagram labels point to ADR 0012.
- Root `README.md`: setup, commands, service URLs, logging guide, known simplifications.

### Step 10: Browser tests and CI ✅ (commits `0422b11` and `ci: …`)

- **Playwright** (`apps/web/e2e/`): sign up → upload the 12-page fixture → 12 pages rendered →
  zoom 100% → 200% makes the canvas larger. Runs in desktop Chromium plus Pixel 7 and iPhone 14
  sizes.
- **`.github/workflows/ci.yml`:**

```
   install (pnpm) ─► Biome ─► typecheck ─► unit tests ─► migration drift check
        ─► API e2e (Postgres, Redis, MinIO from docker compose; MAIL_TRANSPORT=memory)
        ─► Playwright ─► build
```

  The services come from `docker compose up -d --wait` rather than GitHub service containers,
  because Postgres needs the repository's init script mounted to create the restricted role and
  the test database. CI needs no Gmail secrets. It starts running once the repository is pushed to
  GitHub.
- Finally, `CHANGELOG.md` moves to version `0.1.0` and the commit is tagged `v0.1.0`.

---

## Running Everything Locally

```bash
# once
cp .env.example .env                  # fill SMTP_* (Gmail App Password) and both secrets
docker compose up -d
pnpm install
pnpm db:deploy                        # or: pnpm db:migrate (interactive)

# every day
docker compose up -d
pnpm dev                              # shared (watch) + API + worker + web together
```

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:4000/api/v1/health | API health (database, Redis, storage) |
| http://localhost:4000/api/docs | Swagger UI (development only) |
| http://localhost:9103 | MinIO console (user `digitalsign`) |

## Environment Variables

All variables are documented in `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | App role (restricted) / owner role (migrations) |
| `REDIS_URL`, `QUEUE_PREFIX` | Queue connection and key namespace |
| `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_SECRET` | At least 32 characters each, and different from each other |
| `S3_*` | MinIO / R2 / S3 |
| `MAIL_TRANSPORT` | `smtp` (real) or `memory` (tests only; refused in production) |
| `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM` | Gmail: `smtp.gmail.com`, `587`, `false`, your address, App Password |
| `EMAIL_RETRY_BASE_DELAY_MS` | First retry delay (10 s by default) |
| `LOG_LEVEL`, `LOG_PRETTY`, `LOG_FILES_ENABLED`, `LOG_DIR`, `LOG_RETENTION_DAYS` | Logging |
| `TRUST_PROXY`, `CORS_ORIGINS`, `API_DOCS_ENABLED` | HTTP behaviour |

---

## Logging

Logging is a core part of the system. **Every new feature must log its important events and
failures in the same change.**

### Where logs go

| Destination | Content |
|---|---|
| Terminal | Readable single lines in development; JSON otherwise |
| `logs/api.<date>.<n>.log` | Everything from the API at `LOG_LEVEL` and above (JSON) |
| `logs/api-error.<date>.<n>.log` | API errors only |
| `logs/worker.<date>.<n>.log` / `logs/worker-error.<date>.<n>.log` | Same for the worker |

Files rotate daily, and the last 14 are kept. `logs/` is never committed.

### What every line contains

`time`, `level`, `service` (api/worker), `env`, `version`, `pid`, `hostname`, `context` (the
class), and when known `requestId`, `userId` and `tenantId`. Worker lines add `jobId`, `queue`
and `template`.

### What is logged

| Area | Events |
|---|---|
| HTTP | One line per request: method, route pattern, status, duration, IP, user agent, error code. 4xx as warn, 5xx as error |
| Startup and shutdown | Config summary (no secrets), dependency checks, "listening", graceful shutdown, fatal crashes (flushed before exit) |
| Auth | Registered, login succeeded, login failed (with reason), session refreshed, **refresh-token reuse (warn)**, logged out, invalid token, rate limit hit |
| Upload | Each pipeline step (debug), accepted or rejected (step and code), active content removed |
| Storage | Object stored, read or deleted: key, bytes, duration |
| Audit | Event recorded (hash); **write failure or broken chain → error with `alert: true`** |
| Database and Redis | Slow queries (over `DB_SLOW_QUERY_MS`), Prisma errors, Redis connection problems (throttled) |
| Queue and email | Job enqueued, started, completed, retrying (warn), **failed permanently (error, alert)**; SMTP check; email sent or failed |
| Browser | Errors reported by the web app (`origin: "browser"`) |

### What is never logged

Passwords, password hashes, access or refresh tokens, cookies, `Authorization` headers, secrets,
signing links (`/sign/<token>` becomes `/sign/[redacted]`) and credentials inside URLs. Emails are
logged masked (`r***@example.com`). **File names and document titles are not logged**, because
they can contain patient data. A unit test fails if any secret reaches a log line, and the e2e
tests check that no password or token is ever passed to a logger.

### Following one request

```bash
grep '"requestId":"<id from the X-Request-Id header or the error body>"' logs/*.log
```

The same id appears in the API lines, in the worker lines for jobs that request queued, and in
browser error reports (`lastRequestId`).

---

## Git Workflow

- **One commit per step**, in [Conventional Commits](https://www.conventionalcommits.org) style
  (`feat(api): …`, `chore: …`, `docs: …`, `ci: …`), each ending with the co-author line.
- Before every commit: `pnpm lint && pnpm typecheck && pnpm test`, plus
  `pnpm --filter @envelope/api test:e2e` when the API changed.
- **Secret check** before every commit: no `.env`, `logs/`, `dist/` or generated client in
  `git status`.
- Every commit also adds an entry to `CHANGELOG.md` under `[Unreleased]`.
- There is no remote yet. Pushing starts once a GitHub repository exists.

## Tests

| Command | What runs |
|---|---|
| `pnpm test` | Unit tests: config, redaction, errors, PDF pipeline, audit chain, slugs, templates, shared schemas |
| `pnpm --filter @envelope/api test:e2e` | Real API and worker against `digitalsign_test`, Redis db 1 and the `digitalsign-test` bucket |
| `pnpm --filter @envelope/web test:e2e` | Playwright (step 10) |

The e2e setup applies migrations with `prisma migrate deploy` and empties tables between suites.
It only ever runs against a database whose name ends in `_test`. Prisma blocks
`migrate reset` when an AI agent runs it, and the setup does not need it.

## Phase 1 Exit Checklist

- [x] Monorepo, pnpm, Biome, strict TypeScript
- [x] Docker infrastructure healthy
- [x] Schema and migrations; audit table cannot be changed or deleted by the app (tested)
- [x] Sign-up and sign-in with Argon2id; rotating refresh sessions with reuse detection (tested)
- [x] Upload hardening: size, magic bytes, damaged or encrypted files, page limit, scan hook, active-content removal (tested)
- [x] Version 0 and SHA-256 saved; download hash matches (tested and checked by hand)
- [x] Tenant isolation (tested)
- [x] Hash-chained audit trail with verification (tested)
- [x] Welcome email via worker and Gmail SMTP; retries and alerts (tested with the in-memory transport)
- [x] Structured, redacted logging with request ids across API and worker
- [x] Web app: auth pages, dashboard, upload, PDF viewer at 100% and 200% on desktop and mobile
- [x] Docs updated, ADR 0012 written
- [x] Playwright smoke test and GitHub Actions CI
- [ ] Real welcome email received in a Gmail inbox (needs your App Password) — **still open**
- [x] `CHANGELOG` 0.1.0 and tag `v0.1.0`

## Known Simplifications (Deliberate)

| Simplification | Planned fix |
|---|---|
| PDF checks run inside the upload request, not on an isolated worker | Moves to the worker with the sealing engine (Phase 4) |
| Malware scanning is a pass-through (and says so in the logs) | ClamAV in hardening (Phase 5) |
| Rate limits are counted in memory (one API instance) | Redis-backed storage before running several instances |
| No Row-Level Security in Postgres yet (the Prisma extension enforces tenant isolation) | RLS as a second layer in hardening |
| Audit table is not partitioned | Monthly partitions when volume requires |
| Only the welcome email template exists | Invitation, reminder and completion emails in Phase 3 |

## After Phase 1

| Phase | Weeks | Delivers |
|---|---|---|
| 2 | 3–4 | Field builder. `packages/shared/src/coordinates.ts` comes first, with its tests. See [13-phase-2-field-builder-plan.md](13-phase-2-field-builder-plan.md) |
| 3 | 5–6 | Signer portal: tokens, consent, signature pad, tested on a real iPhone |
| 4 | 7–8 | Sealing engine: burn-in, certificate, version chain, `sha256sum` check |
| 5 | 9–10 | Hardening: reminders, expiry, webhooks, security review, load test |
| 6 | Later | HealthProHub integration: embed SDK, API keys, dual-mode SaaS |

Each phase starts with its own plan document like this one.
