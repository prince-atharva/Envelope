-- AlterTable
ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT,
ADD COLUMN "inviteTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");
