# Envelope powered by HealthProHub — Documentation

| | |
|---|---|
| **Status** | Draft for client review; Phase 1 built |
| **Version** | 1.1.0 |
| **Last updated** | 17 September 2026 |
| **Audience** | Everyone — start with the reading path that matches you |
| **What this doc answers** | What is in this folder, and which parts should I read? |

> **Name:** the product is **Envelope powered by HealthProHub**. Documents 00 to 11 were written before it
> was named and call it "the platform". They still describe the product accurately.
>
> **HealthProHub integration** (embed SDK, API keys, dual-mode SaaS) is Phase 6. It has no
> documents in this folder yet. An earlier index linked to a
> `healthprohub-integration-and-dual-mode/` folder that was never written; those links are removed.

---

## What Is This Project?

We are building a platform that gets documents signed electronically. You upload a PDF, mark where people need to sign, and send it as a link. They open it in their browser — on any device, without creating an account — sign with a finger or a mouse, and everyone instantly receives the finished document back.

The signature is permanently baked into the page, a full record of who did what and when is stapled to the back, and the file is locked so that any later tampering is detectable. It is the same job DocuSign does, except you own it, your documents stay on your own infrastructure, and you are not charged a fee every time you send something.

---

## Which Documents Should I Read?

Pick the path that matches you. **You do not need to read all of these.**

### Path 1 — Business, Client, or Non-Technical

> **[00-how-it-works.md](00-how-it-works.md) is all you need.** It contains no code and no technical language, takes about ten minutes, and covers the whole product end to end — how it works, why it can be trusted, whether it is legally valid, what it costs, and how long it takes.

If you want more after that, these three are also written to be readable without a technical background:

| Then read | For |
|---|---|
| [01-product-requirements.md](01-product-requirements.md) | The complete feature list and who each part serves |
| [02-feasibility-and-build-vs-buy.md](02-feasibility-and-build-vs-buy.md) | The commercial case, with cost comparisons |
| [11-implementation-roadmap.md](11-implementation-roadmap.md) | Week-by-week delivery plan |

### Path 2 — Architect or Technical Lead

Read `00` for shared vocabulary, then:

| Document | For |
|---|---|
| [03-architecture.md](03-architecture.md) | System structure, components, envelope lifecycle |
| [04-technology-stack.md](04-technology-stack.md) | The chosen stack and the reasoning behind it |
| [05-data-model.md](05-data-model.md) | Entities, relationships, full database schema |
| [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md) | **The most important technical document in this folder** |
| [10-security-and-threat-model.md](10-security-and-threat-model.md) | Threats and defences |

### Path 3 — Developer Implementing This

Everything, in numbered order. Do not skip `06` — it contains the coordinate mathematics that the entire product depends on, plus documented fixes for two bugs that are easy to introduce.

---

## Full Contents

| # | Document | What it answers |
|---|---|---|
| 00 | [how-it-works](00-how-it-works.md) | What is this and how does it work? *(no jargon, start here)* |
| 01 | [product-requirements](01-product-requirements.md) | What exactly are we building, and what are we deliberately not building? |
| 02 | [feasibility-and-build-vs-buy](02-feasibility-and-build-vs-buy.md) | Can we build this, what must we buy, and is it cheaper than DocuSign? |
| 03 | [architecture](03-architecture.md) | How do the pieces fit together? |
| 04 | [technology-stack](04-technology-stack.md) | What are we building it with, and why those choices? |
| 05 | [data-model](05-data-model.md) | What do we store, and how is it organised? |
| 06 | [signing-and-document-sealing](06-signing-and-document-sealing.md) | How does a signature get onto the page in exactly the right spot? |
| 07 | [compliance-layer](07-compliance-layer.md) | What does the law require, and how do we satisfy it? |
| 08 | [api-specification](08-api-specification.md) | What can other software do with this system? |
| 09 | [ux-flows](09-ux-flows.md) | What does the user actually see and do? |
| 10 | [security-and-threat-model](10-security-and-threat-model.md) | What could go wrong, and how do we stop it? |
| 11 | [implementation-roadmap](11-implementation-roadmap.md) | What gets built when, and what does it cost to run? |
| 12 | [phase-1-foundation-plan](12-phase-1-foundation-plan.md) | What does Phase 1 deliver, how is it built and run, and what is left? |
| 13 | [phase-2-field-builder-plan](13-phase-2-field-builder-plan.md) | What does Phase 2 deliver, and how are fields placed and saved? |
| 14 | [phase-3-signer-portal-plan](14-phase-3-signer-portal-plan.md) | What does Phase 3 deliver, and how does a signer open, sign and finish? |
| 15 | [phase-4-sealing-engine-plan](15-phase-4-sealing-engine-plan.md) | What does Phase 4 deliver, and how is a signed document stamped, sealed and verified? |
| 16 | [phase-5-envelope-lifecycle-plan](16-phase-5-envelope-lifecycle-plan.md) | What does Phase 5 deliver: cancelling, deadlines, automatic reminders, the dashboard, and the checks that keep it safe? |
| — | [adr/](adr/) | Records of significant decisions and why they were made |

