-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "externalId" VARCHAR(200),
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "EmbedSession" ADD COLUMN     "externalId" VARCHAR(200),
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "Envelope_tenantId_externalId_idx" ON "Envelope"("tenantId", "externalId");

