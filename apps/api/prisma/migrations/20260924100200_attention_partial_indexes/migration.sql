-- 100M-row scale follow-up (docs/16 step 14, dashboard perf audit).
--
-- Partial indexes: Prisma's schema language has no `where` clause for
-- @@index, so these exist only here, like the DocumentVersion one-final-
-- per-envelope unique index in the initial migration.
--
-- PRODUCTION NOTE: same as 20260924100000_scale_indexes — run the
-- CONCURRENTLY form by hand against a live database, then
-- `prisma migrate resolve --applied 20260924100200_attention_partial_indexes`.
--
-- The status list must be kept in sync with OPEN_ENVELOPE_STATUSES
-- (packages/shared/src/envelopes.ts) plus 'EXPIRED' and 'DECLINED': the
-- working set the rewritten Needs-attention/counts query restricts itself
-- to (envelope-views.ts).
CREATE INDEX "Envelope_tenantId_attention_working_set_idx"
  ON "Envelope" ("tenantId")
  WHERE status IN ('SENT', 'DELIVERED', 'PARTIALLY_SIGNED', 'EXPIRED', 'DECLINED');

-- The automatic-reminder sweep only ever looks at signers/approvers whose
-- link is still unused. Matches the WHERE in auto-reminder.service.ts.
CREATE INDEX "Recipient_envelopeId_reminder_candidates_idx"
  ON "Recipient" ("envelopeId")
  WHERE role IN ('SIGNER', 'APPROVER') AND "tokenUsedAt" IS NULL;
