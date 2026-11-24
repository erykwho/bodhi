import {
  DEFAULT_AMBIENT_SOUND_ID,
  DEFAULT_AMBIENT_VOLUME,
  DEFAULT_END_BELL_ID,
  DEFAULT_INTERVAL_BELL_ID,
  DEFAULT_START_BELL_ID,
  isAmbientSoundId,
  isBellSoundId,
} from "../audio/sounds";
import { clampDurationMinutes, clampIntervalMinutes } from "./engine";
import {
  BELL_STRIKE_OPTIONS,
  DEFAULT_BELL_VOLUME,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_END_BELL_STRIKES,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_WARMUP_SECONDS,
  WARMUP_OPTIONS_SECONDS,
  type BellStrikeCount,
  type TimerPreferences,
  type WarmupSeconds,
} from "./types";

export const TIMER_PREFERENCES_STORAGE_KEY = "bodhi.timer.preferences.v1";

export const DEFAULT_TIMER_PREFERENCES: TimerPreferences = {
  durationMinutes: DEFAULT_DURATION_MINUTES,
  openEnded: false,
  warmupSeconds: DEFAULT_WARMUP_SECONDS,
  startBell: DEFAULT_START_BELL_ID,
  endBell: DEFAULT_END_BELL_ID,
  endBellStrikes: DEFAULT_END_BELL_STRIKES,
  bellVolume: DEFAULT_BELL_VOLUME,
  intervalEnabled: false,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  intervalBell: DEFAULT_INTERVAL_BELL_ID,
  ambientSound: DEFAULT_AMBIENT_SOUND_ID,
  ambientVolume: DEFAULT_AMBIENT_VOLUME,
};

function isWarmupSeconds(value: unknown): value is WarmupSeconds {
  return (
    typeof value === "number" &&
    (WARMUP_OPTIONS_SECONDS as readonly number[]).includes(value)
  );
}

function isBellStrikeCount(value: unknown): value is BellStrikeCount {
  return (
    typeof value === "number" &&
    (BELL_STRIKE_OPTIONS as readonly number[]).includes(value)
  );
}

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, Math.round(value * 20) / 20));
}

/**
 * Safely sanitizes an untrusted JSON payload into valid TimerPreferences,
 * falling back to defaults for any missing or invalid fields.
 */
export function parseTimerPreferences(raw: unknown): TimerPreferences {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_TIMER_PREFERENCES };
  }

  const record = raw as Record<string, unknown>;

  const durationMinutes =
    typeof record.durationMinutes === "number" &&
    Number.isFinite(record.durationMinutes)
      ? clampDurationMinutes(record.durationMinutes)
      : DEFAULT_TIMER_PREFERENCES.durationMinutes;

  const openEnded =
    typeof record.openEnded === "boolean"
      ? record.openEnded
      : DEFAULT_TIMER_PREFERENCES.openEnded;

  const warmupSeconds = isWarmupSeconds(record.warmupSeconds)
    ? record.warmupSeconds
    : DEFAULT_TIMER_PREFERENCES.warmupSeconds;

  const startBell = isBellSoundId(record.startBell)
    ? record.startBell
    : DEFAULT_TIMER_PREFERENCES.startBell;

  const endBell = isBellSoundId(record.endBell)
    ? record.endBell
    : DEFAULT_TIMER_PREFERENCES.endBell;

  const endBellStrikes = isBellStrikeCount(record.endBellStrikes)
    ? record.endBellStrikes
    : DEFAULT_TIMER_PREFERENCES.endBellStrikes;

  const bellVolume = clampVolume(record.bellVolume, DEFAULT_BELL_VOLUME);

  const intervalEnabled =
    typeof record.intervalEnabled === "boolean"
      ? record.intervalEnabled
      : DEFAULT_TIMER_PREFERENCES.intervalEnabled;

  const intervalMinutes =
    typeof record.intervalMinutes === "number" &&
    Number.isFinite(record.intervalMinutes)
      ? clampIntervalMinutes(record.intervalMinutes)
      : DEFAULT_TIMER_PREFERENCES.intervalMinutes;

  // Keep intervalBell non-"none" so toggling interval back on always has a sound
  const intervalBell =
    isBellSoundId(record.intervalBell) && record.intervalBell !== "none"
      ? record.intervalBell
      : DEFAULT_TIMER_PREFERENCES.intervalBell;

  const ambientSound = isAmbientSoundId(record.ambientSound)
    ? record.ambientSound
    : DEFAULT_TIMER_PREFERENCES.ambientSound;

  const ambientVolume = clampVolume(
    record.ambientVolume,
    DEFAULT_AMBIENT_VOLUME
  );

  return {
    durationMinutes,
    openEnded,
    warmupSeconds,
    startBell,
    endBell,
    endBellStrikes,
    bellVolume,
    intervalEnabled,
    intervalMinutes,
    intervalBell,
    ambientSound,
    ambientVolume,
  };
}
