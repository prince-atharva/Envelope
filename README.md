# Envelope powered by HealthProHub

[![Release](https://img.shields.io/github/v/release/prince-atharva/Envelope?label=release&color=0f766e)](https://github.com/prince-atharva/Envelope/releases/latest)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![Docs](https://img.shields.io/badge/docs-specification%20%2B%20phase%20plans-0f766e)](docs/README.md)

An electronic signature platform. Upload a PDF, mark where people sign, and send them a link.
Signers sign in their browser on any device without creating an account. Every signature is burned
into the PDF, sealed with a certificate and backed by a tamper-evident audit trail.

> **Status:** Phases 1 to 9 are complete. The latest release is
> [**v0.10.0, Phase 9: Templates and bulk send**](https://github.com/prince-atharva/Envelope/releases/tag/v0.10.0).
> The specification is in [`docs/`](docs/README.md), every phase has its own plan, and
> [`CHANGELOG.md`](CHANGELOG.md) lists every change.

## What it does

| | |
|---|---|
| **Send** | Upload a PDF, add signers, approvers and copy-only recipients, place signature, date, text and tick-box fields for each of them, choose sequential or parallel signing, and send |
| **Sign** | A recipient opens a link on any device, agrees to sign electronically, types or draws a signature and finishes. No account, nothing to install, tested on Chrome and on WebKit (Safari on iPhone) |
| **Seal** | Signatures are stamped into the page, a Certificate of Completion is appended, and the finished file is sealed in locked (Object Lock) storage with a hash-chained audit trail anyone can verify |
| **Follow through** | Reminders, deadlines that pause an envelope, more time on request, cancelling, legal hold, retention and audit export |
| **Integrate** | API keys, signed webhooks, partner references and safe retries, a hosted SDK and an embedded sender editor |
| **Stay safe** | Two-factor sign-in, password reset, malware scanning of uploads, jurisdiction rules and roles |

```
  Sender                                  Envelope                                  Recipient
    │  upload PDF, place fields              │                                          │
    ├───────────────────────────────────────►│  validate, scan, strip active content    │
    │  send                                  │  mint one link per person (HMAC only)    │
    │                                        ├─────────────────────────────────────────►│  email with signing link
    │                                        │◄─────────────────────────────────────────┤  consent, sign, finish
    │                                        │  stamp each signature, one version each  │
    │                                        │  certificate + seal + Object Lock        │
    │◄───────────────────────────────────────┤  finished document emailed to everyone   │
    │  audit trail, fingerprint, verify      │  webhooks to the sender's own system     │
```

## Releases, phase by phase

Each phase has a plan in `docs/` that records what was built, the decisions behind it and what was
deliberately left out. Every version is a [GitHub release](https://github.com/prince-atharva/Envelope/releases)
with its own notes.

| Version | Phase | What it delivers | Plan |
|---|---|---|---|
| [v0.10.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.10.0) | **9. Templates and bulk send** | Reusable templates, bulk send from a spreadsheet or the API, and bounce tracking with any mail provider | [docs/20](docs/20-phase-9-templates-bulk-send-plan.md) |
| [v0.9.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.9.0) | **8. Launch readiness** | Password reset, change password, two-factor sign-in (an Owner can require it), malware scanning of uploads | [docs/19](docs/19-phase-8-launch-readiness-plan.md) |
| [v0.8.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.8.0) | **7. Integrations** | Settings for API keys and webhooks, the embedded sender editor, webhook reliability, a hosted SDK, a developer guide | [docs/18](docs/18-phase-7-integration-plan.md) |
| [v0.7.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.7.0) | 7. foundation | Tenant API keys and signed webhooks | [docs/18](docs/18-phase-7-integration-plan.md) |
| [v0.6.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.6.0) | **6. Compliance** | Jurisdiction policy, roles and invitations, legal hold, retention, audit export | [docs/17](docs/17-phase-6-compliance-plan.md) |
| [v0.5.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.5.0) | **5. Envelope lifecycle** | Cancelling, deadlines, more time, automatic reminders | [docs/16](docs/16-phase-5-envelope-lifecycle-plan.md) |
| [v0.4.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.4.0) | **4. Sealing engine** | Stamped signatures, certificate of completion, locked storage, public Verify | [docs/15](docs/15-phase-4-sealing-engine-plan.md) |
| [v0.3.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.3.0) | **3. Signer portal** | Sending, signing links, the public signer experience | [docs/14](docs/14-phase-3-signer-portal-plan.md) |
| [v0.2.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.2.0) | **2. Field builder** | Recipients and fields placed on the page | [docs/13](docs/13-phase-2-field-builder-plan.md) |
| [v0.1.0](https://github.com/prince-atharva/Envelope/releases/tag/v0.1.0) | **1. Foundation** | Accounts, hardened upload, audit trail, logging, test setup | [docs/12](docs/12-phase-1-foundation-plan.md) |

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
docs/         specification, architecture, roadmap, phase plans, ADRs, developers/ guide
logs/         JSON log files, rotated daily (never committed)
```

```
  React + Vite ──► NestJS API ──► Postgres (Prisma)        BullMQ workers
  (sender app,      │    │                                    (email, sealing,
   signer portal)   │    └──► Redis (queues, rate limits) ──►  webhooks, sweeps)
                    └──────► S3-compatible storage (Object Lock for sealed files)
```

The API and the web app are separate on purpose. See
[ADR 0012](docs/adr/0012-nestjs-api-and-react-vite-web.md). Every significant decision has a short
record in [`docs/adr/`](docs/adr/README.md).

## Requirements

- Node 22 (see `.nvmrc`) and pnpm 10
- Docker and Docker Compose
- A Gmail account with an **App Password** for outgoing email
- `jq`, `curl` and `uuidgen` if you want to run the quick-start script

> **Known issue:** the MinIO images that `docker-compose.yml` pulls have been removed upstream, so a
> fresh machine cannot start the local stack until the object store is replaced. See
> [issue #1](https://github.com/prince-atharva/Envelope/issues/1) for the options.

## Setup

```bash
cp .env.example .env      # then replace every `replace-with-…` value, and set the Gmail SMTP values
docker compose up -d      # Postgres :5545, Redis :6391, MinIO :9102 (console :9103)
docker compose up -d clamav   # optional: ClamAV :3310 for MALWARE_SCANNER=clamav (first start downloads signatures)
pnpm install
pnpm db:deploy            # apply migrations (or pnpm db:migrate to create one)
pnpm dev                  # shared (watch) + API + worker + web
```

The API refuses to start if a secret is missing, weak, or reused. Generate the secrets with
`openssl rand -base64 48` and the three encryption keys (`WEBHOOK_SECRET_ENC_KEY`,
`TOTP_SECRET_ENC_KEY`) with `openssl rand -base64 32`. `WEBHOOK_SECRET_ENC_KEY` and
`TOTP_SECRET_ENC_KEY` must differ, as must the JWT, refresh, signing, API-key and embedded-session
secrets. Production also has to choose a malware scanner: `MALWARE_SCANNER=clamav`, or
`MALWARE_SCANNER_ALLOW_NONE=true` to run unscanned on purpose.

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
| `pnpm --filter @envelope/api test:e2e` | API end-to-end tests against the test database (Node 22.19.0) |
| `pnpm --filter @envelope/web test:e2e` | Playwright browser tests, on their own isolated stack |
| `pnpm --filter @envelope/web ui:gallery` | Screenshot every screen and popup into a contact sheet |
| `pnpm build` | Build every package, including the embed SDK the API serves |
| `pnpm db:migrate` / `db:deploy` / `db:studio` | Prisma |

Before every commit: `pnpm lint && pnpm typecheck && pnpm test`, plus the API e2e tests when the
API changed and the browser tests when the web app changed.

**Tests never touch your development setup.** Neither test suite reads `.env`, uses the
`digitalsign` database, or sends real email:

- The API e2e suite uses the `digitalsign_test` database, Redis database 1, the `digitalsign-test`
  bucket and in-memory email.
- The browser tests build and start their own API, worker and web app on ports 4100 and 5174
  (`apps/web/e2e/stack`). They use the same test database, Redis database 2 and file-only email,
  which is written to `apps/web/.e2e/outbox`. They run happily while `pnpm dev` is running.
- `E2E_REUSE_STACK=1` reuses a stack that is already running, for quick repeat runs.
- The API refuses `MAIL_TRANSPORT=smtp` whenever `NODE_ENV=test`.
- Malware scanning is tested against a real local socket that speaks the ClamAV protocol, never a
  real scanner or the internet.

## Logging

Logging is part of every feature, not an afterthought.

- Terminal output is readable in development, JSON elsewhere.
- Files are written to `logs/api.<date>.<n>.log` and `logs/worker.<date>.<n>.log`, with
  errors-only companions, rotated daily and kept for 14 days.
- Every line carries `time`, `level`, `service`, `env`, `version`, and, where known, `requestId`,
  `userId` and `tenantId`. Worker lines add `jobId` and `queue`.
- Follow one request end to end: `grep '"requestId":"<id>"' logs/*.log`. The id comes from the
  `X-Request-Id` response header or from an error body.
- **Never logged:** passwords, tokens, cookies, `Authorization` headers, secrets, signing and
  password-reset links, two-factor codes and secrets, file names or document titles (they can
  contain patient data). Emails appear masked, as `r***@example.com`. Unit tests fail if any of
  these leak.

## Security

- **Sign-in:** Argon2id passwords. Refresh tokens are rotated, and reuse revokes every session from
  that login. Two-factor sign-in (an authenticator app with single-use recovery codes) can be turned
  on by anyone and required by an Owner for the whole workspace; a removed user is disabled and cannot
  get back in through a password reset.
- **Links and keys:** signing, invitation, download and password-reset tokens, API keys and embedded
  credentials are stored only as HMACs. Webhook and two-factor secrets are stored encrypted, under
  separate keys.
- **Evidence:** the audit trail is hash-chained, and the application's database role cannot update
  or delete it. Finished documents are sealed under Object Lock.
- **Uploads:** checked by magic bytes, parsed, page-limited, scanned for malware (ClamAV) and
  stripped of active content. A scanner outage never blocks uploads, but it raises an alert and is
  recorded on the document's audit event.
- **Verified, not assumed:** tests prove cross-tenant isolation, that no signing or reset link
  reaches a log, the database, Redis or a `Referer`, and that a two-factor challenge can never be used
  as an access token.
- Never commit `.env`, `logs/`, `dist/` or the generated Prisma client.

The threat model is [`docs/10-security-and-threat-model.md`](docs/10-security-and-threat-model.md).

## Contributing

Work is organised in phases, each with a written plan, and one commit per plan step.
[`AGENTS.md`](AGENTS.md) is the contract: the phase process, the commands, the test rules and the
mistakes already made once. Start with [`docs/README.md`](docs/README.md) to find the specification
and the current plan.

## Naming

The product was renamed from "Digital Sign" to **Envelope powered by HealthProHub**. The
packages are `@envelope/*`. Infrastructure identifiers deliberately keep the old name: the
`digitalsign_app` database role, the `digitalsign` Compose project, the bucket names and the
`urn:digitalsign:error:` problem type. Renaming them would mean recreating volumes, writing a
migration and breaking existing error references, for no functional gain.

## Deliberate simplifications

Each phase plan lists what it chose not to build, and why, under "Deliberate Simplifications":
see [docs/17](docs/17-phase-6-compliance-plan.md), [docs/18](docs/18-phase-7-integration-plan.md) and
[docs/19](docs/19-phase-8-launch-readiness-plan.md) for the current ones. Nothing in this README is
a substitute for those lists. Not built yet: production packaging and deployment, monitoring, a real
mail provider and a tested backup and restore runbook.

## Changing the integration surface

Which routes accept an API key, what each webhook carries and what each error means live in
`packages/shared/src/integration-contract.ts`. After changing it, regenerate the reviewable copies
and commit them with the change:

```bash
UPDATE_DEVELOPER_DOCS=1 pnpm --filter @envelope/api test     # docs/developers tables
UPDATE_OPENAPI=1 pnpm --filter @envelope/api test:e2e           # docs/developers/openapi.json
```
