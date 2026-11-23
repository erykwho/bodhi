-- AlterEnum
ALTER TYPE "SessionMode" ADD VALUE IF NOT EXISTS 'BREATHING';

-- AlterTable
ALTER TABLE "MeditationSession" ADD COLUMN IF NOT EXISTS "breathingPattern" TEXT;
