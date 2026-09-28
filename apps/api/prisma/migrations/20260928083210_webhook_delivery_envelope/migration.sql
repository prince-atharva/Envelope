-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "envelopeId" UUID;

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_envelopeId_idx" ON "WebhookDelivery"("tenantId", "envelopeId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_id_idx" ON "WebhookDelivery"("tenantId", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookEndpointId_id_idx" ON "WebhookDelivery"("webhookEndpointId", "id");

-- Backfill (docs/18 workstream 8): every existing delivery's envelopeId was
-- already recorded in its stored payload; this only surfaces it as a real
-- column for filtering, it does not change what was actually delivered.
-- A webhook.test delivery (workstream 9, none exist before this migration)
-- has no envelopeId and is left null. Malformed historical values (including
-- older test fixtures) stay in the payload and leave the new column null.
UPDATE "WebhookDelivery"
   SET "envelopeId" = (payload -> 'data' ->> 'envelopeId')::uuid
 WHERE payload -> 'data' ->> 'envelopeId' ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
