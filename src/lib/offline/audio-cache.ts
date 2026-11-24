import { isAudioStreamProvider } from "@/lib/tracks/providers";
import type { FavoriteTrackItem } from "@/lib/tracks/types";

export const OFFLINE_GUIDED_AUDIO_CACHE_NAME = "bodhi-user-audio-v1";
export const OFFLINE_GUIDED_STORAGE_KEY = "bodhi.offline.guided-tracks.v1";

export interface SavedOfflineAudioMeta {
  bytes: number;
  contentType: string;
  savedAt: string;
}

export interface OfflineGuidedSnapshot {
  tracks: FavoriteTrackItem[];
  savedAudio: Record<string, SavedOfflineAudioMeta>;
}

const EMPTY_SNAPSHOT: OfflineGuidedSnapshot = {
  tracks: [],
  savedAudio: {},
};

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSnapshot: OfflineGuidedSnapshot = EMPTY_SNAPSHOT;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function buildOfflineAudioCacheKey(trackId: string): string {
  return `/_bodhi_offline_audio/${encodeURIComponent(trackId)}`;
}

export function isOfflineAudioStorageSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "caches" in window &&
    typeof window.caches?.open === "function"
  );
}

export function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseSnapshot(raw: string | null): OfflineGuidedSnapshot {
  if (!raw) return EMPTY_SNAPSHOT;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineGuidedSnapshot>;
    const tracks = Array.isArray(parsed.tracks)
      ? parsed.tracks.filter(
          (item): item is FavoriteTrackItem =>
            Boolean(item) &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.url === "string"
        )
      : [];
    const savedAudio: Record<string, SavedOfflineAudioMeta> = {};
    if (parsed.savedAudio && typeof parsed.savedAudio === "object") {
      for (const [id, meta] of Object.entries(parsed.savedAudio)) {
        if (
          meta &&
          typeof meta.bytes === "number" &&
          Number.isFinite(meta.bytes) &&
          meta.bytes >= 0
        ) {
          savedAudio[id] = {
            bytes: meta.bytes,
            contentType:
              typeof meta.contentType === "string"
                ? meta.contentType
                : "audio/mpeg",
            savedAt:
              typeof meta.savedAt === "string"
                ? meta.savedAt
                : new Date(0).toISOString(),
          };
        }
      }
    }
    return { tracks, savedAudio };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function readSnapshot(): OfflineGuidedSnapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(OFFLINE_GUIDED_STORAGE_KEY);
    if (raw === cachedRaw) {
      return cachedSnapshot;
    }
    cachedRaw = raw;
    cachedSnapshot = parseSnapshot(raw);
    return cachedSnapshot;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function writeSnapshot(next: OfflineGuidedSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(OFFLINE_GUIDED_STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedSnapshot = next;
    emitChange();
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function getOfflineGuidedSnapshot(): OfflineGuidedSnapshot {
  return readSnapshot();
}

export function getOfflineGuidedServerSnapshot(): OfflineGuidedSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeOfflineGuided(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === OFFLINE_GUIDED_STORAGE_KEY) {
      callback();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * Caches the user's guided tracks metadata locally so downloaded DIRECT_AUDIO tracks
 * remain browsable and playable in Airplane Mode.
 */
export function cacheGuidedTrackList(tracks: FavoriteTrackItem[]): void {
  const current = readSnapshot();
  writeSnapshot({
    tracks,
    savedAudio: current.savedAudio,
  });
}

async function fetchAudioBlobForOffline(
  track: FavoriteTrackItem,
  isAuthenticated: boolean
): Promise<Blob> {
  // 1. Try direct CORS fetch first for DIRECT_AUDIO (fastest, zero server bandwidth when allowed).
  //    Google Drive URLs redirect through non-CORS download endpoints, so skip straight to the proxy.
  if (track.provider === "DIRECT_AUDIO") {
    try {
      const directRes = await fetch(track.url, { mode: "cors" });
      if (directRes.ok) {
        const blob = await directRes.blob();
        if (blob.size > 0) {
          return blob;
        }
      }
    } catch {
      // CORS blocked or network quirk — fall through to same-origin authenticated proxy
    }
  }

  // 2. Fallback (or primary path for Google Drive) to Bodhi's authenticated same-origin proxy
  if (isAuthenticated) {
    const proxyRes = await fetch(
      `/api/tracks/${encodeURIComponent(track.id)}/audio`
    );
    if (!proxyRes.ok) {
      throw new Error(`Proxy download failed (${proxyRes.status})`);
    }
    const blob = await proxyRes.blob();
    if (blob.size > 0) {
      return blob;
    }
  }

  throw new Error("Could not download audio for offline playback");
}

/**
 * Downloads a DIRECT_AUDIO or GOOGLE_DRIVE track into the dedicated Cache Storage
 * bucket (`bodhi-user-audio-v1`) and records its offline metadata.
 */
export async function saveTrackAudioOffline(
  track: FavoriteTrackItem,
  isAuthenticated: boolean
): Promise<SavedOfflineAudioMeta> {
  if (!isAudioStreamProvider(track.provider)) {
    throw new Error(
      "Only direct audio and Google Drive tracks can be saved offline"
    );
  }
  if (!isOfflineAudioStorageSupported()) {
    throw new Error("Offline storage is unavailable in this browser");
  }

  const blob = await fetchAudioBlobForOffline(track, isAuthenticated);
  const contentType = blob.type || "audio/mpeg";
  const cache = await window.caches.open(OFFLINE_GUIDED_AUDIO_CACHE_NAME);
  const cacheKey = buildOfflineAudioCacheKey(track.id);

  await cache.put(
    cacheKey,
    new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(blob.size),
      },
    })
  );

  const meta: SavedOfflineAudioMeta = {
    bytes: blob.size,
    contentType,
    savedAt: new Date().toISOString(),
  };

  const current = readSnapshot();
  const hasTrack = current.tracks.some((item) => item.id === track.id);
  writeSnapshot({
    tracks: hasTrack ? current.tracks : [track, ...current.tracks],
    savedAudio: {
      ...current.savedAudio,
      [track.id]: meta,
    },
  });

  return meta;
}

/**
 * Removes a track's offline audio file from Cache Storage and updates metadata.
 */
export async function removeTrackAudioOffline(trackId: string): Promise<void> {
  if (isOfflineAudioStorageSupported()) {
    try {
      const cache = await window.caches.open(OFFLINE_GUIDED_AUDIO_CACHE_NAME);
      await cache.delete(buildOfflineAudioCacheKey(trackId));
    } catch {
      // Ignore cache deletion failures
    }
  }

  const current = readSnapshot();
  if (!(trackId in current.savedAudio)) return;

  const nextSaved = { ...current.savedAudio };
  delete nextSaved[trackId];
  writeSnapshot({
    tracks: current.tracks,
    savedAudio: nextSaved,
  });
}

/**
 * Reads a locally saved DIRECT_AUDIO track from Cache Storage and returns a
 * `blob:` Object URL ready for `<audio src={...}>`. Caller must revoke via `URL.revokeObjectURL`.
 */
export async function getOfflineTrackAudioBlobUrl(
  trackId: string
): Promise<string | null> {
  if (!isOfflineAudioStorageSupported()) return null;

  try {
    const cache = await window.caches.open(OFFLINE_GUIDED_AUDIO_CACHE_NAME);
    const response = await cache.match(buildOfflineAudioCacheKey(trackId));
    if (!response) return null;
    const blob = await response.blob();
    if (blob.size <= 0) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
