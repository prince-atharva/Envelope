-- CreateTable
CREATE TABLE "EmbedOrigin" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbedOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "apiKeyId" UUID NOT NULL,
    "actingUserId" UUID NOT NULL,
    "envelopeId" UUID,
    "parentOrigin" TEXT NOT NULL,
    "externalActorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "actions" TEXT[],
    "launchTokenHash" TEXT NOT NULL,
    "accessTokenHash" TEXT,
    "launchExpiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmbedOrigin_tenantId_idx" ON "EmbedOrigin"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedOrigin_tenantId_origin_key" ON "EmbedOrigin"("tenantId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedSession_launchTokenHash_key" ON "EmbedSession"("launchTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedSession_accessTokenHash_key" ON "EmbedSession"("accessTokenHash");

-- CreateIndex
CREATE INDEX "EmbedSession_tenantId_envelopeId_idx" ON "EmbedSession"("tenantId", "envelopeId");

-- CreateIndex
CREATE INDEX "EmbedSession_apiKeyId_idx" ON "EmbedSession"("apiKeyId");

-- CreateIndex
CREATE INDEX "EmbedSession_expiresAt_idx" ON "EmbedSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmbedOrigin" ADD CONSTRAINT "EmbedOrigin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedOrigin" ADD CONSTRAINT "EmbedOrigin_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedSession" ADD CONSTRAINT "EmbedSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedSession" ADD CONSTRAINT "EmbedSession_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedSession" ADD CONSTRAINT "EmbedSession_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedSession" ADD CONSTRAINT "EmbedSession_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

