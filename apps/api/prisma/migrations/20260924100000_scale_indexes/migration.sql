-- 100M-row scale follow-up (docs/16 step 14, dashboard perf audit).
--
-- Plain DDL, so this applies with `prisma migrate dev`/`deploy` like every
-- other migration here (Prisma always wraps a migration.sql in a
-- transaction, and CONCURRENTLY cannot run inside one — confirmed against
-- this Prisma version, not assumed).
--
-- PRODUCTION NOTE: once this table carries real traffic, do not let this
-- file's CREATE/DROP INDEX statements take their locks through a normal
-- deploy. Instead, before running `prisma migrate deploy`, connect directly
-- (psql, not through Prisma) and run the CONCURRENTLY form of each
-- statement below, then `prisma migrate resolve --applied
-- 20260924100000_scale_indexes` so Prisma records it as already done and
-- skips re-running the blocking version.

-- Drop indexes no query in the codebase uses. Every AuditTrail read filters
-- by envelopeId (covered by the envelopeId,sequence unique index) or by
-- recipientId (covered below); none filters or sorts by timestamp alone.
DROP INDEX IF EXISTS "AuditTrail_envelopeId_timestamp_idx";
DROP INDEX IF EXISTS "AuditTrail_timestamp_idx";

-- Duplicates the leading column of the envelopeId,versionNumber unique index.
DROP INDEX IF EXISTS "DocumentVersion_envelopeId_idx";

-- The expiry sweep uses (status, expiresAt); nothing filters by expiresAt alone.
DROP INDEX IF EXISTS "Envelope_expiresAt_idx";

-- Replaced below by composite indexes that also carry the cursor's tiebreak
-- column, so the dashboard's list query gets an index range scan instead of
-- an index scan followed by a sort.
DROP INDEX IF EXISTS "Envelope_tenantId_createdAt_idx";
DROP INDEX IF EXISTS "Envelope_tenantId_status_idx";

-- The All tab: newest first, with the id tiebreak the cursor compares on.
CREATE INDEX "Envelope_tenantId_createdAt_id_idx"
  ON "Envelope" ("tenantId", "createdAt" DESC, "id" DESC);

-- Every other status tab, same cursor shape.
CREATE INDEX "Envelope_tenantId_status_createdAt_id_idx"
  ON "Envelope" ("tenantId", "status", "createdAt" DESC, "id" DESC);

-- Foreign keys into Recipient that had no index. Postgres scans every
-- referencing table on a parent delete, so removing a recipient from a
-- draft had to scan all three of these at full table size.
CREATE INDEX "AuditTrail_recipientId_idx" ON "AuditTrail" ("recipientId");
CREATE INDEX "DocumentVersion_createdByRecipientId_idx" ON "DocumentVersion" ("createdByRecipientId");
CREATE INDEX "CompletionDownload_recipientId_idx" ON "CompletionDownload" ("recipientId");
