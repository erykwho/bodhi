import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/lib/timer/types";

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