Documents 00 to 11 are the specification and describe the product as designed. Documents numbered 12
and upwards are **phase plans**: what was actually built, in which commit, and how to run it. Where
the two disagree, an ADR records why. The most important one so far is
**[ADR 0012](adr/0012-nestjs-api-and-react-vite-web.md)**: the build uses a NestJS API plus a React
and Vite web app, not the single Next.js app described in doc 04.

The repository's own [README](../README.md) covers setup, the commands and the service URLs.

---

## Glossary

Terms used throughout the documentation. Every definition below is written so that you do not need to look up anything else to understand it.

| Term | What it means |
|---|---|
| **Envelope** | One signing job. Like a real envelope: it holds the documents, the list of people who must sign, and sticky notes marking where each person signs. Everything in the system revolves around this. |
| **Sender** | The person who uploads a document and sends it out to be signed. |
| **Recipient** | Anyone the envelope is sent to. Usually someone who must sign, but can also be someone who only needs to view or approve it. |
| **Signer** | A recipient whose job is to sign. They do not need an account — they arrive by email link. |
| **Field** | A box placed on the document marking where something goes: a signature, initials, a date, or typed text. Each field belongs to one specific recipient. |
| **Routing order** | The sequence in which people are asked to sign. Set it, and each person is only emailed once the person before them has finished. Leave it off, and everyone is asked at once. |
| **Signing token** | The one-time key inside the email link. It opens one document, for one person, once — then stops working. It also expires on its own after a set period. |
| **Burning** | Permanently embedding the signature into the page itself, the way ink soaks into paper. The opposite would be a sticker sitting on top that could be peeled off. |
| **Fingerprint** *(technically: a SHA-256 hash)* | A short code calculated from a file. Change anything at all in the file — even one comma — and the code becomes completely different. This is how we prove a document has not been altered. |
| **Sealing** | The final step: burning in all signatures, adding the certificate page, taking the fingerprint, and locking the file away. |
| **Certificate of Completion** | An extra page added to the back of the finished document listing who signed, when, from where, and the fingerprints. It travels with the file forever, so anyone opening the PDF can see the full history without access to our system. |
| **Audit trail** | The permanent log of everything that happened to an envelope. Entries can only be added, never edited or deleted. Like a security camera recording. |
| **Write-once storage** | Storage that only opens one way. Once the finished document goes in, nobody can change or delete it — including us. |
| **Version** | A snapshot of the document after each round of signing. If three people sign, there are three versions plus the original, each with its own fingerprint, so the full chain of custody is provable. |
| **Consent to sign electronically** | A notice the signer must actively agree to before signing, confirming they are happy to do this on screen rather than on paper. A legal requirement in the United States, and good practice everywhere. |
| **Electronic signature** | A signature made on screen — drawn, typed, or clicked. Legally binding for the great majority of business contracts. This is what we are building. |
| **Digital signature** *(the stricter kind)* | A signature backed by a government-recognised digital identity issued to the signer. Required only for a narrow set of high-value cases in some countries. Designed for, but not part of the first version. |
| **Coordinate normalisation** | Recording a field's position as a percentage of the page ("62% across, 74% down") instead of in screen pixels. This is what makes a signature land in the same physical spot on a phone, a laptop, and a printout. |
| **Worker queue** | A back-office desk for slow jobs. Work that takes a few seconds — building the final PDF, sending emails — goes into a tray and is processed in order, so the person using the site never waits. |

---

## Documentation Conventions

For anyone adding to or editing these documents:

- **Every document has two parts.** *In Plain Terms* comes first and must be readable by someone who has never written code — no jargon, no code, no schema. Then a divider, then *Technical Detail*. A non-technical reader must be able to stop at the divider and still understand the product.
- **Define every technical term the first time it appears**, inline and in plain words. The glossary is a backup, not a substitute.
- **Diagrams are ASCII art inside fenced code blocks.** They render correctly in VS Code preview, GitHub, Obsidian, and plain text with no extensions installed. Do not use Mermaid, and do not use `$$` mathematical notation — both display as raw symbols in the default VS Code preview.
- **Requirements use MUST / SHOULD / MAY** so they can be tested against.
- **Compliance content carries a "not legal advice" note.**
- Every document opens with the standard header block: Status, Version, Last updated, Audience, What this doc answers.
