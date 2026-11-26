import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_TRACKS_PER_PLAYLIST,
  mergePlaylistTrackAdditions,
} from "@/lib/tracks/playlists";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";

const addTracksSchema = z.object({
  trackIds: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one track")
    .max(MAX_TRACKS_PER_PLAYLIST),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = addTracksSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid track IDs" },
        { status: 400 }
      );
    }

    const playlist = await prisma.trackPlaylist.findFirst({
      where: { id, userId: user.id },
      include: {
        items: {
          select: { trackId: true, position: true },
          orderBy: [{ position: "asc" }, { addedAt: "asc" }],
        },
      },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    const requestedIds = Array.from(new Set(parsed.data.trackIds));
    const ownedTracks = await prisma.favoriteTrack.findMany({
      where: { userId: user.id, id: { in: requestedIds } },
      select: { id: true },
    });
    const ownedSet = new Set(ownedTracks.map((t) => t.id));
    const validIncoming = requestedIds.filter((trackId) =>
      ownedSet.has(trackId)
    );

    if (validIncoming.length === 0) {
      return NextResponse.json(
        { error: "No valid tracks found to add" },
        { status: 400 }
      );
    }

    const existingTrackIds = playlist.items.map((item) => item.trackId);
    const { addedTrackIds, skippedDuplicateCount, skippedCapCount } =
      mergePlaylistTrackAdditions(
        existingTrackIds,
        validIncoming,
        MAX_TRACKS_PER_PLAYLIST
      );

    if (addedTrackIds.length > 0) {
      const maxPos = playlist.items.reduce(
        (max, item) => Math.max(max, item.position),
        -1
      );
      await prisma.$transaction([
        prisma.playlistTrack.createMany({
          data: addedTrackIds.map((trackId, index) => ({
            playlistId: playlist.id,
            trackId,
            position: maxPos + 1 + index,
          })),
          skipDuplicates: true,
        }),
        prisma.trackPlaylist.update({
          where: { id: playlist.id },
          data: { updatedAt: new Date() },
        }),
      ]);
    }

    const refreshed = await prisma.trackPlaylist.findFirst({
      where: { id: playlist.id, userId: user.id },
      include: PLAYLIST_INCLUDE_ITEMS,
    });

    if (!refreshed) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    return NextResponse.json({
      playlist: serializePlaylist(refreshed),
      addedCount: addedTrackIds.length,
      skippedDuplicateCount,
      skippedCapCount,
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/:id/tracks] POST error:", err);
    return NextResponse.json(
      { error: "Failed to add tracks to playlist" },
      { status: 500 }
    );
  }
}
