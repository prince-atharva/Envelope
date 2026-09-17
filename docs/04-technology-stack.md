# Technology Stack

| | |
|---|---|
| **Status** | **Decided** — this document justifies the choice, it does not re-open it |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering (Part 2) |
| **What this doc answers** | What are we building it with, why those choices, and what are their limits? |

---

# PART 1 — In Plain Terms

## The Decision

**The entire platform is built in JavaScript.** One language, from the screen the user sees all the way down to the engine that assembles the signed document.

This is settled. This document explains the reasoning; it is not a menu of options.

## Why One Language

Most web projects use one language for what the user sees and a different one for the server behind it. That is normal, and it works, but it has real costs: two sets of skills, two sets of tools, and a constant translation tax at the boundary between them.

Here, one language covers everything. That matters for three concrete reasons.

**It matches the team.** The developer building this is a JavaScript specialist. Choosing anything else would mean either learning a new language during a ten-week build, or hiring someone. Both add risk and cost for no benefit the client would ever see.

**The critical calculation exists once.** The mathematics that positions a signature correctly has to run in two places — in the browser when someone drags a box onto the page, and on the server when the signature is put into the document. In one language, that is a single piece of shared code used by both. In two languages, it is written twice, in two dialects, and must be kept perfectly in step forever. Two copies of the same calculation drifting apart is exactly how signatures start landing in the wrong place six months after launch. This alone justifies the decision.

**It deploys anywhere.** The tool we use to build the finished PDF is written in pure JavaScript with no hidden machinery underneath. Some alternatives depend on components that must be compiled for each specific type of server, which restricts where you can host and complicates every deployment. Ours simply runs.

## What We Are Using

| What it does | The tool | Why this one |
|---|---|---|
| The website and screens | **React** (with Vite) | The standard choice for screens. The server behind them is a separate service, built with **NestJS**, so other systems can use it too |
| Displaying PDFs on screen | **PDF.js** | Made by Mozilla. It is what Firefox uses to show PDFs, so it is tested by hundreds of millions of people |
| Capturing a drawn signature | **signature_pad** | Produces smooth, natural-looking strokes rather than jagged lines |
| Building the finished document | **pdf-lib** | Free, no licence cost, pure JavaScript, and does exactly what we need |
| Tidying signature images | **sharp** | Very fast; trims the empty space around a signature |
| Storing information | **PostgreSQL** | The most reliable open-source database available; free |
| Storing documents | **Cloudflare R2** | Cheap, and does not charge every time a document is downloaded |
| Background work | **BullMQ and Redis** | Handles the slow jobs so the person using the site never waits |
| Sending email | **Postmark** | Specialists in getting email to actually arrive rather than land in spam |

**Every one of these is free and open source**, apart from the hosted services, whose costs are in [02-feasibility-and-build-vs-buy.md](02-feasibility-and-build-vs-buy.md). There are no software licence fees.

## One Limitation, Stated Honestly

There is a genuine trade-off in this decision, and it is better to hear it now than to discover it later.

The tool we use to build the finished PDF — pdf-lib — is excellent at what we need: putting the signature onto the page permanently, adding the certificate, producing a proper sealed document. For the product described in these documents, it is the right choice.

What it does **not** do well is the higher tier of signing, where each signer holds a government-issued digital identity. That tier is only required in a narrow set of cases: certain high-value transactions in Europe, and specific document types in India.

If the client ever needs that tier, the honest answer is that we would add a small separate component alongside the main system, in a different language better suited to that specific job. The system is deliberately designed with that boundary already in place, so it can be added without rebuilding anything. It is a bolt-on, not a rewrite.

We are flagging this in week one rather than month six.

## One Thing We Deliberately Avoided

There is a well-known alternative library for working with PDFs called **iText**. It is powerful, and many tutorials recommend it.

It carries a licence condition that would be seriously damaging here: using it in a commercial product requires either paying for a commercial licence, or publishing your entire application's source code publicly for anyone to take.

For a product intended to be owned and possibly sold, neither is acceptable. **pdf-lib carries no such condition** — free to use, commercially, forever, with no obligation.

This kind of licensing trap is easy to walk into and expensive to walk out of. We checked before choosing.

---
---

# PART 2 — Technical Detail

> Written for engineering. Non-technical readers can stop here.

## Full Stack

