-- Bulk send (docs/20 step 4, ADR 0028): the address and browser of whoever
-- accepted a batch, so the envelopes its worker creates carry the same
-- audit evidence as ones made by hand. BulkBatch is new in this release, so
-- the columns are added to an empty table; the defaults only satisfy NOT NULL.
ALTER TABLE "BulkBatch" ADD COLUMN "clientIp" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "BulkBatch" ADD COLUMN "clientUserAgent" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "BulkBatch" ALTER COLUMN "clientIp" DROP DEFAULT;
ALTER TABLE "BulkBatch" ALTER COLUMN "clientUserAgent" DROP DEFAULT;
