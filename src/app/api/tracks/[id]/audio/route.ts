import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_OFFLINE_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB safety cap

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) {
    return false;
  }
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => n < 0 || n > 255)) return true;

  const [a, b] = nums;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Validates that an audio download URL is a public HTTP(S) URL and not a
 * private/loopback/metadata target (SSRF protection).
 */
export function isSafePublicAudioUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host)) return false;
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return false;
  }
  // Reject IPv6 literals or private IPv4 ranges
  if (host.includes(":") || host.startsWith("[") || isPrivateIpv4(host)) {
    return false;
  }

  return true;
}

/**
 * Authenticated, multi-tenant-scoped audio proxy enabling offline download of
 * user-owned DIRECT_AUDIO tracks even when the upstream host omits CORS headers.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const track = await prisma.favoriteTrack.findFirst({
      where: { id, userId: user.id },
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found." }, { status: 404 });
    }

    if (track.provider !== "DIRECT_AUDIO") {
      return NextResponse.json(
        { error: "Only direct audio tracks can be saved offline." },
        { status: 400 }
      );
    }

    if (!isSafePublicAudioUrl(track.url)) {
      return NextResponse.json(
        { error: "Unsupported audio host." },
        { status: 400 }
      );
    }

    const upstream = await fetch(track.url, {
      redirect: "follow",
      headers: {
        Accept: "audio/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Failed to fetch upstream audio." },
        { status: 502 }
      );
    }

    // Re-check final redirected URL against SSRF rules
    if (upstream.url && !isSafePublicAudioUrl(upstream.url)) {
      return NextResponse.json(
        { error: "Unsupported audio redirect target." },
        { status: 400 }
      );
    }

    const contentLengthHeader = upstream.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredBytes = Number.parseInt(contentLengthHeader, 10);
      if (
        Number.isFinite(declaredBytes) &&
        declaredBytes > MAX_OFFLINE_AUDIO_BYTES
      ) {
        return NextResponse.json(
          { error: "Audio file exceeds the 50 MB offline limit." },
          { status: 413 }
        );
      }
    }

    const contentType =
      upstream.headers.get("content-type")?.split(";")[0]?.trim() ||
      "audio/mpeg";
    const isAudioMime =
      contentType.startsWith("audio/") ||
      contentType === "application/octet-stream" ||
      contentType === "application/ogg";
    if (!isAudioMime) {
      return NextResponse.json(
        { error: "Upstream resource is not an audio file." },
        { status: 415 }
      );
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_OFFLINE_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio file exceeds the 50 MB offline limit." },
        { status: 413 }
      );
    }

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(arrayBuffer.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error("[GET /api/tracks/[id]/audio]", error);
    return NextResponse.json(
      { error: "Failed to download guided audio." },
      { status: 500 }
    );
  }
}
