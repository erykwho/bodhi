export type YouTubePlayerErrorKind =
  | "embed_disabled"
  | "video_unavailable"
  | "config_error"
  | "playback_error";

/**
 * Classifies official YouTube IFrame Player API `onError` numeric codes.
 * - 101 / 150: Video owner disabled playback in embedded players.
 * - 100: Video not found, removed, or marked private.
 * - 153: Video player configuration error (missing/blocked Referer or origin).
 * - 2 / 5 / others: Invalid parameter or HTML5 playback error.
 */
export function classifyYouTubePlayerError(
  errorCode: number
): YouTubePlayerErrorKind {
  if (errorCode === 101 || errorCode === 150) {
    return "embed_disabled";
  }
  if (errorCode === 100) {
    return "video_unavailable";
  }
  if (errorCode === 153) {
    return "config_error";
  }
  return "playback_error";
}

/**
 * Returns whether the given YouTube error kind supports retrying the embedded player.
 */
export function isRetryableYouTubeError(
  kind: YouTubePlayerErrorKind
): boolean {
  return kind === "config_error" || kind === "playback_error";
}

/**
 * Returns whether the given YouTube error kind should offer the External Companion
 * fallback ("Open on YouTube & track session").
 */
export function supportsExternalYouTubeCompanion(
  kind: YouTubePlayerErrorKind
): boolean {
  return kind !== "video_unavailable";
}

/**
 * Builds YouTube IFrame Player `playerVars`, including a validated HTTP(S)
 * `origin` whenever available to prevent false-positive Error 153 blocks.
 */
export function buildYouTubePlayerVars(
  origin?: string | null
): Record<string, string | number> {
  const vars: Record<string, string | number> = {
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
    enablejsapi: 1,
  };

  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        vars.origin = parsed.origin;
      }
    } catch {
      // Ignore malformed origin strings
    }
  }

  return vars;
}
