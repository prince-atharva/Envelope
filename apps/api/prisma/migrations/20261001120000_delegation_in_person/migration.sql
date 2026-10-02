-- AlterEnum
ALTER TYPE "RecipientStatus" ADD VALUE 'DELEGATED';

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "allowDelegation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "delegatedAt" TIMESTAMP(3),
ADD COLUMN     "delegatedFromId" UUID,
ADD COLUMN     "inPersonHostUserId" UUID,
ADD COLUMN     "inPersonStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Recipient_delegatedFromId_idx" ON "Recipient"("delegatedFromId");

-- CreateIndex
CREATE INDEX "Recipient_inPersonHostUserId_idx" ON "Recipient"("inPersonHostUserId");

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_delegatedFromId_fkey" FOREIGN KEY ("delegatedFromId") REFERENCES "Recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_inPersonHostUserId_fkey" FOREIGN KEY ("inPersonHostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

