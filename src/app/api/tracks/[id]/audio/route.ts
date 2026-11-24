import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildGoogleDriveDownloadUrl,
  isAudioStreamProvider,
} from "@/lib/tracks/providers";

const MAX_OFFLINE_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB safety cap
const VALID_RANGE_HEADER_REGEX = /^bytes=(\d+-\d*|-\d+)$/;

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

function parseContentRangeTotalBytes(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match?.[1]) return null;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : null;
}

function createByteLimitedStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let totalBytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        controller.error(new Error("Audio stream exceeded 50 MB limit"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return source.pipeThrough(limiter);
}

/**
 * Authenticated, multi-tenant-scoped audio proxy enabling streaming (with HTTP
 * 206 Range support) and offline download of user-owned DIRECT_AUDIO and
 * GOOGLE_DRIVE tracks even when the upstream host omits CORS headers.
 */
export async function GET(
  request: Request,
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

    if (!isAudioStreamProvider(track.provider)) {
      return NextResponse.json(
        {
          error:
            "Only direct audio and Google Drive tracks can be streamed or saved offline.",
        },
        { status: 400 }
      );
    }

    const upstreamTargetUrl =
      track.provider === "GOOGLE_DRIVE"
        ? buildGoogleDriveDownloadUrl(track.externalId)
        : track.url;

    if (!isSafePublicAudioUrl(upstreamTargetUrl)) {
      return NextResponse.json(
        { error: "Unsupported audio host." },
        { status: 400 }
      );
    }

    const upstreamHeaders: Record<string, string> = {
      Accept: "audio/*,*/*;q=0.8",
    };

    const incomingRange = request.headers.get("range")?.trim() ?? null;
    if (incomingRange && VALID_RANGE_HEADER_REGEX.test(incomingRange)) {
      upstreamHeaders.Range = incomingRange;
    }

    const upstream = await fetch(upstreamTargetUrl, {
      redirect: "follow",
      headers: upstreamHeaders,
    });

    if (upstream.status === 416) {
      void upstream.body?.cancel();
      const rangeHeaders = new Headers({ "Cache-Control": "private, no-store" });
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) {
        rangeHeaders.set("Content-Range", contentRange);
      }
      return new NextResponse(null, { status: 416, headers: rangeHeaders });
    }

    if (!upstream.ok) {
      void upstream.body?.cancel();
      return NextResponse.json(
        { error: "Failed to fetch upstream audio." },
        { status: 502 }
      );
    }

    // Re-check final redirected URL against SSRF rules
    if (upstream.url && !isSafePublicAudioUrl(upstream.url)) {
      void upstream.body?.cancel();
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
        void upstream.body?.cancel();
        return NextResponse.json(
          { error: "Audio file exceeds the 50 MB offline limit." },
          { status: 413 }
        );
      }
    }

    const contentRangeHeader = upstream.headers.get("content-range");
    const totalRangeBytes = parseContentRangeTotalBytes(contentRangeHeader);
    if (totalRangeBytes !== null && totalRangeBytes > MAX_OFFLINE_AUDIO_BYTES) {
      void upstream.body?.cancel();
      return NextResponse.json(
        { error: "Audio file exceeds the 50 MB offline limit." },
        { status: 413 }
      );
    }

    const contentType =
      upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
      "audio/mpeg";
    const isAudioMime =
      contentType.startsWith("audio/") ||
      contentType === "application/octet-stream" ||
      contentType === "application/ogg";
    if (!isAudioMime) {
      void upstream.body?.cancel();
      if (track.provider === "GOOGLE_DRIVE" && contentType.includes("html")) {
        return NextResponse.json(
          {
            error:
              "Google Drive file is not publicly accessible or is not an audio file. Set sharing to 'Anyone with the link'.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "Upstream resource is not an audio file." },
        { status: 415 }
      );
    }

    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    });

    if (contentLengthHeader) {
      responseHeaders.set("Content-Length", contentLengthHeader);
    }
    if (contentRangeHeader) {
      responseHeaders.set("Content-Range", contentRangeHeader);
    }
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) {
      responseHeaders.set("Accept-Ranges", acceptRanges);
    } else if (upstream.status === 206) {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    if (upstream.body) {
      const limitedStream = createByteLimitedStream(
        upstream.body,
        MAX_OFFLINE_AUDIO_BYTES
      );
      return new NextResponse(limitedStream, {
        status: upstream.status === 206 ? 206 : 200,
        headers: responseHeaders,
      });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_OFFLINE_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio file exceeds the 50 MB offline limit." },
        { status: 413 }
      );
    }

    responseHeaders.set("Content-Length", String(arrayBuffer.byteLength));
    return new NextResponse(arrayBuffer, {
      status: upstream.status === 206 ? 206 : 200,
      headers: responseHeaders,
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
