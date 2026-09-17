-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('DRAFT', 'SENT', 'DELIVERED', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RecipientRole" AS ENUM ('SIGNER', 'APPROVER', 'VIEWER', 'CC');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'VIEWED', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT_INPUT', 'CHECKBOX');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "organization" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedById" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" UUID NOT NULL,
    "originalFileUrl" TEXT NOT NULL,
    "completedFileUrl" TEXT,
    "originalFilename" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "originalHash" TEXT NOT NULL,
    "finalHash" TEXT,
    "sequentialSigning" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "jurisdictionCode" TEXT NOT NULL DEFAULT 'US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "RecipientRole" NOT NULL DEFAULT 'SIGNER',
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "routingOrder" INTEGER NOT NULL DEFAULT 1,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenUsedAt" TIMESTAMP(3),
    "accessCode" TEXT,
    "consentGivenAt" TIMESTAMP(3),
    "consentText" TEXT,
    "signedAt" TIMESTAMP(3),
    "declinedReason" TEXT,
    "signedFromIp" TEXT,
    "signedFromUa" TEXT,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentField" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'SIGNATURE',
    "pageNumber" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "ratioX" DOUBLE PRECISION NOT NULL,
    "ratioY" DOUBLE PRECISION NOT NULL,
    "ratioWidth" DOUBLE PRECISION NOT NULL,
    "ratioHeight" DOUBLE PRECISION NOT NULL,
    "value" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdByRecipientId" UUID,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTrail" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "recipientId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "metadata" JSONB,
    "prevHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_replacedById_key" ON "Session"("replacedById");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");

-- CreateIndex
CREATE INDEX "Envelope_tenantId_status_idx" ON "Envelope"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Envelope_tenantId_createdAt_idx" ON "Envelope"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Envelope_ownerId_idx" ON "Envelope"("ownerId");

-- CreateIndex
CREATE INDEX "Envelope_expiresAt_idx" ON "Envelope"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_tokenHash_key" ON "Recipient"("tokenHash");

-- CreateIndex
CREATE INDEX "Recipient_envelopeId_routingOrder_idx" ON "Recipient"("envelopeId", "routingOrder");

-- CreateIndex
CREATE INDEX "DocumentField_envelopeId_pageNumber_idx" ON "DocumentField"("envelopeId", "pageNumber");

-- CreateIndex
CREATE INDEX "DocumentField_recipientId_idx" ON "DocumentField"("recipientId");

-- CreateIndex
CREATE INDEX "DocumentVersion_envelopeId_idx" ON "DocumentVersion"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_envelopeId_versionNumber_key" ON "DocumentVersion"("envelopeId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AuditTrail_eventHash_key" ON "AuditTrail"("eventHash");

-- CreateIndex
CREATE INDEX "AuditTrail_envelopeId_timestamp_idx" ON "AuditTrail"("envelopeId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditTrail_timestamp_idx" ON "AuditTrail"("timestamp");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentField" ADD CONSTRAINT "DocumentField_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentField" ADD CONSTRAINT "DocumentField_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdByRecipientId_fkey" FOREIGN KEY ("createdByRecipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ═════════════════════════════════════════════════════════════════════
--  Hand-written: rules Prisma's schema language cannot express.
--  See docs/05-data-model.md, "Invariants".
-- ═════════════════════════════════════════════════════════════════════

-- Invariants 1 and 2: field positions are page ratios and stay on the page.
-- The 1.000001 bound absorbs floating-point rounding from ratio arithmetic;
-- the application validates the exact [0, 1] range before writing.
ALTER TABLE "DocumentField"
  ADD CONSTRAINT "DocumentField_ratio_range" CHECK (
    "ratioX" >= 0 AND "ratioX" <= 1 AND
    "ratioY" >= 0 AND "ratioY" <= 1 AND
    "ratioWidth" > 0 AND "ratioWidth" <= 1 AND
    "ratioHeight" > 0 AND "ratioHeight" <= 1
  ),
  ADD CONSTRAINT "DocumentField_within_page" CHECK (
    "ratioX" + "ratioWidth" <= 1.000001 AND
    "ratioY" + "ratioHeight" <= 1.000001
  ),
  -- Invariant 3 (lower bound; the upper bound needs the page count, checked in the app).
  ADD CONSTRAINT "DocumentField_page_number_positive" CHECK ("pageNumber" >= 1);

ALTER TABLE "Recipient"
  ADD CONSTRAINT "Recipient_routing_order_positive" CHECK ("routingOrder" >= 1);

-- Invariant 7 (lower bound): version numbers start at 0.
ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_version_number_non_negative" CHECK ("versionNumber" >= 0),
  ADD CONSTRAINT "DocumentVersion_page_count_positive" CHECK ("pageCount" >= 1),
  ADD CONSTRAINT "DocumentVersion_size_positive" CHECK ("sizeBytes" > 0);

ALTER TABLE "Envelope"
  ADD CONSTRAINT "Envelope_page_count_positive" CHECK ("pageCount" >= 1);

-- Invariant 8: at most one final version per envelope.
CREATE UNIQUE INDEX "DocumentVersion_one_final_per_envelope"
  ON "DocumentVersion" ("envelopeId")
  WHERE "isFinal";

-- Invariant 6 support: an audit row's hash is always a 64-character hex SHA-256.
ALTER TABLE "AuditTrail"
  ADD CONSTRAINT "AuditTrail_event_hash_format" CHECK ("eventHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AuditTrail_prev_hash_format" CHECK ("prevHash" IS NULL OR "prevHash" ~ '^[0-9a-f]{64}$');

-- ─────────────────────────────────────────────────────────────────────
--  Privileges for the runtime role (invariant 5).
--
--  The API and worker connect as digitalsign_app, never as the schema
--  owner. It may read and write every table, except that audit rows can
--  only be inserted and read. The role must exist before this migration
--  runs (docker/postgres/init/01-roles.sh locally; create it by hand in
--  any other environment).
-- ─────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO digitalsign_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO digitalsign_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO digitalsign_app;

-- Tables created by later migrations (run by this same owner role) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO digitalsign_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO digitalsign_app;

-- Append-only audit trail: no UPDATE, DELETE or TRUNCATE for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditTrail" FROM digitalsign_app;
GRANT SELECT, INSERT ON "AuditTrail" TO digitalsign_app;

-- The migration ledger is not the application's business.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM digitalsign_app;
  END IF;
END
$$;
