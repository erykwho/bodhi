import type { AmbientSoundId } from "../audio/sounds";

export type BreathingPracticeMode = "rhythmic" | "retention";

export type BreathingPatternId = "box" | "4-7-8" | "coherent" | "custom";

export type BreathingPhase = "inhale" | "holdIn" | "exhale" | "holdOut";

export type BreathingCueMode = "tone" | "chime" | "silent";

export type RetentionPaceId = "slow" | "standard" | "fast";

export type RetentionStage =
  | "power"
  | "retention"
  | "recoveryInhale"
  | "recoveryHold"
  | "recoveryExhale";

export interface BreathingRhythm {
  inhaleSec: number;
  holdInSec: number;
  exhaleSec: number;
  holdOutSec: number;
}

export interface RetentionPaceRhythm {
  inhaleSec: number;
  exhaleSec: number;
}

export interface RetentionConfig {
  rounds: number;
  breathsPerRound: number;
  pace: RetentionPaceId;
  recoveryHoldSec: number;
  retentionMinuteChime: boolean;
}

export interface BreathingPatternPreset {
  id: Exclude<BreathingPatternId, "custom">;
  rhythm: BreathingRhythm;
}

export const BREATHING_PRACTICE_MODES: readonly BreathingPracticeMode[] = [
  "rhythmic",
  "retention",
] as const;

export const BREATHING_PATTERN_IDS: readonly BreathingPatternId[] = [
  "box",
  "4-7-8",
  "coherent",
  "custom",
] as const;

export const BREATHING_CUE_MODES: readonly BreathingCueMode[] = [
  "tone",
  "chime",
  "silent",
] as const;

export const RETENTION_PACE_IDS: readonly RetentionPaceId[] = [
  "slow",
  "standard",
  "fast",
] as const;

export const RETENTION_BREATH_PRESETS = [20, 30, 40] as const;

export const RETENTION_PACE_PRESETS: Record<
  RetentionPaceId,
  RetentionPaceRhythm
> = {
  slow: { inhaleSec: 1.8, exhaleSec: 1.4 },
  standard: { inhaleSec: 1.4, exhaleSec: 1.1 },
  fast: { inhaleSec: 1.1, exhaleSec: 0.85 },
};

export const BREATHING_PRESETS: Record<
  Exclude<BreathingPatternId, "custom">,
  BreathingRhythm
> = {
  box: { inhaleSec: 4, holdInSec: 4, exhaleSec: 4, holdOutSec: 4 },
  "4-7-8": { inhaleSec: 4, holdInSec: 7, exhaleSec: 8, holdOutSec: 0 },
  coherent: { inhaleSec: 5.5, holdInSec: 0, exhaleSec: 5.5, holdOutSec: 0 },
};

export const DEFAULT_CUSTOM_RHYTHM: BreathingRhythm = {
  inhaleSec: 4,
  holdInSec: 2,
  exhaleSec: 6,
  holdOutSec: 0,
};

export const MIN_BREATHING_DURATION_MINUTES = 1;
export const MAX_BREATHING_DURATION_MINUTES = 30;
export const DEFAULT_BREATHING_DURATION_MINUTES = 3;

export const MIN_ACTIVE_PHASE_SEC = 1;
export const MAX_INHALE_PHASE_SEC = 8;
export const MAX_HOLD_PHASE_SEC = 8;
export const MAX_EXHALE_PHASE_SEC = 8;

export const MIN_RETENTION_ROUNDS = 1;
export const MAX_RETENTION_ROUNDS = 5;
export const DEFAULT_RETENTION_ROUNDS = 3;

export const MIN_RETENTION_BREATHS = 15;
export const MAX_RETENTION_BREATHS = 50;
export const DEFAULT_RETENTION_BREATHS = 30;

export const MIN_RECOVERY_HOLD_SEC = 10;
export const MAX_RECOVERY_HOLD_SEC = 20;
export const DEFAULT_RECOVERY_HOLD_SEC = 15;

export const RECOVERY_INHALE_SEC = 2.0;
export const RECOVERY_EXHALE_SEC = 2.2;

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  rounds: DEFAULT_RETENTION_ROUNDS,
  breathsPerRound: DEFAULT_RETENTION_BREATHS,
  pace: "standard",
  recoveryHoldSec: DEFAULT_RECOVERY_HOLD_SEC,
  retentionMinuteChime: true,
};

export interface BreathingPreferences {
  mode: BreathingPracticeMode;
  patternId: BreathingPatternId;
  customRhythm: BreathingRhythm;
  durationMinutes: number;
  retention: RetentionConfig;
  cueMode: BreathingCueMode;
  hapticsEnabled: boolean;
  ambientSound: AmbientSoundId;
  ambientVolume: number;
}
