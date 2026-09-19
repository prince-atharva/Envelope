# 0007. Apply Object Lock to the Final Version Only

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Engineering

## Context

A sealed document is only worth something if nobody can quietly replace it later, including us and
anyone who takes over our cloud account. S3 Object Lock makes an object impossible to overwrite or
delete until a retention date. It can only be switched on when a bucket is created. In-progress
versions must stay writable, because a retry may overwrite them before their row is committed
(ADR 0006) and the retention sweeper will remove abandoned ones.

## Decision

- **The final, sealed version goes into its own bucket**, created with Object Lock
  (`mc mb --with-lock` in development). Versions 0 to N stay in the documents bucket, unlocked.
- **Each final file gets a retention date** at write time. It defaults to seven years
  (`SEALED_RETENTION_DAYS`), the retention period in docs 01 and 07.
- **Mode:**
  - `COMPLIANCE` in production: nobody can shorten the retention or delete the file, not even the
    account's root user.
  - `GOVERNANCE` in development and test, so that test files can be removed with special
    permission.

  The mode comes from `SEALED_RETENTION_MODE`, and the service refuses to start in production with
  anything but `COMPLIANCE`.
- **Reads name the version.** Object Lock requires a versioned bucket. There, a later write to the
  same key does not fail: it adds a newer version on top. A plain delete adds a delete marker. Both
  leave the locked version untouched, but a read by key alone would then return something else. So
  the storage version id returned by the write is kept in `DocumentVersion.storageVersionId`, and
  every read of a sealed file names it. The key is kept in `DocumentVersion.fileUrl` and
  `Envelope.completedFileUrl`.

## Consequences

**Easier:**

- A finished document cannot be changed or removed, even with full access to the storage account.
- The storage provider's own records show the retention, independently of our database.

**Harder:**

- Mistakes are permanent. A file sealed in `COMPLIANCE` mode by error stays, and is paid for, for
  seven years.
- There are two buckets to provision, back up and grant access to.

**Accepted:**

- A legal hold, or a retention longer than the default, is applied on top. An erasure request for a
  sealed document is refused while retention applies, and the refusal is audited (doc 07).
