# Engineering Instructions for AI Agents

Read this whole file at the start of every session. It is the contract for how work is done in this
repository: the phase process, the commands, the test rules, and the mistakes already made once.
Claude Code loads it through `CLAUDE.md`; other agents (Codex, Cursor, Copilot, ...) read it
directly.

Detailed step-by-step procedures live next to this file and are loaded when needed:

| Procedure | File | Use it when |
|---|---|---|
| Plan a phase | [.claude/skills/phase-plan/SKILL.md](.claude/skills/phase-plan/SKILL.md) | Starting any new phase or sub-phase |
| Build and commit a phase | [.claude/skills/phase-build/SKILL.md](.claude/skills/phase-build/SKILL.md) | Implementing an approved plan |
| Release | [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md) | A phase is built and its finish line is green |
| Review before commit | [.claude/agents/convention-reviewer.md](.claude/agents/convention-reviewer.md) | After coding, before the verification run |

---

## 1. The Project in One Screen

- **Product:** *Envelope powered by HealthProHub*, an electronic-signature platform (upload a PDF,
  place fields, send, sign, seal with a certificate and a tamper-evident audit trail). Infrastructure
  identifiers still say `digitalsign`; that is deliberate, do not rename them.
- **Monorepo** (pnpm workspaces): `apps/api` (NestJS API **and** the BullMQ worker, `src/main.ts` and
  `src/worker.ts`), `apps/web` (React + Vite), `packages/shared` (`@envelope/shared`: zod schemas,
  types, error catalog, limits — shared by API and web).
- **Data:** Postgres via Prisma (`apps/api/prisma/schema.prisma`, client generated into
  `apps/api/src/generated`), Redis for BullMQ and rate limits, S3/MinIO for files.
- **Local services:** `docker compose up -d` — Postgres :5545, Redis :6391, MinIO :9102.
- **Docs are the source of truth.** `docs/00`–`11` are the specification; `docs/12`+ are phase plans
  (what was actually built, and how); `docs/adr/` records decisions. `docs/README.md` is the index.
- **Where we are:** check `CHANGELOG.md` (the `[Unreleased]` section and the latest version),
  `git tag -l`, and the highest-numbered phase plan in `docs/`. Never assume from memory.

## 2. Session Start Checklist

1. `git status` and `git log --oneline -15` — know what is committed and what is in progress.
   Uncommitted changes you did not make are the user's work: never discard or overwrite them.
2. Read `docs/README.md`, the latest phase plan, and `CHANGELOG.md`'s `[Unreleased]` section.
3. For the area you will touch, read the relevant spec docs and ADRs (see §3) and the existing code.
4. Only then plan or code.

## 3. The Phase Process (Mandatory)

Every piece of product work belongs to a phase, and every phase goes through the same five stages.
Do not skip or reorder them.

```
  1. PLAN ──► 2. APPROVE ──► 3. BUILD (all steps) ──► 4. VERIFY ONCE ──► 5. COMMIT PER STEP ──► 6. RELEASE
     docs/NN     the user      code + tests,           lint, typecheck,     one commit per       version bump,
     plan + ADRs  says go       snapshot per step       unit, API e2e,       plan step, fixes     changelog, tag
                                                        browser e2e          folded in
```

**1. Plan (before any code).** Follow `.claude/skills/phase-plan/SKILL.md`.
- Read what the docs already say: `01-product-requirements`, `03-architecture`, `05-data-model`,
  `08-api-specification`, `10-security-and-threat-model`, `11-implementation-roadmap`, relevant ADRs,
  and the previous phase plan's "Deliberate Simplifications" (often this phase's inputs).
- Ask the user about genuine ambiguities (scope, shape, first customer). Do not invent requirements
  the docs already define; do not silently fill gaps the docs leave open.
- Write `docs/NN-phase-<n>-<slug>-plan.md` (next number after the highest existing one) in the
  standard structure: header table, **Part 1: In Plain Terms** (what, finish line checklist, what we
  need from the user), **Part 2: Technical Detail** (decisions table, ADRs, steps table, one section
  per step, deliberate simplifications, verification).
- Write an ADR for every decision that is expensive to reverse, trades one property for another,
  or would surprise a reader (`docs/adr/README.md` has the rules; take the next free number, never
  a reserved one). Add it to the ADR index.
- Add the plan to `docs/README.md`'s contents table.
- **Stop and get the user's approval of the plan.** Then commit it on its own:
  `docs: Phase N <name> plan, ADR NNNN`.