> **Superseded in part by [ADR 0012](adr/0012-nestjs-api-and-react-vite-web.md).** The build uses a
> **NestJS** API (`apps/api`, with a worker entry point) and a **React + Vite** web app
> (`apps/web`), not one Next.js app, and **Biome** instead of ESLint and Prettier. Everything else
> in this document stands, including the shared coordinate module, which lives in
> `packages/shared/src/coordinates.ts`.

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Framework | Next.js | 14+ (App Router) | Unified client/server, route handlers remove a separate API tier for v1, excellent DX — **see ADR 0012: replaced by NestJS + React/Vite** |
| Language | TypeScript | 5.x, `strict` | Type safety across the shared coordinate module is the point of the whole stack decision |
| Styling | Tailwind CSS | 3.x | Fast iteration; small production bundle matters for the signer portal |
| PDF rendering | `pdfjs-dist` | 4.x | Mozilla's renderer; exposes `getViewport()` for accurate rendered dimensions |
| Signature capture | `signature_pad` | 5.x | Variable-width Bézier smoothing; battle-tested touch handling |
| PDF mutation | `pdf-lib` | 1.17+ | **MIT licensed**, pure JS, no native deps, correct incremental-save semantics |
| Font embedding | `@pdf-lib/fontkit` | 1.x | Required for custom fonts on the certificate page |
| Image processing | `sharp` | 0.33+ | libvips-backed; `.trim()` plus metadata for aspect-ratio-correct fitting |
| Database | PostgreSQL | 15+ | ACID, `JSONB` for audit metadata, mature partitioning for the audit table |
| ORM | Prisma | 5.x | Type-safe client, migration tooling, generated types flow into application code |
| Queue | BullMQ + Redis | 5.x / 7.x | Reliable retry semantics, delayed jobs for reminders, good observability |
| Object storage | Cloudflare R2 (S3 API) | — | **Zero egress fees** — signed documents are downloaded repeatedly over their lifetime |
| Email | Postmark or AWS SES | — | Transactional deliverability plus delivery/bounce webhooks feeding the audit trail |
| Hashing | Node `crypto` (built-in) | — | SHA-256 and HMAC-SHA256; no dependency needed |
| Testing | Vitest + Playwright | — | Playwright drives real mobile browsers, which is essential for canvas capture |

## The Decisive Argument: One Shared Coordinate Module

The coordinate conversion in [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md) must execute in two environments — browser (pixels → ratios at placement) and server (ratios → PDF points at sealing).

With a single language, this is one module:

```
   packages/shared/src/coordinates.ts        ← the single source of truth
        │
        ├── imported by  apps/web/src/features/builder/   (browser)
        └── imported by  apps/api/src/                    (server, sealing)
```

*(Paths as built; see [ADR 0012](adr/0012-nestjs-api-and-react-vite-web.md). The design originally
wrote these as `src/lib/coordinates.ts`, `src/components/FieldPlacementLayer.tsx` and
`src/services/PdfSealingService.ts`.)*

In a polyglot stack it becomes two implementations in two languages, kept in sync by discipline alone. Every future change to the field model — rotation support, per-page scaling, nested containers — must be applied twice, correctly, forever.

Divergence between those two copies produces misplaced signatures: the highest-severity failure this product can have, and one that may not surface until a customer complains about a real contract. Eliminating the possibility structurally is worth more than any per-component optimisation an alternative stack could offer.

**One module, two consumers, one set of unit tests.** That is the argument.

## `pdf-lib` — Capability Assessment

**Strengths:**

- MIT licensed, no commercial restriction
- Pure JavaScript — deploys to serverless, containers, or anywhere Node runs, with no native compilation
- Correct `page.drawImage()` with explicit positioning
- Font embedding and subsetting via fontkit
- Page creation for the certificate
- Preserves existing document structure on load and save

**Limitations, stated plainly:**

| Limitation | Impact | Mitigation |
|---|---|---|
| No PAdES B-LTA support | Cannot produce qualified/long-term-validation signatures | Out of Tier 1 scope; escalation path below |
| Limited AcroForm handling | Complex interactive forms may not round-trip cleanly | We flatten forms before burning; document the constraint |
| No built-in rotation handling on `drawImage` | Pages with `/Rotate 90` need manual compensation | Handled explicitly in `PdfSealingService`; see doc 06 gotchas |
| Memory-resident document model | Very large PDFs consume proportional memory | 25 MB / 500 page cap; sealing runs on workers, not request threads |

