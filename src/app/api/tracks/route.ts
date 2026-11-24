import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveTrackMetadata } from "@/lib/tracks/oembed";
import { normalizeTrackTags, parseTrackUrl } from "@/lib/tracks/providers";

const createTrackSchema = z.object({
  url: z.string().trim().min(1, "Track URL is required").max(500),
  title: z.string().trim().max(160).optional(),
  author: z.string().trim().max(120).optional().nullable(),
  thumbnailUrl: z.string().trim().max(500).optional().nullable(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const tracks = await prisma.favoriteTrack.findMany({
      where: { userId: user.id },
      orderBy: [
        { isFavorite: "desc" },
        { position: "asc" },
        { createdAt: "desc" },
      ],
    });

    return NextResponse.json({
      tracks: tracks.map((track) => ({
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
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load favorite tracks" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsedBody = createTrackSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    const { url, title, author, thumbnailUrl, tags } = parsedBody.data;
    const parsedUrl = parseTrackUrl(url);
    if (!parsedUrl) {
      return NextResponse.json(
        {
          error:
            "Unsupported URL. Paste a valid YouTube, SoundCloud, or direct audio (.mp3/.m4a) link.",
        },
        { status: 400 }
      );
    }

    // Resolve metadata when title or thumbnail was not provided by the client
    const resolved =
      !title || thumbnailUrl === undefined
        ? await resolveTrackMetadata(parsedUrl.canonicalUrl)
        : null;

    const finalTitle =
      title?.trim() || resolved?.title || parsedUrl.fallbackTitle;
    const finalAuthor =
      author !== undefined ? author : (resolved?.author ?? null);
    const finalThumbnail =
      thumbnailUrl !== undefined
        ? thumbnailUrl
        : (resolved?.thumbnailUrl ?? parsedUrl.defaultThumbnailUrl);
    const normalizedTags = normalizeTrackTags(tags ?? []);

    const lastPosition = await prisma.favoriteTrack.aggregate({
      where: { userId: user.id, isFavorite: false },
      _max: { position: true },
    });
    const nextPosition =
      lastPosition._max.position !== null ? lastPosition._max.position + 1 : 0;

    const saved = await prisma.favoriteTrack.upsert({
      where: {
        userId_provider_externalId: {
          userId: user.id,
          provider: parsedUrl.provider,
          externalId: parsedUrl.externalId,
        },
      },
      update: {
        url: parsedUrl.canonicalUrl,
        title: finalTitle,
        author: finalAuthor,
        thumbnailUrl: finalThumbnail,
        ...(tags !== undefined ? { tags: normalizedTags } : {}),
      },
      create: {
        userId: user.id,
        provider: parsedUrl.provider,
        url: parsedUrl.canonicalUrl,
        externalId: parsedUrl.externalId,
        title: finalTitle,
        author: finalAuthor,
        thumbnailUrl: finalThumbnail,
        tags: normalizedTags,
        position: nextPosition,
      },
    });

    return NextResponse.json(
      {
        track: {
          id: saved.id,
          provider: saved.provider,
          url: saved.url,
          externalId: saved.externalId,
          title: saved.title,
          author: saved.author,
          thumbnailUrl: saved.thumbnailUrl,
          tags: saved.tags,
          isFavorite: saved.isFavorite,
          createdAt: saved.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save favorite track" },
      { status: 500 }
    );
  }
}
