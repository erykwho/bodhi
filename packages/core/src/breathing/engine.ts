import {
  BREATHING_PRESETS,
  MAX_BREATHING_DURATION_MINUTES,
  MAX_EXHALE_PHASE_SEC,
  MAX_HOLD_PHASE_SEC,
  MAX_INHALE_PHASE_SEC,
  MIN_ACTIVE_PHASE_SEC,
  MIN_BREATHING_DURATION_MINUTES,
  type BreathingPatternId,
  type BreathingPhase,
  type BreathingRhythm,
} from "./types";

export interface BreathingPhaseSegment {
  phase: BreathingPhase;
  durationMs: number;
}

export interface BreathingSnapshot {
  phase: BreathingPhase;
  /** Total duration in milliseconds of the active phase. */
  phaseDurationMs: number;
  /** Progress through the active phase in [0, 1]. */
  phaseProgress: number;
  /** Remaining milliseconds in the active phase. */
  phaseRemainingMs: number;
  /** Whole seconds countdown for display (1..N). */
  phaseCountdownSec: number;
  /** Normalized breathing expansion in [0, 1] (0 = exhaled, 1 = full inhale). */
  orbScale: number;
  /** 1-based current cycle number. */
  cycleNumber: number;
  /** Number of fully completed cycles so far. */
  completedCycles: number;
  /** Unique monotonically increasing phase transition index across the session. */
  phaseStepIndex: number;
}

function clampHalfStep(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value * 2) / 2;
  return Math.min(max, Math.max(min, rounded));
}

export function clampBreathingDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_BREATHING_DURATION_MINUTES;
  return Math.min(
    MAX_BREATHING_DURATION_MINUTES,
    Math.max(MIN_BREATHING_DURATION_MINUTES, Math.round(value))
  );
}

export function clampBreathingRhythm(rhythm: BreathingRhythm): BreathingRhythm {
  return {
    inhaleSec: clampHalfStep(
      rhythm.inhaleSec,
      MIN_ACTIVE_PHASE_SEC,
      MAX_INHALE_PHASE_SEC
    ),
    holdInSec: clampHalfStep(rhythm.holdInSec, 0, MAX_HOLD_PHASE_SEC),
    exhaleSec: clampHalfStep(
      rhythm.exhaleSec,
      MIN_ACTIVE_PHASE_SEC,
      MAX_EXHALE_PHASE_SEC
    ),
    holdOutSec: clampHalfStep(rhythm.holdOutSec, 0, MAX_HOLD_PHASE_SEC),
  };
}

export function resolveBreathingRhythm(
  patternId: BreathingPatternId,
  customRhythm: BreathingRhythm
): BreathingRhythm {
  if (patternId === "custom") {
    return clampBreathingRhythm(customRhythm);
  }
  return BREATHING_PRESETS[patternId];
}

export function buildBreathingSegments(
  rhythm: BreathingRhythm
): BreathingPhaseSegment[] {
  const safe = clampBreathingRhythm(rhythm);
  const segments: BreathingPhaseSegment[] = [
    { phase: "inhale", durationMs: Math.round(safe.inhaleSec * 1000) },
  ];

  if (safe.holdInSec > 0) {
    segments.push({
      phase: "holdIn",
      durationMs: Math.round(safe.holdInSec * 1000),
    });
  }

  segments.push({
    phase: "exhale",
    durationMs: Math.round(safe.exhaleSec * 1000),
  });

  if (safe.holdOutSec > 0) {
    segments.push({
      phase: "holdOut",
      durationMs: Math.round(safe.holdOutSec * 1000),
    });
  }

  return segments;
}

export function getCycleDurationMs(rhythm: BreathingRhythm): number {
  return buildBreathingSegments(rhythm).reduce(
    (sum, seg) => sum + seg.durationMs,
    0
  );
}

/**
 * Estimates the number of breathing cycles that fit in the target duration.
 */
