export type BreathSampleKind = "inhale" | "exhale";

export type BreathDurationTier = "short" | "medium" | "long";

export interface BreathSampleSpec {
  src: string;
  nominalDurationSec: number;
}

export const MULTI_STRIKE_SPACING_MS = 2100;

/**
 * With 3 duration-matched nasal breath samples centered at ~1.47s / ~3.70s / ~6.22s
 * (pre-stretched offline with formant-preserving librubberband), playbackRate stays
 * in the natural [0.73x, 1.50x] range across 1s-8s while staying safely clamped to [0.5x, 2.0x].
 */
export const MIN_BREATH_PLAYBACK_RATE = 0.5;
export const MAX_BREATH_PLAYBACK_RATE = 2.0;

export const BREATH_AUDIO_CATALOG: Record<
  BreathSampleKind,
  Record<BreathDurationTier, BreathSampleSpec>
> = {
  inhale: {
    short: {
      src: "/audio/breath-inhale-short.mp3",
      nominalDurationSec: 1.45,
    },
    medium: {
      src: "/audio/breath-inhale-medium.mp3",
      nominalDurationSec: 3.66,
    },
    long: {
      src: "/audio/breath-inhale-long.mp3",
      nominalDurationSec: 6.18,
    },
  },
  exhale: {
    short: {
      src: "/audio/breath-exhale-short.mp3",
      nominalDurationSec: 1.48,
    },
    medium: {
      src: "/audio/breath-exhale-medium.mp3",
      nominalDurationSec: 3.75,
    },
    long: {
      src: "/audio/breath-exhale-long.mp3",
      nominalDurationSec: 6.27,
    },
  },
};

/**
 * Selects the closest natural breath sample tier for a phase duration so
 * playbackRate stays close to 1.0x without sounding artificial:
 * - <= 2.2s: short nasal sample (~1.47s)
 * - <= 4.6s: medium studio nasal sample (~3.70s)
 * - > 4.6s: long multi-take studio nasal sample (~6.22s)
 */
export function selectBreathDurationTier(
  targetPhaseDurationSec: number
): BreathDurationTier {
  if (!Number.isFinite(targetPhaseDurationSec) || targetPhaseDurationSec <= 0) {
    return "medium";
  }
  if (targetPhaseDurationSec <= 2.2) return "short";
  if (targetPhaseDurationSec <= 4.6) return "medium";
  return "long";
}

/**
 * Computes the clamped playbackRate for a given breath sample tier and target duration.
 */
export function computeBreathPlaybackRate(
  nominalDurationSec: number,
  targetDurationSec: number
): number {
  if (
    !Number.isFinite(nominalDurationSec) ||
    nominalDurationSec <= 0 ||
    !Number.isFinite(targetDurationSec) ||
    targetDurationSec <= 0
  ) {
    return 1;
  }
  const raw = nominalDurationSec / targetDurationSec;
  return Math.min(MAX_BREATH_PLAYBACK_RATE, Math.max(MIN_BREATH_PLAYBACK_RATE, raw));
}
