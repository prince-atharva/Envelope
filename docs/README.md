# Digital Signature Platform — Documentation

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone — start with the reading path that matches you |
| **What this doc answers** | What is in this folder, and which parts should I read? |

---

## 🏥 HealthProHub Integration & Dual-Mode SaaS Guide

> [!IMPORTANT]
> **New Documentation Available:** A complete, dedicated architectural and integration guide has been created in [`docs/healthprohub-integration-and-dual-mode/`](./healthprohub-integration-and-dual-mode/README.md):
> - **[01-overview-and-concepts.md](./healthprohub-integration-and-dual-mode/01-overview-and-concepts.md)**: Core concepts and the two parallel operational modes.
> - **[02-healthprohub-integration-flow.md](./healthprohub-integration-and-dual-mode/02-healthprohub-integration-flow.md)**: Visual sequence diagrams & step-by-step doctor onboarding contract flow.
> - **[03-standalone-saas-flow.md](./healthprohub-integration-and-dual-mode/03-standalone-saas-flow.md)**: How third-party organizations use this platform as an independent digital signature SaaS.
> - **[04-technical-architecture-and-apis.md](./healthprohub-integration-and-dual-mode/04-technical-architecture-and-apis.md)**: Database schema extensions, embedded APIs, and postMessage protocols.
> - **[05-zero-lag-reliability-and-first-steps.md](./healthprohub-integration-and-dual-mode/05-zero-lag-reliability-and-first-steps.md)**: Initial setup order (Day 1), Sub-100ms Zero-Lag speed strategy, and Webhook fail-safe design.
> - **[06-frontend-embed-sdk-guide.md](./healthprohub-integration-and-dual-mode/06-frontend-embed-sdk-guide.md)**: 5-line Embed SDK (`@signflow/embed`) with modal & inline code for HealthProHub.

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
| — | [adr/](adr/) | Records of significant decisions and why they were made |

There is also **[DIGITAL_SIGNATURE_PLATFORM_SPEC.md](../DIGITAL_SIGNATURE_PLATFORM_SPEC.md)** in the folder above this one. That is a single self-contained file combining everything here — the one to hand to a client or attach to an email.

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