**2–5. Build, verify, commit.** Follow `.claude/skills/phase-build/SKILL.md`. In short:
- Implement the steps **in plan order**, code **and tests** for each. Do not run the full suite
  between steps — a fast `typecheck` while coding is fine.
- At the end of each step, snapshot the whole tree without committing:
  `git add -A && git write-tree` then `git reset -q`; record the tree hash.
  Snapshot **before** starting the next step, or later edits leak into the earlier snapshot.
- When every step is written, run **everything once** (§5). Fix what fails, and fold each fix into
  the snapshot of the step it belongs to (temporary `GIT_INDEX_FILE`, `git apply --cached`).
- Verify each rebuilt snapshot on its own (typecheck, lint, unit tests) — every commit must build.
- Commit the snapshots in order (`git read-tree <tree> && git commit`), one commit per plan step.
- Mark each step ✅ in the plan's steps table and add the phase to `CHANGELOG.md` `[Unreleased]`.

**6. Release.** Follow `.claude/skills/release/SKILL.md`: a `test(...)` finish-line commit if the
plan lists one, then `docs: release vX.Y.0` (changelog section, version in all four `package.json`
files, plan status → Complete) and an annotated tag `vX.Y.0` titled `Phase N: <Name>`.
**Never push or tag without the user saying so.**

Stop and ask the user instead of pressing on when: the docs conflict with the code; a step needs a
schema or public-API change the plan did not describe; a fix would touch a module outside the
phase; or a test can only pass by weakening it.

## 4. Commands

`pnpm` and `node` come from nvm and are **not** on PATH in non-interactive shells. Prefix every
command with:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.local/share/pnpm:$PATH"
```

| Task | Command |
|---|---|
| Lint + format check / fix | `pnpm lint` / `pnpm lint:fix` (Biome only — no ESLint, no Prettier) |
| Typecheck everything | `pnpm typecheck` |
| Unit tests | `pnpm test` (`apps/api`: `src/**/*.test.ts`; no DB, Redis or network) |
| API e2e | `pnpm --filter @envelope/api test:e2e` — **use Node 22.19.0** (`$HOME/.nvm/versions/node/v22.19.0/bin` on PATH); other versions fail in `global-setup` or segfault |
| Browser e2e | `pnpm --filter @envelope/web test:e2e --project=desktop-chrome` (CI also runs `mobile-iphone14` for signing) |
| Screenshot every screen | `pnpm --filter @envelope/web ui:gallery` |
| New migration | edit `schema.prisma`, then in `apps/api`: `npx prisma migrate dev --name <name> --create-only`, review the SQL, then `npx prisma migrate dev` and `npx prisma generate` |
| Drift check (CI) | `pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (needs `SHADOW_DATABASE_URL`, value in `.env.example`) |

Never run `prisma migrate reset` or anything that wipes a database without the user's explicit
consent — not even the test database.

## 5. Verification Before Any Commit

All of these, green, on the final tree:

1. `pnpm lint`
2. `pnpm typecheck` (known pre-existing failure: `packages/shared/src/jurisdiction.test.ts` strict
   `undefined` checks — not yours unless you are asked to fix it; typecheck the other packages
   individually and report it)
3. `pnpm test`
4. API e2e (Node 22.19.0)
5. Browser e2e, desktop-chrome at least — required whenever `apps/web` **or** anything the browser
   stack boots (API env vars, `apps/web/e2e/stack/stack.mjs`) changed

If a test flakes, rerun it in isolation and **find the cause** before calling it a flake; record a
genuine flake in the commit or release notes (the v0.6.0 release notes are the model).

## 6. Testing Rules

- **Fully isolated. Always.** Tests never send real email, never touch the dev database
  (`digitalsign`), never use the dev server on :4000/:5173 or dev Redis. API e2e uses
  `digitalsign_test`, Redis db 1, `MAIL_TRANSPORT=memory`; browser e2e uses its own stack
  (`apps/web/e2e/stack`: ports 4100/5174, `digitalsign_browser_test`, Redis db 2, file email).
  Tests never read `.env`.
- E2E tests use the **real** app, database, queues and storage — do not mock them. Mock only what
  cannot exist locally; for outbound HTTP, start a real local `http.createServer` receiver (see
  `apps/api/test/webhook-delivery.e2e.test.ts`). Tests have no internet: never depend on DNS for a
  real hostname — use IP literals.
- Test env vars live in `apps/api/test/test-env.ts` (API e2e) and `apps/web/e2e/stack/stack.mjs`
  (browser). Anything slow in production (retry delays, schedules) must be overridable there.
