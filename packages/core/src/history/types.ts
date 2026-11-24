import type { TrackProviderType } from "../tracks/types";

export type SessionModeType = "TIMER" | "TRACK" | "BREATHING";

export interface MeditationSessionItem {
  id: string;
  mode: SessionModeType;
  trackId: string | null;
  trackTitle: string | null;
  trackProvider: TrackProviderType | null;
  breathingPattern?: string | null;
  plannedDurationSec: number | null;
  actualDurationSec: number;
  completed: boolean;
  note: string | null;
  startedAt: string;
  endedAt: string;
  /** True when the session was recorded offline and is awaiting cloud sync. */
  pendingSync?: boolean;
}

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

export interface HistoryStats {
  totalSessions: number;
  totalSeconds: number;
  currentStreakDays: number;
  longestStreakDays: number;
}
