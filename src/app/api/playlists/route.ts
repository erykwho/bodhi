import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_PLAYLISTS_PER_USER,
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  normalizePlaylistDescription,
  normalizePlaylistName,
} from "@/lib/tracks/playlists";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";

const createPlaylistSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Playlist name is required")
    .max(MAX_PLAYLIST_NAME_LENGTH),
  description: z
    .string()
    .trim()
    .max(MAX_PLAYLIST_DESCRIPTION_LENGTH)
    .optional()
    .nullable(),
  trackIds: z
    .array(z.string().trim().min(1))
    .max(MAX_TRACKS_PER_PLAYLIST)
    .optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const playlists = await prisma.trackPlaylist.findMany({
      where: { userId: user.id },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      include: PLAYLIST_INCLUDE_ITEMS,
    });

    return NextResponse.json({
      playlists: playlists.map(serializePlaylist),
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load playlists" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createPlaylistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid playlist payload" },
        { status: 400 }
      );
    }

    const name = normalizePlaylistName(parsed.data.name);
    if (!name) {
      return NextResponse.json(
        { error: "Playlist name is required" },
        { status: 400 }
      );
    }

    const existingCount = await prisma.trackPlaylist.count({
      where: { userId: user.id },
    });
    if (existingCount >= MAX_PLAYLISTS_PER_USER) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_PLAYLISTS_PER_USER} playlists reached` },
        { status: 400 }
      );
    }

    const description = normalizePlaylistDescription(parsed.data.description);
    const requestedTrackIds = Array.from(
      new Set(parsed.data.trackIds ?? [])
    ).slice(0, MAX_TRACKS_PER_PLAYLIST);

    // Strictly validate that every referenced trackId belongs to this user
    let validTrackIds: string[] = [];
    if (requestedTrackIds.length > 0) {
      const ownedTracks = await prisma.favoriteTrack.findMany({
        where: { userId: user.id, id: { in: requestedTrackIds } },
        select: { id: true },
      });
      const ownedSet = new Set(ownedTracks.map((t) => t.id));
      validTrackIds = requestedTrackIds.filter((id) => ownedSet.has(id));
    }

    const lastPosition = await prisma.trackPlaylist.aggregate({
      where: { userId: user.id },
      _max: { position: true },
    });
    const nextPosition =
      lastPosition._max.position !== null ? lastPosition._max.position + 1 : 0;

    const created = await prisma.trackPlaylist.create({
      data: {
        userId: user.id,
        name,
        description,
        position: nextPosition,
        ...(validTrackIds.length > 0
          ? {
              items: {
                create: validTrackIds.map((trackId, index) => ({
                  trackId,
                  position: index,
                })),
              },
            }
          : {}),
      },
      include: PLAYLIST_INCLUDE_ITEMS,
    });

    return NextResponse.json(
      { playlist: serializePlaylist(created) },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists] POST error:", err);
    return NextResponse.json(
      { error: "Failed to create playlist" },
      { status: 500 }
    );
  }
}
