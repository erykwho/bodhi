import type { TrackProviderType } from "@/lib/tracks/types";

export interface ParsedTrackUrl {
  provider: TrackProviderType;
  externalId: string;
  canonicalUrl: string;
  defaultThumbnailUrl: string | null;
  fallbackTitle: string;
}

export const SUGGESTED_TRACK_TAGS = [
  "Morning",
  "Sleep",
  "Breath",
  "Focus",
  "Body Scan",
] as const;

export const MAX_TRACK_TAGS = 5;
export const MAX_TRACK_TAG_LENGTH = 24;

export const TRACK_PROVIDER_LABELS: Record<TrackProviderType, string> = {
  YOUTUBE: "YouTube",
  SOUNDCLOUD: "SoundCloud",
  DIRECT_AUDIO: "Audio",
  GOOGLE_DRIVE: "Google Drive",
};

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const DIRECT_AUDIO_EXT_REGEX = /\.(mp3|m4a|ogg|wav|aac|opus)$/i;
const STRIP_AUDIO_EXT_REGEX = /\.(mp3|m4a|ogg|wav|aac|opus|flac|webm)$/i;
const GOOGLE_DRIVE_FILE_ID_REGEX = /^[A-Za-z0-9_-]{10,128}$/;

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

const GOOGLE_DRIVE_HOSTS = new Set([
  "drive.google.com",
  "www.drive.google.com",
  "drive.usercontent.google.com",
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

/**
 * Returns true for track providers played natively through HTML5 `<audio>`
 * and eligible for local offline caching in `bodhi-user-audio-v1`.
 */
export function isAudioStreamProvider(provider: TrackProviderType): boolean {
  return provider === "DIRECT_AUDIO" || provider === "GOOGLE_DRIVE";
}

/**
 * Builds the direct download endpoint for a publicly shared Google Drive file.
 * Uses `drive.usercontent.google.com` with `confirm=t` to bypass large-file
 * confirmation interstitials when the file is shared as "Anyone with the link".
 */
export function buildGoogleDriveDownloadUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

/**
 * Extracts a clean display title from an HTTP `Content-Disposition` header,
 * prioritizing RFC 5987 UTF-8 `filename*` values before falling back to `filename`.
 */
export function extractFilenameFromContentDisposition(
  headerValue: string | null
): string | null {
  if (!headerValue) return null;

  let rawName: string | null = null;

  const utf8Match = headerValue.match(
    /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i
  );
  if (utf8Match?.[1]) {
    try {
      rawName = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      rawName = utf8Match[1].trim().replace(/^"|"$/g, "");
    }
  }

  if (!rawName) {
    const quotedMatch = headerValue.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch?.[1]) {
      rawName = quotedMatch[1];
    } else {
      const bareMatch = headerValue.match(/filename\s*=\s*([^;]+)/i);
      if (bareMatch?.[1]) {
        rawName = bareMatch[1].trim();
      }
    }
  }

  if (!rawName) return null;

  // Strip any directory separators and known audio file extension
  const baseName = rawName.split(/[\\/]/).pop()?.trim() ?? "";
  const withoutExt = baseName.replace(STRIP_AUDIO_EXT_REGEX, "").trim();
  if (!withoutExt) return null;

  // Only turn underscores/hyphens into spaces when the filename has no spaces
  const readable = withoutExt.includes(" ")
    ? withoutExt
    : withoutExt.replace(/[_-]+/g, " ");

  const normalized = readable.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function extractGoogleDriveFileId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase();
  if (!GOOGLE_DRIVE_HOSTS.has(host)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);

  // Strip optional multi-account (`/u/0/...`) or Google Workspace (`/a/domain.com/...`) prefix
  let normalized = segments;
  if (
    normalized.length >= 2 &&
    (normalized[0] === "u" || normalized[0] === "a")
  ) {
    normalized = normalized.slice(2);
  }

  // Reject folders explicitly
  if (normalized[0] === "drive" && normalized.includes("folders")) {
    return null;
  }

  let candidate: string | null = null;

  // /file/d/<FILE_ID>(/view|/edit|/preview|...)
  if (
    normalized.length >= 3 &&
    normalized[0] === "file" &&
    normalized[1] === "d"
  ) {
    candidate = normalized[2] ?? null;
  } else if (
    normalized.length === 1 &&
    (normalized[0] === "open" ||
      normalized[0] === "uc" ||
      normalized[0] === "download")
  ) {
    candidate = parsed.searchParams.get("id");
  }

  if (!candidate || !GOOGLE_DRIVE_FILE_ID_REGEX.test(candidate)) {
    return null;
  }

  return candidate;
}

function humanizeSlug(slug: string): string {
  try {
    const cleaned = decodeURIComponent(slug)
      .replace(DIRECT_AUDIO_EXT_REGEX, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "Guided Meditation";
    return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return "Guided Meditation";
  }
}

/**
 * Sanitizes and deduplicates an array of track tags (case-insensitive).
 */
export function normalizeTrackTags(rawTags: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTags) {
    const cleaned = raw
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TRACK_TAG_LENGTH);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_TRACK_TAGS) break;
  }

  return result;
}

/**
 * Parses and validates a YouTube, SoundCloud, or direct audio (.mp3/.m4a/.ogg/.wav/.aac/.opus) URL.
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

    // Reject SoundCloud playlists (/artist/sets/playlist) for single-track sessions
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

  // Google Drive shared file links
  const driveFileId = extractGoogleDriveFileId(parsed);
  if (driveFileId) {
    return {
      provider: "GOOGLE_DRIVE",
      externalId: driveFileId,
      canonicalUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
      defaultThumbnailUrl: null,
      fallbackTitle: "Google Drive Audio",
    };
  }

  // Direct Audio URL (.mp3, .m4a, .ogg, .wav, .aac, .opus)
  if (DIRECT_AUDIO_EXT_REGEX.test(parsed.pathname)) {
    const cleanUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const filename = segments[segments.length - 1] ?? "Guided Meditation";

    return {
      provider: "DIRECT_AUDIO",
      externalId: `${parsed.hostname.toLowerCase()}${parsed.pathname}`.slice(
        0,
        360
      ),
      canonicalUrl: cleanUrl,
      defaultThumbnailUrl: null,
      fallbackTitle: humanizeSlug(filename),
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
