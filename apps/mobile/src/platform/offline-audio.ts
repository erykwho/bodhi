import { Directory, File, Paths } from "expo-file-system";
import { isAudioStreamProvider } from "@bodhi/core/tracks/providers";
import type { FavoriteTrackItem } from "@bodhi/core/tracks/types";
import { bodhiApi } from "./api";
import { getAccessToken } from "./secure-tokens";
import { mobileStorage } from "./storage";

const OFFLINE_AUDIO_INDEX_KEY = "bodhi.mobile.offline.audio.v1";

export interface SavedNativeAudioEntry {
  trackId: string;
  localUri: string;
  bytes: number;
  savedAt: string;
}

type OfflineAudioMap = Record<string, SavedNativeAudioEntry>;

const listeners = new Set<() => void>();
let cachedMap: OfflineAudioMap | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getAudioDirectory(): Directory {
  const dir = new Directory(Paths.document, "guided-audio");
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function sanitizeFilename(trackId: string): string {
  return `${trackId.replace(/[^a-zA-Z0-9_-]/g, "_")}.audio`;
}

function readIndex(): OfflineAudioMap {
  if (cachedMap) return cachedMap;
  const raw = mobileStorage.getItem(OFFLINE_AUDIO_INDEX_KEY);
  if (!raw) {
    cachedMap = {};
    return cachedMap;
  }
  try {
    const parsed = JSON.parse(raw) as OfflineAudioMap;
    cachedMap = parsed && typeof parsed === "object" ? parsed : {};
    return cachedMap;
  } catch {
    cachedMap = {};
    return cachedMap;
  }
}

function writeIndex(next: OfflineAudioMap): void {
  cachedMap = next;
  mobileStorage.setItem(OFFLINE_AUDIO_INDEX_KEY, JSON.stringify(next));
  notify();
}

export function getOfflineAudioIndex(): OfflineAudioMap {
  return readIndex();
}

export function subscribeOfflineAudioIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocalAudioUri(trackId: string): string | null {
  const entry = readIndex()[trackId];
  if (!entry) return null;
  try {
    const file = new File(entry.localUri);
    return file.exists ? entry.localUri : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a DIRECT_AUDIO or GOOGLE_DRIVE guided track permanently into the
 * app's document directory (never evicted by iOS Safari's 7-day web storage policy).
 */
export async function downloadTrackForOffline(
  track: FavoriteTrackItem
): Promise<SavedNativeAudioEntry> {
  if (!isAudioStreamProvider(track.provider)) {
    throw new Error("Only direct audio and Google Drive tracks support offline download");
  }

  const dir = getAudioDirectory();
  const targetFile = new File(dir, sanitizeFilename(track.id));
  const proxyUrl = bodhiApi.getAudioStreamUrl(track.id);
  const token = await getAccessToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  let downloaded: File;

  if (track.provider === "DIRECT_AUDIO") {
    try {
      downloaded = await File.downloadFileAsync(track.url, targetFile, {
        idempotent: true,
      });
    } catch {
      downloaded = await File.downloadFileAsync(proxyUrl, targetFile, {
        headers: authHeaders,
        idempotent: true,
      });
    }
  } else {
    downloaded = await File.downloadFileAsync(proxyUrl, targetFile, {
      headers: authHeaders,
      idempotent: true,
    });
  }

  const entry: SavedNativeAudioEntry = {
    trackId: track.id,
    localUri: downloaded.uri,
    bytes: downloaded.size ?? 0,
    savedAt: new Date().toISOString(),
  };

  const next = { ...readIndex(), [track.id]: entry };
  writeIndex(next);
  return entry;
}

export function removeOfflineTrack(trackId: string): void {
  const current = readIndex();
  const entry = current[trackId];
  if (entry) {
    try {
      const file = new File(entry.localUri);
      if (file.exists) {
        file.delete();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  const rest = { ...current };
  delete rest[trackId];
  writeIndex(rest);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
