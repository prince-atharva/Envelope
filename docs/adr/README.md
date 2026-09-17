# Architecture Decision Records

| | |
|---|---|
| **Status** | Active |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Engineering |
| **What this doc answers** | How do we record significant decisions, and what has been decided? |

---

## In Plain Terms

Every project accumulates decisions that seemed obvious at the time and baffling a year later. *Why is it built this way? Was that considered and rejected, or never considered at all?*

Without a record, teams re-litigate settled questions, or worse, quietly reverse a decision without knowing what it was protecting against.

An **Architecture Decision Record** is a short note capturing one decision: what we chose, what problem it solved, and what we gave up. One decision per file, numbered, written when the decision is made.

The rule that makes them useful: **once accepted, an ADR is never edited.** If a decision changes, write a new ADR that supersedes the old one. The old one stays, marked superseded. The history of what you believed and when is often more valuable than the current state — it is what lets you tell "we considered that and rejected it" from "we never thought about it."

---

## Format

We use the Nygard format. Short is the point — an ADR nobody reads is worthless.

```markdown
# NNNN. Short Title in the Imperative

**Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** names

## Context
The forces at play. What makes this a decision rather than an obvious choice?

## Decision
What we are doing, stated in the active voice: "We will..."

## Consequences
What becomes easier. What becomes harder. What we are accepting.
Include the negatives — an ADR with only benefits is marketing, not a record.
```

## Rules

| Rule | Reason |
|---|---|
| One decision per record | Bundled decisions cannot be superseded independently |
| Number sequentially, never reuse | Numbers are permanent references |
| Immutable once accepted | The historical record is the value |
| Supersede, never edit | Update the old record's status to point at the new one |
| Write at decision time | Written months later, they are reconstructions, not records |
| Record the rejected options | "We considered X" is often the most useful sentence in the file |
| Keep it under a page | Length is the enemy of being read |

## When to Write One

Write an ADR when a decision:

- Is expensive to reverse (data model, coordinate space, storage layout)
- Affects multiple components or teams
- Rejects a reasonable alternative someone will later propose
- Trades one desirable property for another
- Would surprise a competent developer reading the code cold

Do **not** write one for routine choices with an obvious default, naming conventions, or anything already documented elsewhere.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |

### Planned

Decisions already made in the design documents that should be captured as ADRs during Sprint 1:

| ADR | Title | Source |
|---|---|---|
| 0002 | Store field coordinates as normalised ratios | [06](../06-signing-and-document-sealing.md) |
| 0003 | Create a DocumentVersion per signing round | [05](../05-data-model.md), [06](../06-signing-and-document-sealing.md) |
| 0004 | Hash-chain the audit trail | [05](../05-data-model.md), [10](../10-security-and-threat-model.md) |
| 0005 | Burn signatures into page content, not annotations | [06](../06-signing-and-document-sealing.md) |
| 0006 | Run sealing asynchronously on workers | [03](../03-architecture.md) |
| 0007 | Apply Object Lock to the final version only | [10](../10-security-and-threat-model.md) |
| 0008 | Build the platform entirely in JavaScript | [04](../04-technology-stack.md) |
| 0009 | Store only the HMAC of signing tokens | [10](../10-security-and-threat-model.md) |
| 0010 | Defer Tier 2 qualified signatures | [02](../02-feasibility-and-build-vs-buy.md), [04](../04-technology-stack.md) |
| 0011 | Freeze jurisdiction policy at envelope creation | [07](../07-compliance-layer.md) |
