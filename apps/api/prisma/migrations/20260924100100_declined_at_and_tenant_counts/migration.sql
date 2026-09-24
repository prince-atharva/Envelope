-- 100M-row scale follow-up (docs/16 step 14, dashboard perf audit).
--
-- Two changes, kept in one transactional migration because the backfill of
-- each depends on the column/table the same migration creates:
--   1. Envelope.declinedAt, so Needs-attention can find recent declines
--      without aggregating Recipient across the tenant's whole history.
--   2. TenantEnvelopeCount, a trigger-maintained per-status count, so the
--      dashboard's tab counts are a read of ~8 rows instead of a scan.

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN "declinedAt" TIMESTAMP(3);

-- Backfill from the recipient(s) whose decline actually put the envelope
-- into DECLINED. Falls back to updatedAt for any row with no matching
-- recipient event (should not happen going forward; only a safety net for
-- data already in the table).
UPDATE "Envelope" e
   SET "declinedAt" = coalesce(
     (SELECT max(r."declinedAt") FROM "Recipient" r WHERE r."envelopeId" = e.id),
     e."updatedAt"
   )
 WHERE e.status = 'DECLINED' AND e."declinedAt" IS NULL;

-- CreateTable
CREATE TABLE "TenantEnvelopeCount" (
    "tenantId" UUID NOT NULL,
    "status" "EnvelopeStatus" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantEnvelopeCount_pkey" PRIMARY KEY ("tenantId", "status")
);

-- Backfill from the envelopes that already exist.
INSERT INTO "TenantEnvelopeCount" ("tenantId", "status", "count")
SELECT "tenantId", status, count(*)::int
  FROM "Envelope"
 GROUP BY "tenantId", status;

-- Keep it exact from here on. Runs as the caller's role (digitalsign_app in
-- production), which already has CRUD on this table via the default
-- privileges the init migration granted for tables created after it.
CREATE OR REPLACE FUNCTION envelope_count_track() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "TenantEnvelopeCount" ("tenantId", "status", "count")
    VALUES (NEW."tenantId", NEW.status, 1)
    ON CONFLICT ("tenantId", "status")
      DO UPDATE SET "count" = "TenantEnvelopeCount"."count" + 1;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE "TenantEnvelopeCount"
         SET "count" = "count" - 1
       WHERE "tenantId" = OLD."tenantId" AND "status" = OLD.status;
      INSERT INTO "TenantEnvelopeCount" ("tenantId", "status", "count")
      VALUES (NEW."tenantId", NEW.status, 1)
      ON CONFLICT ("tenantId", "status")
        DO UPDATE SET "count" = "TenantEnvelopeCount"."count" + 1;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "TenantEnvelopeCount"
       SET "count" = "count" - 1
     WHERE "tenantId" = OLD."tenantId" AND "status" = OLD.status;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER envelope_count_trigger
  AFTER INSERT OR UPDATE OF status OR DELETE ON "Envelope"
  FOR EACH ROW EXECUTE FUNCTION envelope_count_track();
