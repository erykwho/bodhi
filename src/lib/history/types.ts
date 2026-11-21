import type { TrackProviderType } from "@/lib/tracks/types";

export type SessionModeType = "TIMER" | "TRACK";

export interface MeditationSessionItem {
  id: string;
  mode: SessionModeType;
  trackId: string | null;
  trackTitle: string | null;
  trackProvider: TrackProviderType | null;
  plannedDurationSec: number | null;
  actualDurationSec: number;
  completed: boolean;
  note: string | null;
  startedAt: string;
  endedAt: string;
}

export interface HistoryStats {
  totalSessions: number;
  totalSeconds: number;
  currentStreakDays: number;
  longestStreakDays: number;
}
