-- AlterTable
ALTER TABLE "FavoriteTrack" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FavoriteTrack_userId_isFavorite_position_createdAt_idx" ON "FavoriteTrack"("userId", "isFavorite", "position", "createdAt");
