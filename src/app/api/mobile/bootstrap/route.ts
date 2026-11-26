import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTimerPreferences } from "@/lib/timer/preferences";
import { MAX_TIMER_PRESETS } from "@/lib/timer/presets";

import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";

export async function GET() {
  try {
    const user = await requireUser();

    const [trackRows, playlistRows, sessionRows, presetRows] =
      await Promise.all([
        prisma.favoriteTrack.findMany({
          where: { userId: user.id },
          orderBy: [
            { isFavorite: "desc" },
            { position: "asc" },
            { createdAt: "desc" },
          ],
        }),
        prisma.trackPlaylist.findMany({
          where: { userId: user.id },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }],
          include: PLAYLIST_INCLUDE_ITEMS,
        }),
        prisma.meditationSession.findMany({
          where: { userId: user.id },
          orderBy: { endedAt: "desc" },
          take: 200,
        }),
        prisma.timerPreset.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          take: MAX_TIMER_PRESETS,
        }),
      ]);

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
        tracks: trackRows.map((track) => ({
          id: track.id,
          provider: track.provider,
          url: track.url,
          externalId: track.externalId,
          title: track.title,
          author: track.author,
          thumbnailUrl: track.thumbnailUrl,
          tags: track.tags,
          isFavorite: track.isFavorite,
          createdAt: track.createdAt.toISOString(),
        })),
        playlists: playlistRows.map(serializePlaylist),
        sessions: sessionRows.map((session) => ({
          id: session.id,
          mode: session.mode,
          trackId: session.trackId,
          trackTitle: session.trackTitle,
          trackProvider: session.trackProvider,
          breathingPattern: session.breathingPattern ?? null,
          plannedDurationSec: session.plannedDurationSec,
          actualDurationSec: session.actualDurationSec,
          completed: session.completed,
          note: session.note,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt.toISOString(),
        })),
        presets: presetRows.map((preset) => ({
          id: preset.id,
          name: preset.name,
          preferences: parseTimerPreferences(preset.config),
          createdAt: preset.createdAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/mobile/bootstrap] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load user workspace" },
      { status: 500 }
    );
  }
}
