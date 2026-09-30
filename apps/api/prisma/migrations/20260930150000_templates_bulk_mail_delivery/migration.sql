-- Templates, bulk send and delivery tracking (docs/20 step 1, ADR 0027, ADR 0028, ADR 0029).
-- Additive only: six new tables, three new enums and their indexes. The new
-- tables need no explicit GRANT: the default privileges set in the initial
-- migration cover tables this owner role creates.

-- CreateEnum
CREATE TYPE "BulkBatchStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BulkRowStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MailDeliveryStatus" AS ENUM ('SENT', 'BOUNCED', 'COMPLAINED');

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "originalFileUrl" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "originalSizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "documentCategory" TEXT NOT NULL DEFAULT 'OTHER',
    "defaultMessage" TEXT,
    "sequentialSigning" BOOLEAN NOT NULL DEFAULT false,
    "reminderIntervalDays" INTEGER,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateRole" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "RecipientRole" NOT NULL DEFAULT 'SIGNER',
    "routingOrder" INTEGER NOT NULL DEFAULT 1,
    "colorIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateField" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "templateRoleId" UUID NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'SIGNATURE',
    "pageNumber" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "ratioX" DOUBLE PRECISION NOT NULL,
    "ratioY" DOUBLE PRECISION NOT NULL,
    "ratioWidth" DOUBLE PRECISION NOT NULL,
    "ratioHeight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkBatch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" "BulkBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "sendOnCreate" BOOLEAN NOT NULL,
    "message" TEXT,
    "totalRows" INTEGER NOT NULL,
    "succeededRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BulkBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkBatchRow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "status" "BulkRowStatus" NOT NULL DEFAULT 'PENDING',
    "recipients" JSONB,
    "externalId" VARCHAR(200),
    "metadata" JSONB,
    "envelopeId" UUID,
    "errorCode" TEXT,

    CONSTRAINT "BulkBatchRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDelivery" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "recipientId" UUID,
    "messageId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "MailDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_tenantId_archivedAt_idx" ON "Template"("tenantId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateRole_id_templateId_key" ON "TemplateRole"("id", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateRole_templateId_name_key" ON "TemplateRole"("templateId", "name");

-- CreateIndex
CREATE INDEX "TemplateField_templateId_pageNumber_idx" ON "TemplateField"("templateId", "pageNumber");

-- CreateIndex
CREATE INDEX "TemplateField_templateRoleId_idx" ON "TemplateField"("templateRoleId");

-- CreateIndex
CREATE INDEX "BulkBatch_tenantId_createdAt_idx" ON "BulkBatch"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BulkBatch_status_createdAt_idx" ON "BulkBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BulkBatchRow_envelopeId_idx" ON "BulkBatchRow"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkBatchRow_batchId_rowIndex_key" ON "BulkBatchRow"("batchId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MailDelivery_messageId_key" ON "MailDelivery"("messageId");

-- CreateIndex
CREATE INDEX "MailDelivery_envelopeId_idx" ON "MailDelivery"("envelopeId");

-- CreateIndex
CREATE INDEX "MailDelivery_recipientId_idx" ON "MailDelivery"("recipientId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateRole" ADD CONSTRAINT "TemplateRole_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateRoleId_templateId_fkey" FOREIGN KEY ("templateRoleId", "templateId") REFERENCES "TemplateRole"("id", "templateId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkBatch" ADD CONSTRAINT "BulkBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkBatch" ADD CONSTRAINT "BulkBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkBatch" ADD CONSTRAINT "BulkBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkBatchRow" ADD CONSTRAINT "BulkBatchRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkBatchRow" ADD CONSTRAINT "BulkBatchRow_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A template's name is unique per workspace among templates that are not
-- archived. Prisma's schema language cannot express a partial unique index, so
-- it exists only here, like the attention indexes in
-- 20260924100200_attention_partial_indexes.
CREATE UNIQUE INDEX "Template_tenantId_name_active_key"
  ON "Template" ("tenantId", "name")
  WHERE "archivedAt" IS NULL;
