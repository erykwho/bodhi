-- Expand-only zero-downtime migration for guided meditation playlists (TrackPlaylist + PlaylistTrack)

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackPlaylist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlaylistTrack" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackPlaylist_userId_position_createdAt_idx" ON "TrackPlaylist"("userId", "position", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_trackId_key" ON "PlaylistTrack"("playlistId", "trackId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_position_addedAt_idx" ON "PlaylistTrack"("playlistId", "position", "addedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaylistTrack_trackId_idx" ON "PlaylistTrack"("trackId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TrackPlaylist_userId_fkey'
    ) THEN
        ALTER TABLE "TrackPlaylist"
        ADD CONSTRAINT "TrackPlaylist_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistTrack_playlistId_fkey'
    ) THEN
        ALTER TABLE "PlaylistTrack"
        ADD CONSTRAINT "PlaylistTrack_playlistId_fkey"
        FOREIGN KEY ("playlistId") REFERENCES "TrackPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistTrack_trackId_fkey'
    ) THEN
        ALTER TABLE "PlaylistTrack"
        ADD CONSTRAINT "PlaylistTrack_trackId_fkey"
        FOREIGN KEY ("trackId") REFERENCES "FavoriteTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
