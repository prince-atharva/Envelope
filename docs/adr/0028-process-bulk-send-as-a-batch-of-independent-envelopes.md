# 0028. Process Bulk Send as a Batch of Independent Envelopes on a Queue

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

ENV-08 asks for bulk send: one template, many recipients, one envelope each. docs/01 also sets a
throughput target of 100 envelopes a minute sustained per tenant. Today `POST /envelopes` and send
share the `createAndSend` limit of 100 a minute per tenant, each create copies and stores a PDF, and
send enqueues mail and webhooks after commit. Three questions are not obvious:

- **Where does the work run?** A 500-row request cannot finish inside one HTTP call.
- **What happens when a row is bad?** A wrong email or a blocked category on row 37 must not stop rows
  38 to 500, and must not undo rows 1 to 36.
- **Where do the recipients wait?** Jobs carry ids only (AGENTS §7), so the rows must live in Postgres,
  and they are personal data.

## Decision

We will accept a batch quickly and process it in a worker:

1. **`BulkBatch` and `BulkBatchRow`.** `POST /templates/:id/bulk` validates the whole request (shape,
   row count at most 500, role slots match, emails valid), stores one batch and one row per envelope in
   a single transaction, then returns `202 {batchId}`. A request that fails validation stores nothing.
2. **One job per batch**, enqueued after the transaction commits on a new `bulk` queue beside the mail
   and seal queues. The job carries the batch id. The worker processes rows in order, one envelope at a
   time, through the same instantiation and send code as `POST /templates/:id/envelopes`.
3. **Partial failure is normal.** A row that fails records its error code and moves on; a row that
   succeeds records its envelope id. The batch becomes `COMPLETED` when no row is pending, with the
   counts. Nothing is rolled back across rows.
4. **Rows are idempotent.** A row already `SUCCEEDED` or holding an `envelopeId` is skipped, so a job
   retried after a crash creates no duplicate. The row's `envelopeId` is written in the same transaction
   that creates the envelope, so there is no moment where the envelope exists and the row does not know
   it. (The partner reference of ADR 0019 is a label, not a unique key, so it cannot do this job.) A
   crash after the commit but before the send is finished by the retry, which sends the still-`DRAFT`
   envelope that a `PENDING` row already points at.
5. **Recipient data is cleared once used.** When a row is processed, its `recipients` JSON is set to
   null: from then on the envelope is the record. Failed rows keep the JSON so the sender can see
   which rows to fix, and it is cleared when the batch is 30 days old by the expired-session purge job,
   which gains this one duty.
6. **Its own limit.** A new `bulkBatch` limit (10 batches an hour per tenant) guards the endpoint. The
   per-envelope `createAndSend` limit is not charged per row: the worker's one-at-a-time pace is the
   throttle. A failed row is retried only by the sender submitting a new batch.

We rejected:

- **One synchronous call.** Timeouts, and the 100 a minute limit would reject a large request midway.
- **One transaction for the whole batch.** One bad row would fail all of them, and a long transaction
  would hold locks while copying files.
- **A queue job per row.** Floods the queue and makes progress harder to show; one job with a row table
  gives both ordering and a progress view.
- **Parsing CSV on the server.** The browser parses and previews the CSV with the same shared
  validation and posts JSON; the API stays one shape for people and partners.

## Consequences

**Easier:**

- A partner and a person use one endpoint and one result shape.
- A crash, a restart or a retry cannot create duplicate envelopes.

**Harder:**

- A new queue, a new worker processor and a progress view to keep correct.
- Recipient personal data sits in a table for the time a batch takes (and for failed rows, longer).

**Accepted:**

- No cancel and no scheduling: a batch runs to completion once accepted.
- Failed rows are not retried automatically; the sender fixes the data and sends a new batch.
- Sending 500 envelopes sends at least 500 emails from one sender, at the provider's pace. Delivery is
  tracked by ADR 0029, not slowed by this ADR.
