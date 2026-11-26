import { isAudioStreamProvider } from "./providers";
import type {
  ExternalPlaylistProviderType,
  FavoriteTrackItem,
  TrackPlaylistItem,
} from "./types";

export const MAX_PLAYLISTS_PER_USER = 50;
export const MAX_TRACKS_PER_PLAYLIST = 100;
export const MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS = 50;
export const MAX_PLAYLIST_NAME_LENGTH = 80;
export const MAX_PLAYLIST_DESCRIPTION_LENGTH = 240;

export const GUIDED_AUTO_ADVANCE_STORAGE_KEY = "bodhi.guided.auto-advance.v1";

export interface ParsedPlaylistUrl {
  provider: ExternalPlaylistProviderType;
  externalId: string;
  canonicalUrl: string;
  /**
   * True when the URL explicitly targets a playlist or set (e.g.
   * `youtube.com/playlist?list=...` or `soundcloud.com/artist/sets/...`),
   * false when a playlist parameter is embedded inside a single-video URL.
   */
  isDirectPlaylistUrl: boolean;
}

const YOUTUBE_PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]{10,128}$/;
const SOUNDCLOUD_SECRET_TOKEN_REGEX = /^s-[A-Za-z0-9_-]{4,64}$/;

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

function isUnsupportedYouTubeListId(listId: string): boolean {
  const upper = listId.toUpperCase();
  // Exclude auto-generated ephemeral mixes (RD...) and private account lists (WL, LL, LM)
  return (
    upper.startsWith("RD") ||
    upper === "WL" ||
    upper === "LL" ||
    upper === "LM"
  );
}

/**
 * Parses and validates a YouTube playlist URL or SoundCloud set URL.
 * Also recognizes persistent playlist IDs attached to YouTube watch links
 * (`isDirectPlaylistUrl: false`) so callers can offer an optional import prompt.
 */
export function parsePlaylistUrl(rawInput: string): ParsedPlaylistUrl | null {
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

  if (YOUTUBE_HOSTS.has(host)) {
    const listId = parsed.searchParams.get("list")?.trim() ?? null;
    if (
      !listId ||
      !YOUTUBE_PLAYLIST_ID_REGEX.test(listId) ||
      isUnsupportedYouTubeListId(listId)
    ) {
      return null;
    }

    const isDirectPlaylistUrl = parsed.pathname === "/playlist";
    return {
      provider: "YOUTUBE",
      externalId: listId,
      canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
      isDirectPlaylistUrl,
    };
  }

  if (SOUNDCLOUD_HOSTS.has(host)) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) {
      return null;
    }

    const artist = segments[0].toLowerCase();
    if (
      SOUNDCLOUD_RESERVED_SEGMENTS.has(artist) ||
      segments[1].toLowerCase() !== "sets"
    ) {
      return null;
    }

    const slug = segments[2];
    if (!slug) return null;

    const secretToken =
      segments.length >= 4 && SOUNDCLOUD_SECRET_TOKEN_REGEX.test(segments[3])
        ? segments[3]
        : null;

    const externalId = secretToken
      ? `${segments[0]}/sets/${slug}/${secretToken}`
      : `${segments[0]}/sets/${slug}`;

    return {
      provider: "SOUNDCLOUD",
      externalId,
      canonicalUrl: `https://soundcloud.com/${externalId}`,
      isDirectPlaylistUrl: true,
    };
  }

  return null;
}

export function normalizePlaylistName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_PLAYLIST_NAME_LENGTH);
}

export function normalizePlaylistDescription(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAYLIST_DESCRIPTION_LENGTH);
  return cleaned || null;
}

/**
 * Resolves a playlist's ordered track items against the user's track library,
 * strictly preserving the playlist's custom sequence.
 */
export function resolvePlaylistTracks(
  playlist: Pick<TrackPlaylistItem, "trackIds">,
  allTracks: readonly FavoriteTrackItem[]
): FavoriteTrackItem[] {
  if (playlist.trackIds.length === 0 || allTracks.length === 0) {
    return [];
  }

  const byId = new Map<string, FavoriteTrackItem>();
  for (const track of allTracks) {
    byId.set(track.id, track);
  }

  const resolved: FavoriteTrackItem[] = [];
  const seen = new Set<string>();
  for (const trackId of playlist.trackIds) {
    if (seen.has(trackId)) continue;
    const track = byId.get(trackId);
    if (track) {
      seen.add(trackId);
      resolved.push(track);
    }
  }

  return resolved;
}

function hasSavedAudio(
  trackId: string,
  savedAudio: ReadonlySet<string> | Record<string, unknown>
): boolean {
  if (savedAudio instanceof Set) {
    return savedAudio.has(trackId);
  }
  return Boolean((savedAudio as Record<string, unknown>)[trackId]);
}

