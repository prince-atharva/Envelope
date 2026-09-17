# 0001. Record Architecture Decisions

**Status:** Accepted
**Date:** 2026-09-10
**Deciders:** Engineering

## Context

This platform carries several decisions that are cheap to make now and expensive to reverse later. Field coordinates stored as ratios rather than pixels. A document version created per signing round. Signatures burned into page content rather than attached as annotations. Only the HMAC of a signing token persisted.

Each of these looks arbitrary from the code alone. Each was chosen over a reasonable alternative, for a reason that is not self-evident:

- Storing pixels is the obvious approach and is wrong for reasons that only appear on a second device.
- Storing a single original and final hash is the obvious approach and is wrong for reasons that only appear with a third signer.
- Attaching signatures as annotations is easier and is wrong for reasons that only appear in a dispute.

A developer joining in month six will find code that looks needlessly complicated, and will be tempted to simplify it. Without a record of what the complication is protecting against, that simplification will happen, and the resulting defect will be subtle, legally significant, and hard to trace back.

The compliance dimension raises the stakes. Some decisions here exist to satisfy specific legal requirements — storing consent text verbatim rather than by reference, freezing jurisdiction policy at envelope creation. Reversing one of those without understanding why it existed does not merely introduce a bug; it can invalidate the evidentiary basis of documents already signed.

Design documents describe the current state well. They do not capture *why* an alternative was rejected, or *when* the reasoning applied. Those are different questions, and they are the ones asked when someone proposes a change.

## Decision

We will record significant architectural decisions as Architecture Decision Records in `docs/adr/`, using the Nygard format.

- One decision per file, numbered sequentially and never reused.
- Written at the time the decision is made, not reconstructed afterwards.
- Immutable once accepted. A changed decision produces a new ADR that supersedes the old one; the old record remains with its status updated.
- Each record states what was rejected and what was traded away, not only what was chosen.
- Kept under a page.

Decisions already made across the design documents will be captured as ADRs 0002 through 0011 during Sprint 1, listed in [README.md](README.md).

An ADR is warranted when a decision is expensive to reverse, spans components, rejects a reasonable alternative, trades one desirable property for another, or would surprise a competent developer reading the code cold. Routine choices with an obvious default do not warrant one.

## Consequences

**Easier:**

- A future developer can distinguish "considered and rejected" from "never considered" — the distinction that determines whether a proposed change is an improvement or a regression.
- Onboarding shortens. The reasoning behind unusual code is one file away.
- Legal and security review can trace a control to the requirement that motivated it.
- Reversing a decision becomes deliberate: you must read what you are undoing.

**Harder:**

- Writing an ADR takes fifteen to thirty minutes, at the moment when the decision feels obvious and the documentation feels unnecessary. That is exactly when it is most valuable and least appealing.
- Judgement is required about what qualifies. Recording everything makes the set unreadable; recording nothing defeats the purpose.
- The index needs maintaining, or superseded records become misleading.

**Accepted:**

- Some ADRs will document decisions that turn out to be wrong. That is a feature. A record of a mistaken decision and its reasoning is more useful than silence, because it shows what information was available at the time.
- Immutability means the folder accumulates records that no longer describe the system. Status fields and supersession links carry the burden of keeping that navigable.
