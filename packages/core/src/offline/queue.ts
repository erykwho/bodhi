import type {
  MeditationSessionItem,
  SaveSessionPayload,
} from "../history/types";
import type { KeyValueStorage } from "./storage";

export const PENDING_SESSION_PREFIX = "pending-";
export const PENDING_STORAGE_KEY_PREFIX = "bodhi-pending-sessions:";
export const HISTORY_CACHE_KEY_PREFIX = "bodhi-history-cache:";

export function isPendingSessionId(id: string): boolean {
  return id.startsWith(PENDING_SESSION_PREFIX);
}

function generateClientId(): string {
  const globalCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `${PENDING_SESSION_PREFIX}${globalCrypto.randomUUID()}`;
  }
  return `${PENDING_SESSION_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates a local pending MeditationSessionItem from a save payload.
 */
export function buildPendingSession(
  payload: SaveSessionPayload,
  id: string = generateClientId()
): MeditationSessionItem {
  const endedAt = payload.endedAt ?? new Date().toISOString();
  const startedAt =
    payload.startedAt ??
    new Date(
      new Date(endedAt).getTime() - payload.actualDurationSec * 1000
    ).toISOString();

  return {
    id,
    mode: payload.mode,
    trackId: payload.trackId ?? null,
    trackTitle: payload.trackTitle ?? null,
    trackProvider: payload.trackProvider ?? null,
    breathingPattern: payload.breathingPattern ?? null,
    plannedDurationSec: payload.plannedDurationSec ?? null,
    actualDurationSec: payload.actualDurationSec,
    completed: payload.completed,
    note: payload.note?.trim() || null,
    startedAt,
    endedAt,
    pendingSync: true,
  };
}

/**
 * Converts a pending session back into the POST /api/sessions payload.
 */
export function pendingSessionToPayload(
  session: MeditationSessionItem
): SaveSessionPayload {
  return {
    mode: session.mode,
    trackId: session.trackId,
    trackTitle: session.trackTitle,
    trackProvider: session.trackProvider,
    breathingPattern: session.breathingPattern ?? null,
    plannedDurationSec: session.plannedDurationSec,
    actualDurationSec: session.actualDurationSec,
    completed: session.completed,
    note: session.note,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

/**
 * Merges synced server sessions with locally queued pending sessions,
 * deduplicating by id and sorting newest-first by endedAt.
 */
export function mergeSessionsWithPending(
  syncedSessions: ReadonlyArray<MeditationSessionItem>,
  pendingSessions: ReadonlyArray<MeditationSessionItem>
): MeditationSessionItem[] {
  const byId = new Map<string, MeditationSessionItem>();

  for (const session of syncedSessions) {
    byId.set(session.id, { ...session, pendingSync: false });
  }
  for (const pending of pendingSessions) {
    if (!byId.has(pending.id)) {
      byId.set(pending.id, { ...pending, pendingSync: true });
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
  );
}

function safeParseArray(raw: string | null): MeditationSessionItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MeditationSessionItem[]) : [];
  } catch {
    return [];
  }
}

export interface OfflineSessionQueue {
  readPendingSessions(userId: string): MeditationSessionItem[];
  writePendingSessions(userId: string, sessions: MeditationSessionItem[]): void;
  enqueuePendingSession(
    userId: string,
    payload: SaveSessionPayload
  ): MeditationSessionItem;
  updatePendingSessionNote(
    userId: string,
    sessionId: string,
    note: string | null
  ): MeditationSessionItem | null;
  removePendingSession(userId: string, sessionId: string): void;
  readCachedHistory(userId: string): MeditationSessionItem[];
  writeCachedHistory(
    userId: string,
    sessions: ReadonlyArray<MeditationSessionItem>
  ): void;
}

/**
 * Creates a platform-agnostic offline session queue & history cache backed by
 * any KeyValueStorage (Web localStorage or React Native MMKV).
 */
export function createOfflineSessionQueue(
  storage: KeyValueStorage
): OfflineSessionQueue {
  const readPendingSessions = (userId: string): MeditationSessionItem[] => {
    if (!userId) return [];
    try {
      return safeParseArray(
        storage.getItem(`${PENDING_STORAGE_KEY_PREFIX}${userId}`)
      ).map((item) => ({ ...item, pendingSync: true }));
    } catch {
      return [];
    }
  };

  const writePendingSessions = (
    userId: string,
    sessions: MeditationSessionItem[]
  ): void => {
    if (!userId) return;
    try {
      storage.setItem(
        `${PENDING_STORAGE_KEY_PREFIX}${userId}`,
        JSON.stringify(sessions)
      );
    } catch {
      // Ignore storage quota errors
    }
  };

  const enqueuePendingSession = (
    userId: string,
    payload: SaveSessionPayload
  ): MeditationSessionItem => {
    const pending = buildPendingSession(payload);
    const existing = readPendingSessions(userId);
    writePendingSessions(userId, [pending, ...existing]);
    return pending;
  };

  const updatePendingSessionNote = (
    userId: string,
    sessionId: string,
    note: string | null
  ): MeditationSessionItem | null => {
    const existing = readPendingSessions(userId);
    let updatedItem: MeditationSessionItem | null = null;
    const next = existing.map((item) => {
      if (item.id === sessionId) {
        updatedItem = {
          ...item,
          note: note?.trim() || null,
          pendingSync: true,
        };
        return updatedItem;
      }
      return item;
    });
    if (updatedItem) {
      writePendingSessions(userId, next);
    }
    return updatedItem;
  };

  const removePendingSession = (userId: string, sessionId: string): void => {
    const existing = readPendingSessions(userId);
    writePendingSessions(
      userId,
      existing.filter((item) => item.id !== sessionId)
    );
  };

  const readCachedHistory = (userId: string): MeditationSessionItem[] => {
    if (!userId) return [];
    try {
      return safeParseArray(
        storage.getItem(`${HISTORY_CACHE_KEY_PREFIX}${userId}`)
      ).map((item) => ({ ...item, pendingSync: false }));
    } catch {
      return [];
    }
  };

  const writeCachedHistory = (
    userId: string,
    sessions: ReadonlyArray<MeditationSessionItem>
  ): void => {
    if (!userId) return;
    try {
      const syncedOnly = sessions
        .filter((item) => !item.pendingSync && !isPendingSessionId(item.id))
        .slice(0, 200);
      storage.setItem(
        `${HISTORY_CACHE_KEY_PREFIX}${userId}`,
        JSON.stringify(syncedOnly)
      );
    } catch {
      // Ignore storage quota errors
    }
  };

  return {
    readPendingSessions,
    writePendingSessions,
    enqueuePendingSession,
    updatePendingSessionNote,
    removePendingSession,
    readCachedHistory,
    writeCachedHistory,
  };
}
