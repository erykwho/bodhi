import {
  DEFAULT_AMBIENT_SOUND_ID,
  DEFAULT_AMBIENT_VOLUME,
  isAmbientSoundId,
} from "../audio/sounds";
import {
  clampBreathingDurationMinutes,
  clampBreathingRhythm,
} from "./engine";
import { clampRetentionConfig, isRetentionPaceId } from "./retention-engine";
import {
  BREATHING_CUE_MODES,
  BREATHING_PATTERN_IDS,
  BREATHING_PRACTICE_MODES,
  DEFAULT_BREATHING_DURATION_MINUTES,
  DEFAULT_CUSTOM_RHYTHM,
  DEFAULT_RETENTION_CONFIG,
  type BreathingCueMode,
  type BreathingPatternId,
  type BreathingPracticeMode,
  type BreathingPreferences,
  type BreathingRhythm,
  type RetentionConfig,
} from "./types";

export const BREATHING_PREFERENCES_STORAGE_KEY = "bodhi.breathing.preferences.v1";

export const DEFAULT_BREATHING_PREFERENCES: BreathingPreferences = {
  mode: "rhythmic",
  patternId: "box",
  customRhythm: { ...DEFAULT_CUSTOM_RHYTHM },
  durationMinutes: DEFAULT_BREATHING_DURATION_MINUTES,
  retention: { ...DEFAULT_RETENTION_CONFIG },
  cueMode: "tone",
  hapticsEnabled: true,
  ambientSound: DEFAULT_AMBIENT_SOUND_ID,
  ambientVolume: DEFAULT_AMBIENT_VOLUME,
};

function isBreathingPracticeMode(value: unknown): value is BreathingPracticeMode {
  return (
    typeof value === "string" &&
    (BREATHING_PRACTICE_MODES as readonly string[]).includes(value)
  );
}

function isBreathingPatternId(value: unknown): value is BreathingPatternId {
  return (
    typeof value === "string" &&
    (BREATHING_PATTERN_IDS as readonly string[]).includes(value)
  );
}

function isBreathingCueMode(value: unknown): value is BreathingCueMode {
  return (
    typeof value === "string" &&
    (BREATHING_CUE_MODES as readonly string[]).includes(value)
  );
}

function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AMBIENT_VOLUME;
  }
  return Math.min(1, Math.max(0, Math.round(value * 20) / 20));
}

function parseCustomRhythm(raw: unknown): BreathingRhythm {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CUSTOM_RHYTHM };
  }
  const r = raw as Record<string, unknown>;
  return clampBreathingRhythm({
    inhaleSec:
      typeof r.inhaleSec === "number"
        ? r.inhaleSec
        : DEFAULT_CUSTOM_RHYTHM.inhaleSec,
    holdInSec:
      typeof r.holdInSec === "number"
        ? r.holdInSec
        : DEFAULT_CUSTOM_RHYTHM.holdInSec,
    exhaleSec:
      typeof r.exhaleSec === "number"
        ? r.exhaleSec
        : DEFAULT_CUSTOM_RHYTHM.exhaleSec,
    holdOutSec:
      typeof r.holdOutSec === "number"
        ? r.holdOutSec
        : DEFAULT_CUSTOM_RHYTHM.holdOutSec,
  });
}

function parseRetentionConfig(raw: unknown): RetentionConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RETENTION_CONFIG };
  }
  const r = raw as Record<string, unknown>;
  return clampRetentionConfig({
    rounds:
      typeof r.rounds === "number"
        ? r.rounds
        : DEFAULT_RETENTION_CONFIG.rounds,
    breathsPerRound:
      typeof r.breathsPerRound === "number"
        ? r.breathsPerRound
        : DEFAULT_RETENTION_CONFIG.breathsPerRound,
    pace: isRetentionPaceId(r.pace) ? r.pace : DEFAULT_RETENTION_CONFIG.pace,
    recoveryHoldSec:
      typeof r.recoveryHoldSec === "number"
        ? r.recoveryHoldSec
        : DEFAULT_RETENTION_CONFIG.recoveryHoldSec,
    retentionMinuteChime:
      typeof r.retentionMinuteChime === "boolean"
        ? r.retentionMinuteChime
        : DEFAULT_RETENTION_CONFIG.retentionMinuteChime,
  });
}

/**
 * Safely sanitizes untrusted JSON into valid BreathingPreferences.
 */
export function parseBreathingPreferences(raw: unknown): BreathingPreferences {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_BREATHING_PREFERENCES,
      customRhythm: { ...DEFAULT_CUSTOM_RHYTHM },
      retention: { ...DEFAULT_RETENTION_CONFIG },
    };
  }

  const record = raw as Record<string, unknown>;

  return {
    mode: isBreathingPracticeMode(record.mode)
      ? record.mode
      : DEFAULT_BREATHING_PREFERENCES.mode,
    patternId: isBreathingPatternId(record.patternId)
      ? record.patternId
      : DEFAULT_BREATHING_PREFERENCES.patternId,
    customRhythm: parseCustomRhythm(record.customRhythm),
    durationMinutes:
      typeof record.durationMinutes === "number" &&
      Number.isFinite(record.durationMinutes)
        ? clampBreathingDurationMinutes(record.durationMinutes)
        : DEFAULT_BREATHING_PREFERENCES.durationMinutes,
    retention: parseRetentionConfig(record.retention),
    cueMode: isBreathingCueMode(record.cueMode)
      ? record.cueMode
      : DEFAULT_BREATHING_PREFERENCES.cueMode,
    hapticsEnabled:
      typeof record.hapticsEnabled === "boolean"
        ? record.hapticsEnabled
        : DEFAULT_BREATHING_PREFERENCES.hapticsEnabled,
    ambientSound: isAmbientSoundId(record.ambientSound)
      ? record.ambientSound
      : DEFAULT_BREATHING_PREFERENCES.ambientSound,
    ambientVolume: clampVolume(record.ambientVolume),
  };
}
