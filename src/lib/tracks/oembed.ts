import {
  buildGoogleDriveDownloadUrl,
  extractFilenameFromContentDisposition,
  parseTrackUrl,
} from "@/lib/tracks/providers";
import type { ResolvedTrackMetadata } from "@/lib/tracks/types";

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/**
 * Resolves track metadata via official YouTube / SoundCloud oEmbed endpoints,
 * lightweight Content-Disposition inspection for Google Drive shared files,
 * or parsed filename metadata directly for DIRECT_AUDIO URLs.
 */
export async function resolveTrackMetadata(
  rawUrl: string
): Promise<ResolvedTrackMetadata | null> {
  const parsed = parseTrackUrl(rawUrl);
  if (!parsed) return null;

  if (parsed.provider === "DIRECT_AUDIO") {
    let hostAuthor: string | null = null;
    try {
      hostAuthor = new URL(parsed.canonicalUrl).hostname.replace(/^www\./, "");
    } catch {
      hostAuthor = null;
    }

    return {
      provider: parsed.provider,
      url: parsed.canonicalUrl,
      externalId: parsed.externalId,
      title: parsed.fallbackTitle,
      author: hostAuthor,
      thumbnailUrl: null,
    };
  }

  if (parsed.provider === "GOOGLE_DRIVE") {
    let resolvedTitle = parsed.fallbackTitle;
    try {
      const response = await fetch(
        buildGoogleDriveDownloadUrl(parsed.externalId),
        {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(5000),
          headers: {
            Range: "bytes=0-0",
            Accept: "audio/*,*/*;q=0.8",
          },
        }
      );

      // Cancel the body immediately so metadata lookup never downloads the full audio
      void response.body?.cancel();

      if (response.ok) {
        const extracted = extractFilenameFromContentDisposition(
          response.headers.get("content-disposition")
        );
        if (extracted) {
          resolvedTitle = extracted;
        }
      }
    } catch {
      // Fall back to default Google Drive title when upstream times out or is unreachable
    }

    return {
      provider: parsed.provider,
      url: parsed.canonicalUrl,
      externalId: parsed.externalId,
      title: resolvedTitle,
      author: "Google Drive",
      thumbnailUrl: null,
    };
  }

  const oembedEndpoint =
    parsed.provider === "YOUTUBE"
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`
      : `https://soundcloud.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`;

  try {
    const response = await fetch(oembedEndpoint, {
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });

    if (response.ok) {
      const data = (await response.json()) as OEmbedResponse;
      return {
        provider: parsed.provider,
        url: parsed.canonicalUrl,
        externalId: parsed.externalId,
        title: data.title?.trim() || parsed.fallbackTitle,
        author: data.author_name?.trim() || null,
        thumbnailUrl:
          data.thumbnail_url?.trim() || parsed.defaultThumbnailUrl || null,
      };
    }
  } catch {
    // Fall back to canonical URL defaults when oEmbed fails or times out
  }

  return {
    provider: parsed.provider,
    url: parsed.canonicalUrl,
    externalId: parsed.externalId,
    title: parsed.fallbackTitle,
    author: null,
    thumbnailUrl: parsed.defaultThumbnailUrl,
  };
}
