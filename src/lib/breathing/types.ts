import type { AmbientSoundId } from "@/lib/audio/sounds";

export type BreathingPatternId = "box" | "4-7-8" | "coherent" | "custom";

export type BreathingPhase = "inhale" | "holdIn" | "exhale" | "holdOut";

export type BreathingCueMode = "tone" | "chime" | "silent";

export interface BreathingRhythm {
  inhaleSec: number;
  holdInSec: number;
  exhaleSec: number;
  holdOutSec: number;
}

export interface BreathingPatternPreset {
  id: Exclude<BreathingPatternId, "custom">;
  rhythm: BreathingRhythm;
}

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

export interface BreathingPreferences {
  patternId: BreathingPatternId;
  customRhythm: BreathingRhythm;
  durationMinutes: number;
  cueMode: BreathingCueMode;
  hapticsEnabled: boolean;
  ambientSound: AmbientSoundId;
  ambientVolume: number;
}