export function estimateTotalCycles(
  durationMinutes: number,
  rhythm: BreathingRhythm
): number {
  const cycleMs = getCycleDurationMs(rhythm);
  if (cycleMs <= 0) return 1;
  return Math.max(
    1,
    Math.floor((clampBreathingDurationMinutes(durationMinutes) * 60 * 1000) / cycleMs)
  );
}

/**
 * Smooth cosine easing for organic breath expansion and contraction.
 */
function easeInOutSine(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return -(Math.cos(Math.PI * clamped) - 1) / 2;
}

/**
 * Pure, drift-free breathing state calculator from elapsed session milliseconds.
 */
export function computeBreathingSnapshot(
  elapsedMs: number,
  rhythm: BreathingRhythm
): BreathingSnapshot {
  const segments = buildBreathingSegments(rhythm);
  const cycleMs = segments.reduce((sum, seg) => sum + seg.durationMs, 0);
  const safeElapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);

  const completedCycles = Math.floor(safeElapsed / cycleMs);
  const cycleNumber = completedCycles + 1;
  const intoCycleMs = safeElapsed % cycleMs;

  let cursor = 0;
  let activeIndex = 0;
  let intoPhaseMs = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (intoCycleMs < cursor + seg.durationMs || i === segments.length - 1) {
      activeIndex = i;
      intoPhaseMs = Math.min(seg.durationMs, Math.max(0, intoCycleMs - cursor));
      break;
    }
    cursor += seg.durationMs;
  }

  const activeSegment = segments[activeIndex];
  const phaseRemainingMs = Math.max(0, activeSegment.durationMs - intoPhaseMs);
  const phaseProgress =
    activeSegment.durationMs > 0
      ? Math.min(1, Math.max(0, intoPhaseMs / activeSegment.durationMs))
      : 1;
  const phaseCountdownSec = Math.max(1, Math.ceil(phaseRemainingMs / 1000));

  let orbScale = 0;
  if (activeSegment.phase === "inhale") {
    orbScale = easeInOutSine(phaseProgress);
  } else if (activeSegment.phase === "holdIn") {
    orbScale = 1;
  } else if (activeSegment.phase === "exhale") {
    orbScale = 1 - easeInOutSine(phaseProgress);
  } else {
    orbScale = 0;
  }

  return {
    phase: activeSegment.phase,
    phaseDurationMs: activeSegment.durationMs,
    phaseProgress,
    phaseRemainingMs,
    phaseCountdownSec,
    orbScale,
    cycleNumber,
    completedCycles,
    phaseStepIndex: completedCycles * segments.length + activeIndex,
  };
}

function formatSecPart(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Returns formatted phase duration parts (omitting 0s hold phases) for compact UI rendering.
 */
export function getBreathingRhythmParts(rhythm: BreathingRhythm): string[] {
  const safe = clampBreathingRhythm(rhythm);
  const parts: number[] = [safe.inhaleSec];
  if (safe.holdInSec > 0) parts.push(safe.holdInSec);
  parts.push(safe.exhaleSec);
  if (safe.holdOutSec > 0) parts.push(safe.holdOutSec);
  return parts.map(formatSecPart);
}

/**
 * Formats a breathing rhythm compactly for the setup dial (e.g. "4 · 4 · 4 · 4", "4 · 7 · 8", "5.5 · 5.5").
 */
export function formatBreathingRhythm(
  rhythm: BreathingRhythm,
  separator: string = " · "
): string {
  return getBreathingRhythmParts(rhythm).join(separator);
}

/**
 * Builds a concise canonical pattern label for history storage (e.g. "Box 4-4-4-4", "4-7-8", "Coherent 5.5-5.5").
 */
export function formatBreathingHistoryLabel(
  patternId: BreathingPatternId,
  rhythm: BreathingRhythm
): string {
  const compact = formatBreathingRhythm(rhythm, "-");
  switch (patternId) {
    case "box":
      return `Box ${compact}`;
    case "4-7-8":
      return "4-7-8";
    case "coherent":
      return `Coherent ${compact}`;
    case "custom":
      return `Custom ${compact}`;
  }
}
