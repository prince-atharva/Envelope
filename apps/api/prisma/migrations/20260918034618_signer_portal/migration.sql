-- Phase 3, step 3: sending, signer progress and adopted signatures.
--
-- The generated section comes from `prisma migrate dev --create-only`. The
-- hand-written section below it adds rules Prisma's schema language cannot
-- express.

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DRAWN', 'TYPED');

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "initialsImageKey" TEXT,
ADD COLUMN     "initialsMethod" "SignatureMethod",
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "lastRemindedAt" TIMESTAMP(3),
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "signatureImageKey" TEXT,
ADD COLUMN     "signatureMethod" "SignatureMethod",
ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- ═════════════════════════════════════════════════════════════════════
--  Hand-written: rules Prisma's schema language cannot express.
-- ═════════════════════════════════════════════════════════════════════

-- Every envelope that has left DRAFT records when it did. No envelope could be
-- sent before this migration, so no existing row can fail the check.
ALTER TABLE "Envelope"
  ADD CONSTRAINT "Envelope_sent_has_time" CHECK ("status" = 'DRAFT' OR "sentAt" IS NOT NULL);

ALTER TABLE "Recipient"
  -- A signed recipient always carries the time and a spent token (ADR 0009).
  ADD CONSTRAINT "Recipient_signed_has_evidence"
    CHECK ("status" <> 'SIGNED' OR ("signedAt" IS NOT NULL AND "tokenUsedAt" IS NOT NULL)),
  -- Declining requires a reason (docs/03).
  ADD CONSTRAINT "Recipient_declined_has_reason"
    CHECK ("status" <> 'DECLINED' OR ("declinedAt" IS NOT NULL AND "declinedReason" IS NOT NULL)),
  -- Consent is never recorded without the verbatim text that was agreed to
  -- (docs/07), and the text is never stored without the moment of consent.
  ADD CONSTRAINT "Recipient_consent_has_text"
    CHECK (("consentGivenAt" IS NULL) = ("consentText" IS NULL)),
  -- An adopted image always says how it was made, and a method never stands
  -- without its image.
  ADD CONSTRAINT "Recipient_signature_has_method"
    CHECK (("signatureImageKey" IS NULL) = ("signatureMethod" IS NULL)),
  ADD CONSTRAINT "Recipient_initials_has_method"
    CHECK (("initialsImageKey" IS NULL) = ("initialsMethod" IS NULL));

-- No new tables, so no new GRANT. The runtime role's table-level privileges
-- already cover new columns.
