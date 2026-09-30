# Concepts

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | What are the objects and states I will meet, and who does what? |

## In Plain Terms

A document sent for signature is called an **envelope**. It starts as a **draft** that you prepare:
you add the people who must act (**recipients**) and place boxes on the pages (**fields**) for them to
fill. When you **send** it, Envelope emails each person a personal link. They sign on Envelope's own
page. When everyone is done, Envelope seals the PDF and records a tamper-evident history.

## Technical Detail

### Envelope statuses

```
DRAFT ──send──► SENT ──► DELIVERED ──► PARTIALLY_SIGNED ──► COMPLETED
  │               │            │               │
  └─ cancel ──►   └────────────┴───────────────┴──► VOIDED   (cancelled by the sender)
                                                └──► DECLINED (a recipient declined)
              EXPIRED: the deadline passed; signing is paused. A signed-in person can extend it,
              which reopens it.
```

`COMPLETED`, `DECLINED` and `VOIDED` are final. `EXPIRED` is not: it can be extended in the web app
(an API key cannot extend a deadline).

### Recipients

| Role | Acts by |
|---|---|
| `SIGNER` | Signing the fields assigned to them. Needs at least one required field. |
| `APPROVER` | Approving, optionally with fields. |
| `VIEWER` | Receiving the finished document. Owns no fields. |
| `CC` | Receiving a copy of the finished document. Owns no fields. |

Each email address appears once per envelope. `routingOrder` groups people: with
`sequentialSigning: true`, lower groups go first and equal values sign together.

### Fields

A field has a `type` (`SIGNATURE`, `INITIALS`, `DATE_SIGNED`, `TEXT_INPUT`, `CHECKBOX`), a
`pageNumber` starting at 1, and a box given as **ratios of the page**: `ratioX`, `ratioY`,
`ratioWidth`, `ratioHeight`, each between 0 and 1, origin at the top left. Pixels and points are
rejected with `INVALID_COORDINATE_SPACE`. Saving fields replaces the whole layout.

### Draft revisions

Every change to a draft increments `draftRevision`. Send the latest value in `If-Match` (quoted) on
each edit; if someone else changed the draft first you get `412 DRAFT_REVISION_MISMATCH`. Read the
draft again and reconcile instead of overwriting.

### Whose envelope is it?

An API key acts for the workspace, not for a person. Envelopes it creates belong to the workspace as a
whole and show in the dashboard like any other. Keys are scoped to their workspace: a key never sees
another workspace's documents.

### Your own reference

Attach `externalId` (your record's id, up to 200 characters) and `metadata` (up to 10 short string
values) when you create an envelope. Both are echoed in every webhook and `externalId` filters the
list, so you can find your own record again without a lookup table, even if a creation response was
lost.

### Conventions

- Ids are UUIDs. Timestamps are UTC ISO 8601 strings.
- Lists are cursor-paged: pass the returned `nextCursor` unchanged as `cursor` until it is `null`.
- Requests use JSON, except PDF upload (multipart) and downloads (binary).
- Additive changes do not bump a version: ignore fields and event types you do not recognise.
