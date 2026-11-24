-- Expand-only zero-downtime migration for native mobile authentication (Google/Apple + rotating refresh tokens)

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleSub" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MobileRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleSub_key" ON "User"("appleSub");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MobileRefreshToken_tokenHash_key" ON "MobileRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MobileRefreshToken_userId_expiresAt_idx" ON "MobileRefreshToken"("userId", "expiresAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MobileRefreshToken_userId_fkey'
    ) THEN
        ALTER TABLE "MobileRefreshToken"
        ADD CONSTRAINT "MobileRefreshToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
