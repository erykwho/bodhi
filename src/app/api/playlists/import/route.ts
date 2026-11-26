import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS,
  MAX_PLAYLISTS_PER_USER,
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  mergePlaylistTrackAdditions,
  normalizePlaylistDescription,
  normalizePlaylistName,
} from "@/lib/tracks/playlists";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
  serializeTrack,
} from "@/lib/tracks/playlist-server";
import { parseTrackUrl } from "@/lib/tracks/providers";

const importTrackItemSchema = z.object({
  url: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(160),
  author: z.string().trim().max(120).optional().nullable(),
  thumbnailUrl: z.string().trim().max(500).optional().nullable(),
});

const importPlaylistSchema = z
  .object({
    mode: z.enum(["new", "existing"]),
    playlistId: z.string().trim().min(1).optional(),
    name: z.string().trim().max(MAX_PLAYLIST_NAME_LENGTH).optional(),
    description: z
      .string()
      .trim()
      .max(MAX_PLAYLIST_DESCRIPTION_LENGTH)
      .optional()
      .nullable(),
    tracks: z
      .array(importTrackItemSchema)
      .min(1, "Select at least one track to import")
      .max(
        MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS,
        `At most ${MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS} tracks can be imported at once`
      ),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "new" && !normalizePlaylistName(data.name ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Playlist name is required",
        path: ["name"],
      });
    }
    if (data.mode === "existing" && !data.playlistId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose an existing playlist",
        path: ["playlistId"],
      });
    }
  });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = importPlaylistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid import payload" },
        { status: 400 }
      );
    }

    const { mode, playlistId, name, description, tracks: rawTracks } = parsed.data;

    // Validate & canonicalize every imported track URL server-side
    const canonicalTracks: Array<{
      provider: "YOUTUBE" | "SOUNDCLOUD";
      externalId: string;
      url: string;
      title: string;
      author: string | null;
      thumbnailUrl: string | null;
    }> = [];
    const seenExternal = new Set<string>();

    for (const item of rawTracks) {
      const parsedTrack = parseTrackUrl(item.url);
      if (
        !parsedTrack ||
        (parsedTrack.provider !== "YOUTUBE" &&
          parsedTrack.provider !== "SOUNDCLOUD")
      ) {
        continue;
      }
      const dedupeKey = `${parsedTrack.provider}:${parsedTrack.externalId}`;
      if (seenExternal.has(dedupeKey)) continue;
      seenExternal.add(dedupeKey);

      const safeThumb =
        item.thumbnailUrl && /^https?:\/\//i.test(item.thumbnailUrl)
          ? item.thumbnailUrl
          : parsedTrack.defaultThumbnailUrl;

      canonicalTracks.push({
        provider: parsedTrack.provider,
        externalId: parsedTrack.externalId,
        url: parsedTrack.canonicalUrl,
        title: item.title.trim() || parsedTrack.fallbackTitle,
        author: item.author?.trim() || null,
        thumbnailUrl: safeThumb,
      });
    }

    if (canonicalTracks.length === 0) {
      return NextResponse.json(
        { error: "No valid YouTube or SoundCloud tracks found to import" },
        { status: 400 }
      );
    }

    // Verify target playlist or enforce playlist count cap before mutating tracks
    let existingPlaylist: {
      id: string;
      items: Array<{ trackId: string; position: number }>;
    } | null = null;

    if (mode === "existing") {
      existingPlaylist = await prisma.trackPlaylist.findFirst({
        where: { id: playlistId!, userId: user.id },
        select: {
          id: true,
          items: {
            select: { trackId: true, position: true },
            orderBy: [{ position: "asc" }, { addedAt: "asc" }],
          },
        },
      });
      if (!existingPlaylist) {
        return NextResponse.json(
          { error: "Playlist not found" },
          { status: 404 }
        );
      }
    } else {
      const count = await prisma.trackPlaylist.count({
        where: { userId: user.id },
      });
      if (count >= MAX_PLAYLISTS_PER_USER) {
        return NextResponse.json(
          { error: `Maximum of ${MAX_PLAYLISTS_PER_USER} playlists reached` },
          { status: 400 }
        );
      }
    }

    // Upsert each imported track into the user's unified library (preserving existing user edits)
    const lastTrackPosition = await prisma.favoriteTrack.aggregate({
      where: { userId: user.id, isFavorite: false },
      _max: { position: true },
    });
    let nextTrackPos =
      lastTrackPosition._max.position !== null
        ? lastTrackPosition._max.position + 1
        : 0;

    const upsertedTracks = await prisma.$transaction(
      canonicalTracks.map((track) => {
        const positionForCreate = nextTrackPos++;
        return prisma.favoriteTrack.upsert({
          where: {
            userId_provider_externalId: {
              userId: user.id,
              provider: track.provider,
              externalId: track.externalId,
            },
          },
          update: {},
          create: {
            userId: user.id,
            provider: track.provider,
            url: track.url,
            externalId: track.externalId,
            title: track.title,
            author: track.author,
            thumbnailUrl: track.thumbnailUrl,
            tags: [],
            position: positionForCreate,
          },
        });
      })
    );

    const importedTrackIds = upsertedTracks.map((t) => t.id);

    if (mode === "new") {
      const lastPlaylistPosition = await prisma.trackPlaylist.aggregate({
        where: { userId: user.id },
        _max: { position: true },
      });
      const nextPlaylistPos =
        lastPlaylistPosition._max.position !== null
          ? lastPlaylistPosition._max.position + 1
          : 0;

      const created = await prisma.trackPlaylist.create({
        data: {
          userId: user.id,
          name: normalizePlaylistName(name ?? ""),
          description: normalizePlaylistDescription(description),
          position: nextPlaylistPos,
          items: {
            create: importedTrackIds.map((trackId, index) => ({
              trackId,
              position: index,
            })),
          },
        },
        include: PLAYLIST_INCLUDE_ITEMS,
      });

      return NextResponse.json(
        {
          playlist: serializePlaylist(created),
          tracks: upsertedTracks.map(serializeTrack),
          addedCount: importedTrackIds.length,
          skippedDuplicateCount: 0,
          skippedCapCount: 0,
        },
        { status: 201 }
      );
    }

    // mode === "existing"
    const currentTrackIds = existingPlaylist!.items.map((item) => item.trackId);
    const { addedTrackIds, skippedDuplicateCount, skippedCapCount } =
      mergePlaylistTrackAdditions(
        currentTrackIds,
        importedTrackIds,
        MAX_TRACKS_PER_PLAYLIST
      );

    if (addedTrackIds.length > 0) {
      const maxPos = existingPlaylist!.items.reduce(
        (max, item) => Math.max(max, item.position),
        -1
      );
      await prisma.$transaction([
        prisma.playlistTrack.createMany({
          data: addedTrackIds.map((trackId, index) => ({
            playlistId: existingPlaylist!.id,
            trackId,
            position: maxPos + 1 + index,
          })),
          skipDuplicates: true,
        }),
        prisma.trackPlaylist.update({
          where: { id: existingPlaylist!.id },
          data: { updatedAt: new Date() },
        }),
      ]);
    }

    const refreshed = await prisma.trackPlaylist.findFirst({
      where: { id: existingPlaylist!.id, userId: user.id },
      include: PLAYLIST_INCLUDE_ITEMS,
    });

    if (!refreshed) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    return NextResponse.json({
      playlist: serializePlaylist(refreshed),
      tracks: upsertedTracks.map(serializeTrack),
      addedCount: addedTrackIds.length,
      skippedDuplicateCount,
      skippedCapCount,
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/import] POST error:", err);
    return NextResponse.json(
      { error: "Failed to import playlist" },
      { status: 500 }
    );
  }
}
