import type {
  MeditationSessionItem,
  SessionModeType,
} from "@/lib/history/types";
import {
  enqueuePendingSession,
  isPendingSessionId,
  updatePendingSessionNote,
} from "@/lib/offline/queue";
import type { TrackProviderType } from "@/lib/tracks/types";

export interface SaveSessionPayload {
  mode: SessionModeType;
  trackId?: string | null;
  trackTitle?: string | null;
  trackProvider?: TrackProviderType | null;
  breathingPattern?: string | null;
  plannedDurationSec?: number | null;
  actualDurationSec: number;
  completed: boolean;
  note?: string | null;
  startedAt?: string;
  endedAt?: string;
}

/**
 * Posts a session to Neon PostgreSQL via /api/sessions.
 * If the browser is offline or the network fails (and `offlineUserId` is provided),
 * queues the session locally so it syncs automatically once back online.
 */
export async function saveMeditationSession(
  payload: SaveSessionPayload,
  offlineUserId?: string | null
): Promise<MeditationSessionItem | null> {
  const isOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  if (isOffline) {
    return offlineUserId ? enqueuePendingSession(offlineUserId, payload) : null;
  }

  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // Queue only on transient server/network failures, not auth/validation rejections
      if (response.status >= 500 && offlineUserId) {
        return enqueuePendingSession(offlineUserId, payload);
      }
      return null;
    }
    const data = (await response.json()) as {
      session?: MeditationSessionItem;
    };
    return data.session ?? null;
  } catch {
    return offlineUserId ? enqueuePendingSession(offlineUserId, payload) : null;
  }
}

/**
 * Updates a session reflection note on the server, or locally if the session
 * is still queued offline awaiting sync.
 */
export async function updateMeditationSessionNote(
  sessionId: string,
  note: string | null,
  offlineUserId?: string | null
): Promise<MeditationSessionItem | null> {
  if (isPendingSessionId(sessionId)) {
    return offlineUserId
      ? updatePendingSessionNote(offlineUserId, sessionId, note)
      : null;
  }

  try {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      session?: MeditationSessionItem;
    };
    return data.session ?? null;
  } catch {
    return null;
  }
}
