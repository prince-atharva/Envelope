# 0030. Report Role Mismatches Per Row in Bulk Send

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Engineering

## Context

[ADR 0028](0028-process-bulk-send-as-a-batch-of-independent-envelopes.md) item 1 said the request would be
validated as a whole, including that every row's people match the template's roles, and that a request failing
validation stores nothing. The same ADR, item 3, and the plan's finish line say that a batch with one bad row
still creates the good ones and reports the bad one with its code. Both cannot hold for a role mismatch.

Building it showed which matters more. A partner sending 500 rows would lose all of them to one typo in a role
name, and the browser's CSV preview already stops a person from sending rows it can see are wrong, so the API
is where tolerance is needed.

## Decision

This supersedes **item 1 of ADR 0028 only**; the rest of that ADR stands.

1. **Shape is checked up front, meaning is checked per row.** The request is refused, and nothing stored, for
   what makes it unreadable: not JSON of the right form, more than 500 rows (`BULK_TOO_LARGE`), an email
   that is not one, a missing name, an unknown key. That is `VALIDATION_FAILED` or `BULK_TOO_LARGE`.
2. **A row whose people do not match the template's roles is accepted.** The worker reaches it, finds
   `TEMPLATE_ROLE_MISMATCH` from the same `checkTemplatePeople` rule the browser uses, marks the row `FAILED`
   with that code, and carries on. The same holds for any other per-row failure found while creating.
3. **The browser still checks first.** `parseBulkCsv` applies the same rules before anything is sent, so a
   person sees a wrong row before it is a failed one.

We rejected:

- **Refusing the request for any bad row.** Simple to reason about, but it makes a large batch as fragile as
  its worst row, which is the opposite of why batches exist.
- **Dropping bad rows silently.** The sender would never learn which people were not sent to.

## Consequences

**Easier:**

- One wrong row never costs a partner the rest of their list.
- The API and the worker give a role mismatch one answer, in one place.

**Harder:**

- A partner whose rows are all wrong (a role renamed on the template) finds out from the batch result after a
  `202`, not from an immediate error. The batch result lists every row's code.

**Accepted:**

- A row that fails is not retried: the sender fixes it and sends a new batch (ADR 0028).
