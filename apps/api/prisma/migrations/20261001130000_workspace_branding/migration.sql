-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "brandLogoKey" TEXT,
ADD COLUMN     "brandLogoRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_brandLogoRef_key" ON "Tenant"("brandLogoRef");
