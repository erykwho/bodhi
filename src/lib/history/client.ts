import type {
  MeditationSessionItem,
  SessionModeType,
} from "@/lib/history/types";
import type { TrackProviderType } from "@/lib/tracks/types";

export interface SaveSessionPayload {
  mode: SessionModeType;
  trackId?: string | null;
  trackTitle?: string | null;
  trackProvider?: TrackProviderType | null;
  plannedDurationSec?: number | null;
  actualDurationSec: number;
  completed: boolean;
  note?: string | null;
  startedAt?: string;
  endedAt?: string;
}

export async function saveMeditationSession(
  payload: SaveSessionPayload
): Promise<MeditationSessionItem | null> {
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

export async function updateMeditationSessionNote(
  sessionId: string,
  note: string | null
): Promise<MeditationSessionItem | null> {
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
