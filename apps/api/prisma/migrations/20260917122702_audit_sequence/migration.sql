-- Audit events get a per-envelope sequence number (1, 2, 3, ...), so the hash
-- chain's order never depends on timestamps, which can collide within a millisecond.
-- The table holds no rows yet, so the NOT NULL column needs no default.

-- AlterTable
ALTER TABLE "AuditTrail" ADD COLUMN     "sequence" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AuditTrail_envelopeId_sequence_key" ON "AuditTrail"("envelopeId", "sequence");

-- Hand-written: sequence numbers start at 1, and only the first event has no predecessor.
ALTER TABLE "AuditTrail"
  ADD CONSTRAINT "AuditTrail_sequence_positive" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "AuditTrail_first_event_has_no_prev" CHECK (("sequence" = 1) = ("prevHash" IS NULL));
