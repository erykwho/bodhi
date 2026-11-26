import {
  DEFAULT_RECOVERY_HOLD_SEC,
  DEFAULT_RETENTION_BREATHS,
  DEFAULT_RETENTION_ROUNDS,
  MAX_RECOVERY_HOLD_SEC,
  MAX_RETENTION_BREATHS,
  MAX_RETENTION_ROUNDS,
  MIN_RECOVERY_HOLD_SEC,
  MIN_RETENTION_BREATHS,
  MIN_RETENTION_ROUNDS,
  RECOVERY_EXHALE_SEC,
  RECOVERY_INHALE_SEC,
  RETENTION_PACE_IDS,
  RETENTION_PACE_PRESETS,
  type RetentionConfig,
  type RetentionPaceId,
  type RetentionPaceRhythm,
} from "./types";

export interface PowerBreathSnapshot {
  /** 1-based breath number within the round (1..breathsPerRound). */
  breathNumber: number;
  /** Total target breaths for the round. */
  totalBreaths: number;
  /** Current active sub-phase ("inhale" or "exhale"). */
  subPhase: "inhale" | "exhale";
  /** Duration of the active sub-phase in milliseconds. */
  phaseDurationMs: number;
  /** Progress through the active sub-phase in [0, 1]. */
  phaseProgress: number;
  /** Remaining milliseconds in the active sub-phase. */
  phaseRemainingMs: number;
  /** Normalized breathing orb expansion in [0, 1]. */
  orbScale: number;
  /** Monotonically increasing sub-phase index across the round (0..2N-1). */
  phaseStepIndex: number;
  /** True during the final breath of the round. */
  isLastBreath: boolean;
  /** True once all N inhale+exhale cycles have elapsed. */
  isComplete: boolean;
}

export type RecoveryStageKind =
  | "recoveryInhale"
  | "recoveryHold"
  | "recoveryExhale";

export interface RecoveryStageSnapshot {
  stage: RecoveryStageKind;
  durationMs: number;
  remainingMs: number;
  countdownSec: number;
  progress: number;
  orbScale: number;
  isComplete: boolean;
}

export interface RetentionSummaryStats {
  count: number;
  longestSec: number;
  averageSec: number;
  totalHoldSec: number;
}

export interface RetentionHistoryLabelInput {
  completedRounds: number;
  totalRounds: number;
  breathsPerRound: number;
  holdsSec: readonly number[];
}

export const MAX_HISTORY_BREATHING_PATTERN_LENGTH = 80;

function easeInOutSine(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return -(Math.cos(Math.PI * clamped) - 1) / 2;
}

export function isRetentionPaceId(value: unknown): value is RetentionPaceId {
  return (
    typeof value === "string" &&
    (RETENTION_PACE_IDS as readonly string[]).includes(value)
  );
}

export function clampRetentionRounds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETENTION_ROUNDS;
  return Math.min(
    MAX_RETENTION_ROUNDS,
    Math.max(MIN_RETENTION_ROUNDS, Math.round(value))
  );
}

export function clampRetentionBreaths(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETENTION_BREATHS;
  return Math.min(
    MAX_RETENTION_BREATHS,
    Math.max(MIN_RETENTION_BREATHS, Math.round(value))
  );
}

export function clampRecoveryHoldSec(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RECOVERY_HOLD_SEC;
  return Math.min(
    MAX_RECOVERY_HOLD_SEC,
    Math.max(MIN_RECOVERY_HOLD_SEC, Math.round(value))
  );
}

export function clampRetentionConfig(config: RetentionConfig): RetentionConfig {
  return {
    rounds: clampRetentionRounds(config.rounds),
    breathsPerRound: clampRetentionBreaths(config.breathsPerRound),
    pace: isRetentionPaceId(config.pace) ? config.pace : "standard",
    recoveryHoldSec: clampRecoveryHoldSec(config.recoveryHoldSec),
  };
}

export function resolveRetentionPaceRhythm(
  pace: RetentionPaceId
): RetentionPaceRhythm {
  return RETENTION_PACE_PRESETS[pace] ?? RETENTION_PACE_PRESETS.standard;
}

/**
 * Pure, drift-free state calculator for the rhythmic power-breathing stage of a round.
 */
export function computePowerBreathSnapshot(
  stageElapsedMs: number,
  pace: RetentionPaceId,
  breathsPerRound: number
): PowerBreathSnapshot {
  const totalBreaths = clampRetentionBreaths(breathsPerRound);
  const rhythm = resolveRetentionPaceRhythm(pace);
  const inhaleMs = Math.round(rhythm.inhaleSec * 1000);
  const exhaleMs = Math.round(rhythm.exhaleSec * 1000);
  const breathCycleMs = inhaleMs + exhaleMs;
  const totalPowerMs = breathCycleMs * totalBreaths;

  const safeElapsed = Math.max(
    0,
    Number.isFinite(stageElapsedMs) ? stageElapsedMs : 0
  );

  if (safeElapsed >= totalPowerMs) {
    return {
      breathNumber: totalBreaths,
      totalBreaths,
      subPhase: "exhale",
      phaseDurationMs: exhaleMs,
      phaseProgress: 1,
      phaseRemainingMs: 0,
      orbScale: 0,
      phaseStepIndex: totalBreaths * 2 - 1,
      isLastBreath: true,
      isComplete: true,
    };
  }

  const completedBreaths = Math.floor(safeElapsed / breathCycleMs);
  const breathNumber = Math.min(totalBreaths, completedBreaths + 1);
  const intoBreathMs = safeElapsed - completedBreaths * breathCycleMs;

  const isInhale = intoBreathMs < inhaleMs;
  const subPhase: "inhale" | "exhale" = isInhale ? "inhale" : "exhale";
  const phaseDurationMs = isInhale ? inhaleMs : exhaleMs;
  const intoPhaseMs = isInhale
    ? intoBreathMs
    : Math.max(0, intoBreathMs - inhaleMs);
  const phaseRemainingMs = Math.max(0, phaseDurationMs - intoPhaseMs);
  const phaseProgress =
    phaseDurationMs > 0
      ? Math.min(1, Math.max(0, intoPhaseMs / phaseDurationMs))
      : 1;
  const orbScale = isInhale
    ? easeInOutSine(phaseProgress)
    : 1 - easeInOutSine(phaseProgress);

  return {
    breathNumber,
    totalBreaths,
    subPhase,
    phaseDurationMs,
    phaseProgress,
    phaseRemainingMs,
    orbScale,
    phaseStepIndex: completedBreaths * 2 + (isInhale ? 0 : 1),
    isLastBreath: breathNumber === totalBreaths,
    isComplete: false,
  };
}

