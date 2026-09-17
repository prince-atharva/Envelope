-- Phase 2, step 3: a draft can hold recipients and fields before it is sent.
--
-- The generated section comes from `prisma migrate diff`. The hand-written
-- section below it adds rules Prisma's schema language cannot express.

-- DropForeignKey
ALTER TABLE "DocumentField" DROP CONSTRAINT "DocumentField_recipientId_fkey";

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "draftRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "message" TEXT;

-- AlterTable
--
-- tokenHash and tokenExpiresAt become nullable: a recipient added while
-- preparing a draft has no signing token yet. Tokens are minted when the
-- envelope is sent (Phase 3). Postgres allows any number of NULLs in a unique
-- index, so tokenHash stays unique for the tokens that do exist.
ALTER TABLE "Recipient" ADD COLUMN     "colorIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "tokenHash" DROP NOT NULL,
ALTER COLUMN "tokenExpiresAt" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_id_envelopeId_key" ON "Recipient"("id", "envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_envelopeId_email_key" ON "Recipient"("envelopeId", "email");

-- AddForeignKey
--
-- Invariant 4 (docs/05): a field's recipient MUST belong to the same envelope as
-- the field. The old single-column key allowed a field on envelope A to point at
-- a recipient of envelope B; only application code stood in the way. This
-- composite key makes the database refuse it.
ALTER TABLE "DocumentField" ADD CONSTRAINT "DocumentField_recipientId_envelopeId_fkey" FOREIGN KEY ("recipientId", "envelopeId") REFERENCES "Recipient"("id", "envelopeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════
--  Hand-written: rules Prisma's schema language cannot express.
-- ═════════════════════════════════════════════════════════════════════

-- The routing order is also capped, because it is offered as a position in a
-- list of recipients and that list is limited (MAX_RECIPIENTS_PER_ENVELOPE).
-- The lower bound already exists as Recipient_routing_order_positive.
ALTER TABLE "Recipient"
  ADD CONSTRAINT "Recipient_routing_order_max" CHECK ("routingOrder" <= 50),
  -- Colours are indexes into the builder's palette, never negative.
  ADD CONSTRAINT "Recipient_color_index_non_negative" CHECK ("colorIndex" >= 0);

-- A draft revision only ever moves forward.
ALTER TABLE "Envelope"
  ADD CONSTRAINT "Envelope_draft_revision_non_negative" CHECK ("draftRevision" >= 0);

-- The runtime role's privileges are granted per table, and both tables already
-- had them, so no new GRANT is needed. New COLUMNS are covered by the existing
-- table-level grants; this is asserted by the e2e suite rather than assumed.
