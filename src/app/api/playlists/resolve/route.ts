import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { resolveExternalPlaylist } from "@/lib/tracks/playlist-resolver";
import {
  MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS,
  parsePlaylistUrl,
} from "@/lib/tracks/playlists";

const resolvePlaylistSchema = z.object({
  url: z.string().trim().min(1, "Playlist URL is required").max(500),
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const body = await request.json();
    const parsed = resolvePlaylistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid URL" },
        { status: 400 }
      );
    }

    const parsedUrl = parsePlaylistUrl(parsed.data.url);
    if (!parsedUrl) {
      return NextResponse.json(
        {
          error:
            "Unsupported playlist URL. Paste a public YouTube playlist or SoundCloud set link.",
        },
        { status: 400 }
      );
    }

    const playlist = await resolveExternalPlaylist(
      parsedUrl.canonicalUrl,
      MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS
    );
    if (!playlist || playlist.tracks.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not load playable tracks from this playlist. Make sure the playlist is public.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ playlist });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/resolve] POST error:", err);
    return NextResponse.json(
      { error: "Failed to resolve external playlist" },
      { status: 500 }
    );
  }
}
