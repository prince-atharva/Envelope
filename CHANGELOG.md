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
