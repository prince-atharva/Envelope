-- Phase 4, step 2: the sealing engine.
--
-- The generated section matches what `prisma migrate diff` produces for the
-- schema change. The hand-written section below it adds a rule Prisma's schema
-- language cannot express.

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "storageVersionId" TEXT;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "servedVersionNumber" INTEGER;

-- ═════════════════════════════════════════════════════════════════════
--  Hand-written: rules Prisma's schema language cannot express.
-- ═════════════════════════════════════════════════════════════════════

-- A completed envelope always carries its seal: the final fingerprint, where
-- the sealed file is, and when it was sealed (docs/06, ADR 0007). No envelope
-- could be completed before this migration, so no existing row can fail it.
ALTER TABLE "Envelope"
  ADD CONSTRAINT "Envelope_completed_has_seal"
    CHECK ("status" <> 'COMPLETED' OR (
      "finalHash" IS NOT NULL AND "completedFileUrl" IS NOT NULL AND "completedAt" IS NOT NULL
    ));

-- The final version is always read by its storage version id, so it must have
-- one; no other version does.
ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_final_has_storage_version"
    CHECK (("isFinal" = false AND "storageVersionId" IS NULL)
        OR ("isFinal" = true AND "storageVersionId" IS NOT NULL));

-- No new tables, so no new GRANT. The runtime role's table-level privileges
-- already cover new columns.
