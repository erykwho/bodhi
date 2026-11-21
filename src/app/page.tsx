import { isAuthConfigured } from "@/auth.config";
import { BodhiShell } from "@/components/bodhi-shell";
import { getOptionalSessionUser } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import { prisma } from "@/lib/prisma";
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

  if (user) {
    try {
      const [trackRows, sessionRows] = await Promise.all([
        prisma.favoriteTrack.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.meditationSession.findMany({
          where: { userId: user.id },
          orderBy: { endedAt: "desc" },
          take: 200,
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
      authError={authError}
    />
  );
}
