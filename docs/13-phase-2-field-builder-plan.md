# Phase 2: Field Builder Plan

| | |
|---|---|
| **Status** | Complete — released as `v0.2.0` |
| **Version** | 1.0.0 |
| **Last updated** | 18 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 2 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 2 Is

Phase 2 is the **field builder**: weeks 3–4 of the roadmap in
[11-implementation-roadmap.md](11-implementation-roadmap.md). Phase 1 could show a document on
screen. Phase 2 lets you say **who signs it and where**.

```
   PEOPLE ──────────► add the people who must sign, in an order if you want one
   BOXES ───────────► drag signature, initials, date, text and tick boxes onto pages
   COLOURS ─────────► each person has their own colour, with their name on every box
   SAVING ──────────► positions save by themselves and survive a reload
   REVIEW ──────────► one screen showing exactly what each person will receive
```

Nothing is sent yet. Sending, the email links and the signing screen are Phase 3.

## What You Can Do at the End of Phase 2

1. Open a document you uploaded and choose **Prepare for signing**.
2. Add people by name and email, choose whether each one signs, approves, only views or gets a copy,
   and set the order.
3. Drag boxes onto any page for any person. The boxes snap to a neat grid, line up with each other,
   and can be nudged with the arrow keys.
4. Close the browser, come back, and find every box exactly where you left it.
5. Zoom in and out. The boxes stay glued to the right spot on the page.
6. Open **Review** and see each person, their fields and anything still missing.

## Why the Positions Are the Risky Part

The roadmap calls this the highest-risk work in the project. A box is placed on a screen that could
be any size, and the signature is later stamped into the document by a server that never saw that
screen. Get the translation between the two wrong, and signatures land in the wrong place — on some
devices only, and possibly not until a real contract is signed.

So the maths that converts between them is written **first**, on its own, with its own tests, before
any of the visible work. It lives in one file that both the browser and the server use, and nothing
else in the codebase is allowed to do that arithmetic. [ADR 0002](adr/0002-store-field-coordinates-as-ratios.md)
records the decision and the reasoning.

## The Phase 2 Finish Line

From doc 11, Phase 2 is finished when:

- [x] fields can be placed for two people across several pages, and reloading shows them unmoved;
- [x] the stored positions are **identical whether you work at 100% or 200% zoom**;
- [x] the coordinate tests pass.

All three are checked by browser tests that run on desktop Chrome and at Pixel 7
and iPhone 14 sizes.

## Progress

| # | Step | Status |
|---|---|---|
| 0 | Close Phase 1: lockfile, ADR 0012, CI, `v0.1.0` | ✅ Done |
| 1 | This plan and ADR 0002 | ✅ Done |
| 2 | The coordinates module, with its tests | ✅ Done |
| 3 | Database: draft recipients and field ownership | ✅ Done |
| 4 | API: edit a draft (people, boxes, settings) | ✅ Done |
| 5 | Viewer: a layer for boxes on top of each page | ✅ Done |
| 6 | The builder and review screens | ✅ Done |
| 7 | Browser tests, including the zoom test | ✅ Done |
| 8 | Documentation and release `v0.2.0` | ✅ Done |

Steps 3 and 4 became one commit: the migration and the API that uses it do not
compile apart.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| The Gmail App Password check from Phase 1 | Confirm a real welcome email arrives | Now |
| HealthProHub logo and brand colours | The app still uses placeholders, including the per-person colours | During Phase 2 |
| Lawyer-approved consent wording | Needed before signing | Before Phase 3 |
| Which countries your customers are in, and where documents must be stored | Legal settings and storage location | Before Phase 3 |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Step 1: Plan and ADR 0002

This document, plus [ADR 0002](adr/0002-store-field-coordinates-as-ratios.md), which fixes the
coordinate rules: ratios only, top-left origin, measured against the pdf.js viewport at scale 1
(rotation and CropBox already applied), rounded to 6 decimals, with all interaction geometry done in
PDF points so that zoom cannot affect a stored value.

## Step 2: `packages/shared/src/coordinates.ts`

Written and tested **before** any consumer, per doc 11. It is the only place these formulas exist.

| Group | Functions |
|---|---|
| Conversion | `pixelsToRatios`, `ratiosToPixels`, `pointsToRatios`, `ratiosToPoints`, `ratiosToPdfRect` (inverts Y for Phase 4), `fitPreservingAspect` |
| Geometry | `roundRatio`, `snapToGrid`, `clampRectToPage`, `enforceMinSize`, `findAlignmentGuides` |
| Validation | `validateRatios` → `null`, `RATIO_OUT_OF_RANGE` or `FIELD_EXCEEDS_PAGE` |
| Constants | `SNAP_GRID_PT` 4, `GUIDE_TOLERANCE_PT` 3, `NUDGE_PT` 1, `NUDGE_LARGE_PT` 10, `DEFAULT_FIELD_SIZE_PT` and `MIN_FIELD_SIZE_PT` per field type |

