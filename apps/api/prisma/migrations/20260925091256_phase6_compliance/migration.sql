-- AlterTable
ALTER TABLE "CompletionDownload" ADD COLUMN     "lastRenewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "documentCategory" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "legalHoldAt" TIMESTAMP(3),
ADD COLUMN     "legalHoldByUserId" UUID,
ADD COLUMN     "legalHoldReason" TEXT,
ADD COLUMN     "policySnapshot" JSONB,
ADD COLUMN     "policyVersion" INTEGER,
ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "jurisdictionCode" TEXT NOT NULL DEFAULT 'US';

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_legalHoldByUserId_fkey" FOREIGN KEY ("legalHoldByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (docs/17 step 3): every envelope that existed before Phase 6 gets
-- today's US v1 policy frozen onto it, exactly the snapshot resolvePolicySnapshot()
-- would produce for jurisdictionCode = 'US' (the default every existing row already
-- has). This is the same draft disclosure text as
-- packages/shared/src/jurisdiction.ts's draftDisclosure('the United States'); if
-- that text ever changes, it changes only JURISDICTION_POLICY_VERSION going
-- forward, never this migration.
UPDATE "Envelope"
   SET "policySnapshot" = jsonb_build_object(
         'code', 'US',
         'permittedTiers', jsonb_build_array('SES', 'AES'),
         'minimumIdentityAssurance', 'EMAIL',
         'consentRequired', true,
         'consentDisclosureText', E'DRAFT — not legally reviewed. This placeholder notice will be replaced with approved wording before real use.\n\nAgreement to sign electronically\n\nBy ticking the box below, you agree to receive this document and to sign it electronically instead of on paper. Your electronic signature will have the same effect as a handwritten one.\n\nThis agreement covers this document only.\n\nYou may ask the sender for a paper copy of this document at any time. There is no charge for a paper copy.\n\nYou may withdraw this agreement at any time before you finish signing by choosing Decline. After you have signed, withdrawing it does not undo your signature.\n\nTo sign, you need a device with an up-to-date web browser and an internet connection, and an email address where you can receive a copy of the signed document. Records are kept in line with the United States''s retention rules.',
         'retentionYears', 7,
         'dataResidencyRegion', 'us-east-1',
         'requireTimestamp', false,
         'blockedDocumentCategories', jsonb_build_array(
           'WILL_OR_TESTAMENTARY', 'PROPERTY_TRANSFER', 'FAMILY_LAW',
           'NEGOTIABLE_INSTRUMENT', 'COURT_FILING', 'UTILITY_EVICTION_INSURANCE_NOTICE'
         ),
         'version', 1,
         'resolvedAt', to_jsonb(now()),
         'resolvedFrom', 'tenant'
       ),
       "policyVersion" = 1
 WHERE "policySnapshot" IS NULL;

-- The retention sweeper's own working set (docs/17 step 8): open work is never
-- retention-eligible, so this excludes it the same way the attention index
-- does, and skips anything already purged or held.
CREATE INDEX "Envelope_retention_candidates_idx"
  ON "Envelope" ("status", "updatedAt")
  WHERE "purgedAt" IS NULL AND "legalHoldAt" IS NULL;
