import type {
  MeditationSessionItem,
  SaveSessionPayload,
} from "@bodhi/core/history/types";
import { createOfflineSessionQueue } from "@bodhi/core/offline/queue";
import type { KeyValueStorage } from "@bodhi/core/offline/storage";

export {
  buildPendingSession,
  createOfflineSessionQueue,
  HISTORY_CACHE_KEY_PREFIX,
  isPendingSessionId,
  mergeSessionsWithPending,
  PENDING_SESSION_PREFIX,
  PENDING_STORAGE_KEY_PREFIX,
  pendingSessionToPayload,
  type OfflineSessionQueue,
} from "@bodhi/core/offline/queue";

const webLocalStorage: KeyValueStorage = {
  getItem(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage quota errors
    }
  },
  removeItem(key) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage quota errors
    }
  },
};

const webQueue = createOfflineSessionQueue(webLocalStorage);

export function readPendingSessions(userId: string): MeditationSessionItem[] {
  return webQueue.readPendingSessions(userId);
}

export function writePendingSessions(
  userId: string,
  sessions: MeditationSessionItem[]
): void {
  webQueue.writePendingSessions(userId, sessions);
}

export function enqueuePendingSession(
  userId: string,
  payload: SaveSessionPayload
): MeditationSessionItem {
  return webQueue.enqueuePendingSession(userId, payload);
}

export function updatePendingSessionNote(
  userId: string,
  sessionId: string,
  note: string | null
): MeditationSessionItem | null {
  return webQueue.updatePendingSessionNote(userId, sessionId, note);
}

export function removePendingSession(userId: string, sessionId: string): void {
  webQueue.removePendingSession(userId, sessionId);
}

export function readCachedHistory(userId: string): MeditationSessionItem[] {
  return webQueue.readCachedHistory(userId);
}

export function writeCachedHistory(
  userId: string,
  sessions: ReadonlyArray<MeditationSessionItem>
): void {
  webQueue.writeCachedHistory(userId, sessions);
}