Tests cover the round trip against hand-computed values, Y inversion at the top, middle and bottom
of a page, A4 and US Letter, a rotated (landscape) page, aspect-preserving fit, the 0 and 1
boundaries, rejection outside `[0, 1]`, snapping, clamping, and **zoom independence**: the same
rectangle in points produces identical ratios at scale 1 and scale 2.

`packages/shared/src/draft.ts` adds the zod schemas and types for recipients, fields and draft
settings, plus `checkReadyToSend`, which the review screen uses now and the Phase 3 send endpoint
will reuse.

## Step 3: Database

| Change | Reason |
|---|---|
| `Recipient.tokenHash` and `tokenExpiresAt` become nullable | Tokens are minted at send time (Phase 3). A draft recipient has none. |
| `Recipient.colorIndex` | The colour is assigned when the person is added and never changes, even after others are removed. |
| `Recipient.createdAt` | A stable order for the list. |
| Unique `(envelopeId, email)` | One entry per person per document. |
| `Envelope.message` | The optional note that goes out with the invitation. |
| `Envelope.draftRevision` | Detects two tabs editing the same draft. |
| Unique `Recipient(id, envelopeId)` plus a composite foreign key from `DocumentField(recipientId, envelopeId)` | Invariant 4 of doc 05, enforced by the database rather than by hope: a field's recipient must belong to the same envelope. |

**Audit rule:** draft events never write `AuditTrail.recipientId`. That foreign key is `RESTRICT`, so
filling it would make the recipient undeletable. The id goes in `metadata` instead.

## Step 4: API

New module `apps/api/src/drafts/`. Every endpoint requires the envelope to be a draft, and returns
the new `draftRevision`.

| Method | Route |
|---|---|
| PATCH | `/envelopes/:id` (title, message, signing order) |
| POST | `/envelopes/:id/recipients` |
| PATCH | `/envelopes/:id/recipients/:rid` |
| DELETE | `/envelopes/:id/recipients/:rid` |
| PUT | `/envelopes/:id/fields` (replaces the whole layout in one transaction) |

- **Concurrency:** one scoped `updateMany` locks the envelope row, checks the tenant, checks that it
  is a draft, checks `If-Match` against `draftRevision`, and bumps it. A stale revision returns 412.
- **Validation order:** pixel keys → `INVALID_COORDINATE_SPACE`; zod; then the shared
  `validateRatios` → `RATIO_OUT_OF_RANGE` or `FIELD_EXCEEDS_PAGE`; page count →
  `PAGE_OUT_OF_RANGE`; recipient ownership and role. One bad field rejects the whole request.
- **Audit:** `ENVELOPE_UPDATED`, `RECIPIENT_ADDED`, `RECIPIENT_UPDATED`, `RECIPIENT_REMOVED` and
  `FIELDS_SAVED`. Metadata holds ids and counts, never names or emails. `FIELDS_SAVED` stores a
  layout hash, and an unchanged layout writes nothing at all, so autosave cannot flood the chain.
- **Tenant scoping** is extended to cover `Recipient` and `DocumentField`.

## Step 5: Viewer

`PdfViewer` gains a `renderPageOverlay` prop, rendered inside each page wrapper, along with page
change notifications and an imperative `jumpToPage`. The 1px border becomes a ring so the overlay
matches the canvas exactly, the two copies of the size calculation are merged into one, and the
window arrow-key handler steps aside when the overlay has handled the key.

## Step 6: Builder

`apps/web/src/features/builder/`, using Pointer Events directly rather than a drag-and-drop library,
so every conversion goes through the coordinates module.

Interaction: ratios → points → move by `Δpx / pxPerPt` → snap (Alt bypasses) → clamp → minimum size
→ ratios. Autosave runs a second after the last change, one request at a time, and shows its state.
Keyboard: arrows nudge 1pt, Shift+arrows 10pt, Delete removes, Escape deselects, Tab moves between
boxes. Every box carries its recipient's name, so colour is never the only cue.

The review screen lists each recipient with their fields and shows what is still missing. Its Send
button stays disabled until Phase 3.

## Step 7: Tests

Playwright: place fields for two people across pages, reload, check they have not moved; check that
ratios captured at 100% and at 200% are identical; check rotated and mixed-size pages; check that
arrow keys nudge a field without turning the page.

## Step 8: Documentation and release

Docs 03, 05 and 08 updated to match what was built, this document marked complete, `CHANGELOG`
`0.2.0`, tag `v0.2.0`.

## Deliberate Simplifications

| Simplification | Planned fix |
|---|---|
| No undo or redo in the builder | After the phases that are on the critical path |
| The builder is desktop-first; phones get a basic version | The sender studio has no mobile requirement in doc 09 |
| Fields cannot be rotated | Not in the field model; would need a new column |
| No templates or saved layouts | Post-launch backlog, doc 11 |
