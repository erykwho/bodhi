import {
  MAX_DURATION_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_DURATION_MINUTES,
  MIN_INTERVAL_MINUTES,
} from "./types";

/**
 * Clamps a requested session duration (in minutes) into the supported range.
 */
export function clampDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_DURATION_MINUTES;
  return Math.min(
    MAX_DURATION_MINUTES,
    Math.max(MIN_DURATION_MINUTES, Math.round(value))
  );
}

/**
 * Clamps a requested interval bell period (in minutes) into the supported range.
 */
export function clampIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_INTERVAL_MINUTES;
  return Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, Math.round(value))
  );
}

/**
 * Computes how many times an interval bell will chime strictly between session
 * start (0) and completion (durationMinutes). Never counts 0 or completion.
 */
export function computeIntervalCount(
  durationMinutes: number,
  intervalMinutes: number
): number {
  if (
    !Number.isFinite(durationMinutes) ||
    !Number.isFinite(intervalMinutes) ||
    durationMinutes <= 0 ||
    intervalMinutes <= 0
  ) {
    return 0;
  }

  return Math.max(0, Math.ceil(durationMinutes / intervalMinutes) - 1);
}

/**
 * Returns the 1-based index of the most recent interval mark crossed during a
 * session, or 0 if no interval mark has been reached yet (or if the session
 * has reached completion, where the closing bell takes over).
 */
export function computeIntervalBellIndex(
  elapsedMs: number,
  totalMs: number,
  intervalMs: number
): number {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(totalMs) ||
    !Number.isFinite(intervalMs) ||
    totalMs <= 0 ||
    intervalMs <= 0 ||
    elapsedMs <= 0 ||
    elapsedMs >= totalMs
  ) {
    return 0;
  }

  const maxIndex = Math.max(0, Math.ceil(totalMs / intervalMs) - 1);
  if (maxIndex === 0) return 0;

  return Math.min(maxIndex, Math.floor(elapsedMs / intervalMs));
}

/**
 * Returns the 1-based index of the most recent interval mark crossed during an
 * open-ended (count-up) session, or 0 if no mark has been reached yet.
 */
export function computeOpenEndedIntervalBellIndex(
  elapsedMs: number,
  intervalMs: number
): number {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    elapsedMs <= 0
  ) {
    return 0;
  }

  return Math.floor(elapsedMs / intervalMs);
}

/**
 * Computes remaining milliseconds from an absolute target timestamp.
 * Using timestamps prevents drift when mobile browsers throttle intervals.
 */
export function computeRemainingMs(endTimeMs: number, nowMs: number): number {
  return Math.max(0, endTimeMs - nowMs);
}

/**
 * Computes normalized progress in [0, 1] for a countdown timer.
 */
export function computeProgress(totalMs: number, remainingMs: number): number {
  if (totalMs <= 0) return 1;
  const clampedRemaining = Math.min(totalMs, Math.max(0, remainingMs));
  return (totalMs - clampedRemaining) / totalMs;
}

/**
 * Computes elapsed milliseconds given total and remaining time.
 */
export function computeElapsedMs(totalMs: number, remainingMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.min(totalMs, Math.max(0, totalMs - Math.max(0, remainingMs)));
}

/**
 * Formats milliseconds for the primary countdown display.
 * Uses ceiling to whole seconds so the display starts cleanly at the full
 * duration (e.g., 10:00) and transitions to 00:00 only upon completion.
 */
export function formatTimerDisplay(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats elapsed milliseconds for an open-ended (count-up) session.
 * Uses floor to whole seconds so the timer starts cleanly at 00:00.
 */
export function formatElapsedDisplay(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats a human-readable duration summary (e.g., "10 min", "1 h 30 min").
 */
export function formatDurationLabel(minutes: number): string {
  const safe = clampDurationMinutes(minutes);
  if (safe < 60) {
    return `${safe} min`;
  }
  const hours = Math.floor(safe / 60);
  const rem = safe % 60;
  if (rem === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${rem} min`;
}

/**
 * Strips non-digit characters and caps inline duration input to 3 digits
 * (since MAX_DURATION_MINUTES is 180).
 */
export function sanitizeDurationMinutesInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3);
}

/**
 * Parses an inline duration input (in whole minutes) and clamps it into
 * [MIN_DURATION_MINUTES, MAX_DURATION_MINUTES]. Returns the clamped fallback
 * when the input contains no digits.
 */
export function parseDurationMinutesInput(
  raw: string,
  fallbackMinutes: number
): number {
  const digits = sanitizeDurationMinutesInput(raw);
  if (digits.length === 0) {
    return clampDurationMinutes(fallbackMinutes);
  }
  return clampDurationMinutes(Number.parseInt(digits, 10));
}
