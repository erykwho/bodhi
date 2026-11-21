import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { resolveTrackMetadata } from "@/lib/tracks/oembed";

const resolveSchema = z.object({
  url: z.string().trim().min(1, "Track URL is required").max(500),
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const body = await request.json();
    const parsed = resolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid URL" },
        { status: 400 }
      );
    }

    const metadata = await resolveTrackMetadata(parsed.data.url);
    if (!metadata) {
      return NextResponse.json(
        {
          error:
            "Unsupported URL. Paste a valid YouTube, SoundCloud, or direct audio (.mp3/.m4a) link.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ metadata });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks/resolve] POST error:", err);
    return NextResponse.json(
      { error: "Failed to resolve track metadata" },
      { status: 500 }
    );
  }
}
