import type { AmbientSoundId, BellSoundId } from "../audio/sounds";

export type TimerPhase = "idle" | "warmup" | "running" | "paused" | "completed";

export const DURATION_PRESETS_MINUTES = [5, 10, 15, 20, 30] as const;

export const WARMUP_OPTIONS_SECONDS = [0, 5, 10] as const;
export type WarmupSeconds = (typeof WARMUP_OPTIONS_SECONDS)[number];

export const INTERVAL_PRESETS_MINUTES = [1, 2, 5, 10, 15] as const;

export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 180;
export const DEFAULT_DURATION_MINUTES = 10;
export const DEFAULT_WARMUP_SECONDS: WarmupSeconds = 5;

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;
export const DEFAULT_INTERVAL_MINUTES = 5;

export const BELL_STRIKE_OPTIONS = [1, 3] as const;
export type BellStrikeCount = (typeof BELL_STRIKE_OPTIONS)[number];
export const DEFAULT_BELL_VOLUME = 0.85;
export const DEFAULT_END_BELL_STRIKES: BellStrikeCount = 1;

export interface TimerPreferences {
  durationMinutes: number;
  openEnded: boolean;
  warmupSeconds: WarmupSeconds;
  startBell: BellSoundId;
  endBell: BellSoundId;
  endBellStrikes: BellStrikeCount;
  bellVolume: number;
  intervalEnabled: boolean;
  intervalMinutes: number;
  intervalBell: BellSoundId;
  ambientSound: AmbientSoundId;
  ambientVolume: number;
}
