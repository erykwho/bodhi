import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; trackId: string }> }
) {
  try {
    const user = await requireUser();
    const { id, trackId } = await context.params;

    const playlist = await prisma.trackPlaylist.findFirst({
      where: { id, userId: user.id },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.playlistTrack.deleteMany({
        where: { playlistId: playlist.id, trackId },
      }),
      prisma.trackPlaylist.update({
        where: { id: playlist.id },
        data: { updatedAt: new Date() },
      }),
    ]);

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
    console.error("[api/playlists/:id/tracks/:trackId] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to remove track from playlist" },
      { status: 500 }
    );
  }
}