## Tier 2 Escalation Path

If qualified (certificate-based) signatures become a requirement:

| Option | Approach | Trade-off |
|---|---|---|
| **A. `@signpdf` in Node** | Stay all-JavaScript | Supports PAdES B-B and B-T; **B-LTA support is weak**. Adequate only if long-term validation is not required. |
| **B. Python sidecar (`pyHanko`)** | Isolated signing microservice | Best-in-class PAdES B-LTA with the least code. Adds a second runtime to operate. **Recommended if Tier 2 is needed.** |
| **C. Java sidecar (EU DSS)** | Isolated signing microservice | The European Commission's reference eIDAS implementation. Heaviest, most authoritative. Choose for EU qualified signatures specifically. |
| **D. External signing API** | Delegate to a provider | Fastest to integrate, ongoing per-signature cost, external dependency. |

The architecture in [03-architecture.md](03-architecture.md) already isolates sealing behind a service boundary and runs it on workers, so options B and C slot in as a network call from `PdfSealingService` without touching the application layer, the data model, or the UI.

**Important:** the escalation cost is dominated by CA/QTSP procurement lead time (2–4 months), not by engineering. If Tier 2 is even plausible, start that conversation at kickoff.

## Licensing Audit

| Package | Licence | Commercial use | Notes |
|---|---|---|---|
| `pdf-lib` | MIT | Unrestricted | — |
| `pdfjs-dist` | Apache 2.0 | Unrestricted | — |
| `signature_pad` | MIT | Unrestricted | — |
| `sharp` | Apache 2.0 | Unrestricted | libvips is LGPL, dynamically linked — fine |
| Prisma | Apache 2.0 | Unrestricted | — |
| BullMQ | MIT | Unrestricted | — |
| React, Vite, NestJS | MIT | Unrestricted | Replaced Next.js (also MIT); see ADR 0012 |
| **`iText`** | **AGPL / commercial** | **REJECTED** | AGPL would require open-sourcing the entire application. Commercial licensing is priced per-deployment. |
| **`PDFtron` / `Apryse`** | Commercial | **REJECTED** | Capable, but licence cost is material and unnecessary for Tier 1. |

**Rule for the team:** any new PDF or cryptography dependency requires a licence check before it enters `package.json`. Copyleft licences in this layer are a commercial hazard, not a technicality.

## Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| Java + EU DSS + OpenPDF | Strongest PKI maturity, but unnecessary for Tier 1, and duplicates the coordinate module. Reconsider only for Tier 2 as a sidecar. |
| Python + FastAPI + pyHanko | Best PAdES support per line of code, same duplication problem. Reconsider only for Tier 2 as a sidecar. |
| Ghostscript / `qpdf` shell-out | Native binary dependency, harder deployment, weaker error handling, shell-injection surface. |
| Puppeteer / headless Chrome for PDF output | Rasterises rather than editing; destroys text layers and bloats file size. Wrong tool. |
| MongoDB instead of PostgreSQL | Audit integrity and referential guarantees are core requirements; relational constraints are an asset here, not overhead. |

## Development Tooling

| Concern | Choice |
|---|---|
| Package manager | `pnpm` — faster installs, strict dependency resolution |
| Linting | ~~ESLint + `@typescript-eslint`~~ → **Biome**, `strict` ([ADR 0012](adr/0012-nestjs-api-and-react-vite-web.md)) |
| Formatting | ~~Prettier~~ → **Biome**, enforced in CI ([ADR 0012](adr/0012-nestjs-api-and-react-vite-web.md)) |
| Unit tests | Vitest — fast, native TypeScript |
| E2E tests | Playwright — **real iOS Safari and Android Chrome required**, not just desktop emulation |
| Local environment | Docker Compose: Postgres, Redis, MinIO (S3-compatible) |
| CI | GitHub Actions: lint → typecheck → unit → E2E → migration check |
| Secrets | Environment variables locally; platform secret manager in production. **Never committed.** |

The Playwright requirement for real mobile browsers is not optional. Canvas-based signature capture on iOS Safari has documented touch-event and scaling quirks that desktop emulation does not reproduce. Discovering them in production means signatures that fail to capture on the single most common signing device.
