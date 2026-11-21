import type { TrackProviderType } from "@/lib/tracks/types";

export interface ParsedTrackUrl {
  provider: TrackProviderType;
  externalId: string;
  canonicalUrl: string;
  defaultThumbnailUrl: string | null;
  fallbackTitle: string;
}

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const SOUNDCLOUD_HOSTS = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
]);

const SOUNDCLOUD_RESERVED_SEGMENTS = new Set([
  "discover",
  "stream",
  "search",
  "charts",
  "upload",
  "you",
  "settings",
  "stations",
  "popular",
  "messages",
  "notifications",
]);

function humanizeSlug(slug: string): string {
  const cleaned = decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Guided Meditation";
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Parses and validates a YouTube or SoundCloud track URL.
 * Returns null if the URL is invalid or from an unsupported provider.
 */
export function parseTrackUrl(rawInput: string): ParsedTrackUrl | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  // YouTube
  if (YOUTUBE_HOSTS.has(host)) {
    let videoId: string | null = null;
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (host === "youtu.be" || host === "www.youtu.be") {
      videoId = segments[0] ?? null;
    } else if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if (
      segments.length >= 2 &&
      (segments[0] === "embed" ||
        segments[0] === "shorts" ||
        segments[0] === "live")
    ) {
      videoId = segments[1] ?? null;
    }

    if (!videoId || !YOUTUBE_ID_REGEX.test(videoId)) {
      return null;
    }

    return {
      provider: "YOUTUBE",
      externalId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      defaultThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      fallbackTitle: "YouTube Meditation",
    };
  }

  // SoundCloud
  if (SOUNDCLOUD_HOSTS.has(host)) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const artist = segments[0].toLowerCase();
    if (SOUNDCLOUD_RESERVED_SEGMENTS.has(artist)) {
      return null;
    }

    // Reject SoundCloud playlists (/artist/sets/playlist) for V2 single-track sessions
    if (segments[1].toLowerCase() === "sets") {
      return null;
    }

    const trackSlug = segments[1];
    const externalId = `${segments[0]}/${trackSlug}`;
    const canonicalUrl = `https://soundcloud.com/${externalId}`;

    return {
      provider: "SOUNDCLOUD",
      externalId,
      canonicalUrl,
      defaultThumbnailUrl: null,
      fallbackTitle: humanizeSlug(trackSlug),
    };
  }

  return null;
}

/**
 * Builds the official SoundCloud Widget iframe embed URL for a track.
 */
export function buildSoundCloudEmbedUrl(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    color: "#4A6B5D",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
    visual: "true",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}
