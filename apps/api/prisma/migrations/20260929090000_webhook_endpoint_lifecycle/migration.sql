-- Webhook endpoint lifecycle (docs/18 workstream 9): secret rotation with an
-- overlap window, and consecutive-failure tracking for auto-disable. Additive
-- only; every existing endpoint starts healthy with no rotation in progress.
-- No new tables, so no new GRANT (the runtime role's table-level privileges
-- from the initial migration cover new columns).

-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "previousSecretCiphertext" TEXT,
ADD COLUMN     "previousSecretExpiresAt" TIMESTAMP(3),
ADD COLUMN     "secretRotatedAt" TIMESTAMP(3);
