# 0006. Run Sealing Asynchronously on Workers

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Engineering

## Context

Stamping loads the whole PDF into memory. A 500-page, 25 MB document can take seconds, and a signer
on a phone must not wait for it (doc 03). Two signers can also finish at the same moment. Each
version is built on the one before it (ADR 0003), so two stamps running side by side would both
start from the same version, and one signature would be lost. A worker retry must never stamp the
same signature twice either (doc 06, gotcha 11).

## Decision

- **Submit returns 202 and queues a `seal` job** that carries only the envelope id. The signer's
  values are already stored.
- **The worker takes a per-envelope lock**, a Postgres advisory lock held for the length of one
  round's transaction, so one envelope is stamped by one worker at a time. It is an advisory lock
  rather than a row lock, so a decline, a reminder or a page load is not held up by a long stamp.
- **Round by round**, it stamps the oldest signer who has signed but has no version yet, commits,
  and repeats. Then, if everyone required has signed, it seals the final version. Each round
  re-reads the state under the lock, so two jobs for one envelope interleave safely.
- **Idempotency.** Each version's file is written to a fixed key, `versions/v{n}.pdf`, before its
  row is inserted. The unique `(envelopeId, versionNumber)` is the commit point. A retry that finds
  the row moves on. A retry that failed before the insert overwrites the same key. Nothing is
  stamped twice.
- **The work is taken from the database, not from the job.** A job for a signer who is already
  stamped does nothing, and one job can catch up on several signers.
- **A declined or voided envelope is not sealed further.** Versions already made are kept.

## Consequences

**Easier:**

- Signers get an immediate answer, whatever the document's size.
- Retries, crashes and duplicate jobs cannot produce a wrong or duplicated version.

**Harder:**

- The next signer's invitation now waits for the previous version to be stamped: seconds, not
  milliseconds.
- A decline can commit while a round is stamping. The version is still made, because the person did
  sign, but the next round sees the declined envelope and stops.

**Accepted:**

- Envelopes are sealed one at a time each, but many envelopes are sealed in parallel, up to the
  queue's concurrency.
