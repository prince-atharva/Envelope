-- CreateTable
CREATE TABLE "ApiKeyEmbedOrigin" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "apiKeyId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeyEmbedOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiKeyEmbedOrigin_tenantId_idx" ON "ApiKeyEmbedOrigin"("tenantId");

-- CreateIndex
CREATE INDEX "ApiKeyEmbedOrigin_apiKeyId_idx" ON "ApiKeyEmbedOrigin"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyEmbedOrigin_apiKeyId_origin_key" ON "ApiKeyEmbedOrigin"("apiKeyId", "origin");

-- AddForeignKey
ALTER TABLE "ApiKeyEmbedOrigin" ADD CONSTRAINT "ApiKeyEmbedOrigin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyEmbedOrigin" ADD CONSTRAINT "ApiKeyEmbedOrigin_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyEmbedOrigin" ADD CONSTRAINT "ApiKeyEmbedOrigin_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (docs/18 workstream 7, ADR 0017): every tenant's existing
-- tenant-wide EmbedOrigin grant is copied onto each of that tenant's
-- non-revoked, full-access ApiKey rows, preserving what those keys could
-- already do before origins became per-key. A read-only key is skipped: it
-- could never issue an embedded session anyway (embed-session.service.ts's
-- assertActive() already requires readOnly = false), so it needs no origins.
-- createdByUserId is copied from the original grant, not re-attributed to
-- whichever key it lands on.
INSERT INTO "ApiKeyEmbedOrigin" ("id", "tenantId", "apiKeyId", "origin", "createdByUserId", "createdAt")
SELECT gen_random_uuid(), eo."tenantId", ak.id, eo.origin, eo."createdByUserId", eo."createdAt"
  FROM "EmbedOrigin" eo
  JOIN "ApiKey" ak
    ON ak."tenantId" = eo."tenantId"
   AND ak."revokedAt" IS NULL
   AND ak."readOnly" = false
 ON CONFLICT ("apiKeyId", "origin") DO NOTHING;
