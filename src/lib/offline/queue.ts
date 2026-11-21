import type { SaveSessionPayload } from "@/lib/history/client";
import type { MeditationSessionItem } from "@/lib/history/types";

export const PENDING_SESSION_PREFIX = "pending-";

const PENDING_STORAGE_KEY_PREFIX = "bodhi-pending-sessions:";
const HISTORY_CACHE_KEY_PREFIX = "bodhi-history-cache:";

export function isPendingSessionId(id: string): boolean {
  return id.startsWith(PENDING_SESSION_PREFIX);
}

function generateClientId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${PENDING_SESSION_PREFIX}${crypto.randomUUID()}`;
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

export function readPendingSessions(userId: string): MeditationSessionItem[] {
  if (typeof window === "undefined" || !userId) return [];
  return safeParseArray(
    window.localStorage.getItem(`${PENDING_STORAGE_KEY_PREFIX}${userId}`)
  ).map((item) => ({ ...item, pendingSync: true }));
}

export function writePendingSessions(
  userId: string,
  sessions: MeditationSessionItem[]
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(
      `${PENDING_STORAGE_KEY_PREFIX}${userId}`,
      JSON.stringify(sessions)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueuePendingSession(
  userId: string,
  payload: SaveSessionPayload
): MeditationSessionItem {
  const pending = buildPendingSession(payload);
  const existing = readPendingSessions(userId);
  writePendingSessions(userId, [pending, ...existing]);
  return pending;
}

export function updatePendingSessionNote(
  userId: string,
  sessionId: string,
  note: string | null
): MeditationSessionItem | null {
  const existing = readPendingSessions(userId);
  let updatedItem: MeditationSessionItem | null = null;
  const next = existing.map((item) => {
    if (item.id === sessionId) {
      updatedItem = { ...item, note: note?.trim() || null, pendingSync: true };
      return updatedItem;
    }
    return item;
  });
  if (updatedItem) {
    writePendingSessions(userId, next);
  }
  return updatedItem;
}

export function removePendingSession(userId: string, sessionId: string): void {
  const existing = readPendingSessions(userId);
  writePendingSessions(
    userId,
    existing.filter((item) => item.id !== sessionId)
  );
}

export function readCachedHistory(userId: string): MeditationSessionItem[] {
  if (typeof window === "undefined" || !userId) return [];
  return safeParseArray(
    window.localStorage.getItem(`${HISTORY_CACHE_KEY_PREFIX}${userId}`)
  ).map((item) => ({ ...item, pendingSync: false }));
}

export function writeCachedHistory(
  userId: string,
  sessions: ReadonlyArray<MeditationSessionItem>
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const syncedOnly = sessions
      .filter((item) => !item.pendingSync && !isPendingSessionId(item.id))
      .slice(0, 200);
    window.localStorage.setItem(
      `${HISTORY_CACHE_KEY_PREFIX}${userId}`,
      JSON.stringify(syncedOnly)
    );
  } catch {
    // Ignore storage quota errors
  }
}