- **Wait for the worker before acting again on the same envelope.** Sending returns before the mail
  worker records `EMAIL_SENT`; a second audit-writing action on that envelope racing it can deadlock
  in Postgres. Wait with `linkFor(worker.mailbox, email)` first (docs/18, "A Pre-Existing Race").
- `truncateAll()` clears Postgres but **not Redis**: a test file that leaves retrying BullMQ jobs
  behind can feed them to the next file's worker. Clear queues your file uses in `beforeAll`.
- UI copy is load-bearing: browser tests select by accessible name, so renaming a label silently
  breaks them. Search `apps/web/e2e` before changing any visible text.
- Never delete or weaken an existing test to make a change pass.

## 7. Code Conventions

Follow the existing pattern in the neighbouring module before inventing one.

- **Tenancy:** tenant-owned reads/writes go through `TenantPrismaService`; tenant-level tables
  (User, ApiKey, ...) filter by `tenantId` explicitly. Never return another tenant's row.
- **Errors:** throw `AppException(code)`; add new codes to `packages/shared/src/errors.ts`
  (the web app switches on `code`). Responses are RFC 7807.
- **Validation:** zod schemas in `packages/shared`, applied with `ZodValidationPipe`.
- **Auth:** global `JwtAuthGuard` + `RolesGuard`; `@Public()`, `@Roles('ADMIN')`,
  `@ApiKeyAllowed({ write })` (API keys are closed by default). `@RateLimit(LIMITS.x)` on writes.
- **Audit:** every envelope state change calls `audit.record(tx, ...)` inside the same transaction.
  Tenant-admin actions with no envelope are structured logs, not audit rows.
- **Queues:** enqueue jobs (mail, seal, webhooks) **after** the transaction commits, never inside
  it; jobs carry ids only, never secrets or payloads that belong in Postgres.
- **Logging is required**, structured (`@InjectPinoLogger`), on every state transition — and
  redacted: never log passwords, tokens, raw keys, secrets, hashes or signing links
  (`apps/api/src/logging/redact.ts`; mask emails with `maskEmail`).
- **New env var:** add it to `env.schema.ts` (with a production guard if it is unsafe there),
  `.env.example`, `apps/api/test/test-env.ts` and `apps/web/e2e/stack/stack.mjs`. Secrets must
  differ from each other (see the `superRefine` checks).
- **Comments:** only for a non-obvious *why*; cite the doc or ADR that explains it (`docs/18`,
  `ADR 0015`). No comments that restate the code.
- No new dependencies, schema changes or public API changes that the plan does not describe.

## 8. Documentation Conventions

- Every doc opens with the header table (Status, Version, Last updated, Audience, What this doc
  answers), then **In Plain Terms** readable by a non-developer, then **Technical Detail**.
- Diagrams are ASCII in fenced code blocks (no Mermaid). Requirements use MUST/SHOULD/MAY.
- When the build deviates from a spec doc (00–11), do not rewrite the spec: add an
  `> **As built (Phase N, docs/NN).**` note beside the affected section.
- ADRs are immutable once accepted; supersede instead of editing.
- `CHANGELOG.md` follows Keep a Changelog; unreleased work goes under `[Unreleased]`.

## 9. Git Rules

- Conventional commits, scoped: `feat(api): ...`, `feat(api,web): ...`, `fix(web): ...`,
  `test(api): ...`, `docs: ...`, `perf(db): ...`. The subject says what the user gets; the body says
  why, referencing the plan (`docs/NN step K`).
- One commit per plan step, never a catch-all "fix tests" commit — fold fixes into their step.
- Never commit `.env` or any secret; never `--no-verify`; never amend or force-push; never push,
  tag or open a PR unless the user asks.
- Clean up anything you created (scratch worktrees, temp files); never delete what you did not
  create without asking.

## 10. Security Non-Negotiables

- Follow `docs/10-security-and-threat-model.md` and the ADRs. Signing tokens, invite tokens,
  refresh tokens and API keys are stored only as HMACs; webhook secrets only encrypted (ADR 0009,
  ADR 0015).
- The audit trail is append-only and hash-chained; nothing may update or delete it (ADR 0004).
- Any user-supplied URL the server fetches must pass `webhook-url-guard.ts` (https, public address,
  re-checked at fetch time, no redirects).
- Tests prove security properties (cross-tenant isolation, token leakage, role floors) — extend
  them when you add a route.

## 11. Reporting Back

At the end of a task, tell the user: what changed (commits, files), what was verified and how,
anything that failed or flaked and why, pre-existing problems you found but did not fix, and what
is next. Be exact; never claim a check passed that you did not run.
