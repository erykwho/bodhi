import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_TRACKS_PER_PLAYLIST } from "@/lib/tracks/playlists";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";
import { mergeTrackOrder } from "@/lib/tracks/reorder";

const reorderPlaylistSchema = z.object({
  orderedTrackIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one track ID is required")
    .max(MAX_TRACKS_PER_PLAYLIST),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = reorderPlaylistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid track order" },
        { status: 400 }
      );
    }

    const playlist = await prisma.trackPlaylist.findFirst({
      where: { id, userId: user.id },
      include: {
        items: {
          select: { id: true, trackId: true },
          orderBy: [{ position: "asc" }, { addedAt: "asc" }],
        },
      },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    const existingTrackIds = playlist.items.map((item) => item.trackId);
    const mergedTrackIds = mergeTrackOrder(
      parsed.data.orderedTrackIds,
      existingTrackIds
    );
    const itemIdByTrackId = new Map(
      playlist.items.map((item) => [item.trackId, item.id])
    );

    if (mergedTrackIds.length > 0) {
      await prisma.$transaction([
        ...mergedTrackIds.map((trackId, index) =>
          prisma.playlistTrack.update({
            where: { id: itemIdByTrackId.get(trackId)! },
            data: { position: index },
          })
        ),
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

    return NextResponse.json({ playlist: serializePlaylist(refreshed) });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/:id/reorder] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to save playlist order" },
      { status: 500 }
    );
  }
}
