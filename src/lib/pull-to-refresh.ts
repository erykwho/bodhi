export const PULL_DEAD_ZONE = 8;
export const PULL_THRESHOLD = 68;
export const PULL_MAX_DISTANCE = 104;
export const PULL_REFRESH_HOLD_DISTANCE = 56;

export type PullPhase = "idle" | "pulling" | "ready" | "refreshing";

/**
 * Converts raw vertical touch delta (px) into a rubber-band damped visual
 * distance, respecting the dead-zone and maximum pull ceiling.
 */
export function calculatePullDistance(rawDeltaY: number): number {
  if (!Number.isFinite(rawDeltaY) || rawDeltaY <= PULL_DEAD_ZONE) {
    return 0;
  }

  const effectiveDelta = rawDeltaY - PULL_DEAD_ZONE;
  const damped = PULL_MAX_DISTANCE * (1 - Math.exp(-effectiveDelta / 140));
  return Math.min(PULL_MAX_DISTANCE, Math.max(0, damped));
}

/**
 * Returns the current phase of the pull-to-refresh gesture.
 */
export function getPullPhase(
  distance: number,
  isRefreshing: boolean
): PullPhase {
  if (isRefreshing) {
    return "refreshing";
  }
  if (distance >= PULL_THRESHOLD) {
    return "ready";
  }
  if (distance > 0) {
    return "pulling";
  }
  return "idle";
}

/**
 * Computes normalized progress in [0, 1] toward the refresh threshold.
 */
export function getPullProgress(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) {
    return 0;
  }
  return Math.min(1, distance / PULL_THRESHOLD);
}