/**
 * Returns only tracks in the playlist that are audio-stream providers AND
 * currently saved locally for offline Airplane Mode playback, preserving order.
 */
export function filterOfflinePlayablePlaylistTracks(
  playlist: Pick<TrackPlaylistItem, "trackIds">,
  allTracks: readonly FavoriteTrackItem[],
  savedAudio: ReadonlySet<string> | Record<string, unknown>
): FavoriteTrackItem[] {
  return resolvePlaylistTracks(playlist, allTracks).filter(
    (track) =>
      isAudioStreamProvider(track.provider) &&
      hasSavedAudio(track.id, savedAudio)
  );
}

/**
 * Returns audio-stream tracks in a playlist that can be downloaded offline
 * and have not yet been cached locally.
 */
export function getEligibleOfflineDownloadTracks(
  playlist: Pick<TrackPlaylistItem, "trackIds">,
  allTracks: readonly FavoriteTrackItem[],
  savedAudio: ReadonlySet<string> | Record<string, unknown>
): FavoriteTrackItem[] {
  return resolvePlaylistTracks(playlist, allTracks).filter(
    (track) =>
      isAudioStreamProvider(track.provider) &&
      !hasSavedAudio(track.id, savedAudio)
  );
}

/**
 * Picks the first available thumbnail from a playlist's ordered tracks.
 */
export function getPlaylistCoverThumbnail(
  playlist: Pick<TrackPlaylistItem, "trackIds">,
  allTracks: readonly FavoriteTrackItem[]
): string | null {
  const tracks = resolvePlaylistTracks(playlist, allTracks);
  for (const track of tracks) {
    if (track.thumbnailUrl) {
      return track.thumbnailUrl;
    }
  }
  return null;
}

/**
 * Merges incoming track IDs into an existing playlist while deduplicating
 * and enforcing the maximum tracks-per-playlist cap.
 */
export function mergePlaylistTrackAdditions(
  existingTrackIds: readonly string[],
  incomingTrackIds: readonly string[],
  maxTracks = MAX_TRACKS_PER_PLAYLIST
): {
  nextTrackIds: string[];
  addedTrackIds: string[];
  skippedDuplicateCount: number;
  skippedCapCount: number;
} {
  const seen = new Set<string>(existingTrackIds);
  const nextTrackIds = [...existingTrackIds];
  const addedTrackIds: string[] = [];
  let skippedDuplicateCount = 0;
  let skippedCapCount = 0;

  for (const id of incomingTrackIds) {
    if (!id) continue;
    if (seen.has(id)) {
      skippedDuplicateCount += 1;
      continue;
    }
    if (nextTrackIds.length >= maxTracks) {
      skippedCapCount += 1;
      continue;
    }
    seen.add(id);
    nextTrackIds.push(id);
    addedTrackIds.push(id);
  }

  return {
    nextTrackIds,
    addedTrackIds,
    skippedDuplicateCount,
    skippedCapCount,
  };
}

/**
 * Removes a deleted library track from all cached/in-memory playlists.
 */
export function removeTrackFromPlaylists(
  playlists: readonly TrackPlaylistItem[],
  trackId: string
): TrackPlaylistItem[] {
  return playlists.map((playlist) =>
    playlist.trackIds.includes(trackId)
      ? {
          ...playlist,
          trackIds: playlist.trackIds.filter((id) => id !== trackId),
        }
      : playlist
  );
}

/**
 * Safely parses persisted guided playlist auto-advance preference (defaults to false).
 */
export function parseGuidedAutoAdvancePreference(raw: unknown): boolean {
  if (raw === true || raw === "true") return true;
  return false;
}

/**
 * Defensively parses cached playlists from local storage (backward-compatible).
 */
export function parseCachedPlaylists(raw: unknown): TrackPlaylistItem[] {
  if (!Array.isArray(raw)) return [];
  const result: TrackPlaylistItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<TrackPlaylistItem>;
    if (typeof item.id !== "string" || typeof item.name !== "string") continue;
    const trackIds = Array.isArray(item.trackIds)
      ? Array.from(
          new Set(
            item.trackIds.filter(
              (id): id is string => typeof id === "string" && id.length > 0
            )
          )
        )
      : [];
    result.push({
      id: item.id,
      name: item.name,
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description
          : null,
      trackIds,
      createdAt:
        typeof item.createdAt === "string"
          ? item.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof item.updatedAt === "string"
          ? item.updatedAt
          : typeof item.createdAt === "string"
            ? item.createdAt
            : new Date(0).toISOString(),
    });
  }
  return result;
}
