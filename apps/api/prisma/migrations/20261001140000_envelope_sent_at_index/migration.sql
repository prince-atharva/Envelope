-- CreateIndex
CREATE INDEX "Envelope_tenantId_sentAt_idx" ON "Envelope"("tenantId", "sentAt");