/**
 * Pure, drift-free state calculator for the three recovery transitions:
 * deep inhale -> 15s full hold -> gentle release exhale.
 */
export function computeRecoverySnapshot(
  stage: RecoveryStageKind,
  stageElapsedMs: number,
  recoveryHoldSec: number
): RecoveryStageSnapshot {
  const safeHoldSec = clampRecoveryHoldSec(recoveryHoldSec);
  const durationMs =
    stage === "recoveryInhale"
      ? Math.round(RECOVERY_INHALE_SEC * 1000)
      : stage === "recoveryHold"
        ? safeHoldSec * 1000
        : Math.round(RECOVERY_EXHALE_SEC * 1000);

  const safeElapsed = Math.max(
    0,
    Number.isFinite(stageElapsedMs) ? stageElapsedMs : 0
  );
  const isComplete = safeElapsed >= durationMs;
  const clampedElapsed = Math.min(durationMs, safeElapsed);
  const remainingMs = Math.max(0, durationMs - clampedElapsed);
  const progress =
    durationMs > 0 ? Math.min(1, Math.max(0, clampedElapsed / durationMs)) : 1;
  const countdownSec =
    remainingMs <= 0 ? 0 : Math.max(1, Math.ceil(remainingMs / 1000));

  let orbScale = 0;
  if (stage === "recoveryInhale") {
    orbScale = easeInOutSine(progress);
  } else if (stage === "recoveryHold") {
    orbScale = 1;
  } else {
    orbScale = 1 - easeInOutSine(progress);
  }

  return {
    stage,
    durationMs,
    remainingMs,
    countdownSec,
    progress,
    orbScale,
    isComplete,
  };
}

/**
 * Computes summary statistics across completed retention holds (in seconds).
 */
export function computeRetentionSummary(
  holdsSec: readonly number[]
): RetentionSummaryStats {
  const sanitized = holdsSec
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .map((sec) => Math.round(sec));

  if (sanitized.length === 0) {
    return {
      count: 0,
      longestSec: 0,
      averageSec: 0,
      totalHoldSec: 0,
    };
  }

  let totalHoldSec = 0;
  let longestSec = 0;
  for (const sec of sanitized) {
    totalHoldSec += sec;
    if (sec > longestSec) {
      longestSec = sec;
    }
  }

  return {
    count: sanitized.length,
    longestSec,
    averageSec: Math.round(totalHoldSec / sanitized.length),
    totalHoldSec,
  };
}

/**
 * Compact m:ss formatter for retention hold durations (e.g. "0:45", "1:30", "2:05").
 */
export function formatRetentionHoldCompact(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? Math.round(seconds) : 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Builds a concise canonical history pattern label guaranteed to stay within
 * the 80-character Zod API ceiling on POST /api/sessions.
 * Examples:
 * - "Retention 3×30 (1:12 · 1:40 · 2:05)"
 * - "Retention 2/3×30 (1:15)"
 */
export function formatRetentionHistoryLabel({
  completedRounds,
  totalRounds,
  breathsPerRound,
  holdsSec,
}: RetentionHistoryLabelInput): string {
  const safeTotal = clampRetentionRounds(totalRounds);
  const safeBreaths = clampRetentionBreaths(breathsPerRound);
  const safeCompleted = Math.min(
    safeTotal,
    Math.max(0, Math.round(completedRounds))
  );

  const roundsPrefix =
    safeCompleted >= safeTotal
      ? `Retention ${safeTotal}×${safeBreaths}`
      : safeCompleted > 0
        ? `Retention ${safeCompleted}/${safeTotal}×${safeBreaths}`
        : `Retention ${safeTotal}×${safeBreaths}`;

  const validHolds = holdsSec
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .map((sec) => Math.round(sec));

  if (validHolds.length === 0) {
    return roundsPrefix.slice(0, MAX_HISTORY_BREATHING_PATTERN_LENGTH);
  }

  const holdsList = validHolds.map(formatRetentionHoldCompact).join(" · ");
  const detailed = `${roundsPrefix} (${holdsList})`;
  if (detailed.length <= MAX_HISTORY_BREATHING_PATTERN_LENGTH) {
    return detailed;
  }

  const summary = computeRetentionSummary(validHolds);
  const compact = `${roundsPrefix} · best ${formatRetentionHoldCompact(summary.longestSec)}`;
  return compact.slice(0, MAX_HISTORY_BREATHING_PATTERN_LENGTH);
}
