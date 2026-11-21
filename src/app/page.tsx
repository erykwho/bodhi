import { isAuthConfigured } from "@/auth.config";
import { BodhiShell } from "@/components/bodhi-shell";
import { getOptionalSessionUser } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import { prisma } from "@/lib/prisma";
import { parseTimerPreferences } from "@/lib/timer/preferences";
import { MAX_TIMER_PRESETS, type TimerPresetItem } from "@/lib/timer/presets";
import type { FavoriteTrackItem } from "@/lib/tracks/types";

export const dynamic = "force-dynamic";

export default async function HomePage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const authError =
    typeof searchParams.error === "string" ? searchParams.error : null;

  const authConfigured = isAuthConfigured();
  const user = await getOptionalSessionUser();

  let initialTracks: FavoriteTrackItem[] = [];
  let initialSessions: MeditationSessionItem[] = [];
  let initialPresets: TimerPresetItem[] = [];

  if (user) {
    try {
      const [trackRows, sessionRows, presetRows] = await Promise.all([
        prisma.favoriteTrack.findMany({
          where: { userId: user.id },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }],
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

      initialTracks = trackRows.map((track) => ({
        id: track.id,
        provider: track.provider,
        url: track.url,
        externalId: track.externalId,
        title: track.title,
        author: track.author,
        thumbnailUrl: track.thumbnailUrl,
        tags: track.tags,
        createdAt: track.createdAt.toISOString(),
      }));

      initialSessions = sessionRows.map((session) => ({
        id: session.id,
        mode: session.mode,
        trackId: session.trackId,
        trackTitle: session.trackTitle,
        trackProvider: session.trackProvider,
        plannedDurationSec: session.plannedDurationSec,
        actualDurationSec: session.actualDurationSec,
        completed: session.completed,
        note: session.note,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt.toISOString(),
      }));

      initialPresets = presetRows.map((preset) => ({
        id: preset.id,
        name: preset.name,
        preferences: parseTimerPreferences(preset.config),
        createdAt: preset.createdAt.toISOString(),
      }));
    } catch (err) {
      console.error("[HomePage] Failed to load user data:", err);
    }
  }

  return (
    <BodhiShell
      user={user}
      authConfigured={authConfigured}
      initialTracks={initialTracks}
      initialSessions={initialSessions}
      initialPresets={initialPresets}
      authError={authError}
    />
  );
}
