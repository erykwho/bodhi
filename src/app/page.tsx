import { isAuthConfigured } from "@/auth.config";
import { BodhiShell } from "@/components/bodhi-shell";
import { getOptionalSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { FavoriteTrackItem } from "@/lib/tracks/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authConfigured = isAuthConfigured();
  const user = await getOptionalSessionUser();

  let initialTracks: FavoriteTrackItem[] = [];
  if (user) {
    try {
      const rows = await prisma.favoriteTrack.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      initialTracks = rows.map((track) => ({
        id: track.id,
        provider: track.provider,
        url: track.url,
        externalId: track.externalId,
        title: track.title,
        author: track.author,
        thumbnailUrl: track.thumbnailUrl,
        createdAt: track.createdAt.toISOString(),
      }));
    } catch (err) {
      console.error("[HomePage] Failed to load favorite tracks:", err);
    }
  }

  return (
    <BodhiShell
      user={user}
      authConfigured={authConfigured}
      initialTracks={initialTracks}
    />
  );
}
