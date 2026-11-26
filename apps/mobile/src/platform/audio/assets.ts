import type {
  BreathDurationTier,
  BreathSampleKind,
} from "@bodhi/core/audio/breath";
import type { AmbientSoundId, BellSoundId } from "@bodhi/core/audio/sounds";

/**
 * Static Metro asset requires for all 13 bundled acoustic files (~1.3 MB total).
 * Bundling inside the iOS/Android binary guarantees instant offline playback
 * with zero network dependency on first launch.
 */
export const BELL_AUDIO_ASSETS: Partial<Record<BellSoundId, number>> = {
  "singing-bowl": require("../../../assets/audio/bells/singing-bowl.mp3"),
  "tibetan-healing-bowl": require("../../../assets/audio/bells/tibetan-healing-bowl.mp3"),
  "deep-gong": require("../../../assets/audio/bells/deep-gong.mp3"),
  "soft-chime": require("../../../assets/audio/bells/soft-chime.mp3"),
  "wood-block": require("../../../assets/audio/bells/wood-block.mp3"),
};

export const AMBIENT_AUDIO_ASSETS: Partial<Record<AmbientSoundId, number>> = {
  "gentle-rain": require("../../../assets/audio/ambient/gentle-rain.mp3"),
  "ocean-waves": require("../../../assets/audio/ambient/ocean-waves.mp3"),
};

export const BREATH_AUDIO_ASSETS: Record<
  BreathSampleKind,
  Record<BreathDurationTier, number>
> = {
  inhale: {
    short: require("../../../assets/audio/breath-inhale-short.mp3"),
    medium: require("../../../assets/audio/breath-inhale-medium.mp3"),
    long: require("../../../assets/audio/breath-inhale-long.mp3"),
  },
  exhale: {
    short: require("../../../assets/audio/breath-exhale-short.mp3"),
    medium: require("../../../assets/audio/breath-exhale-medium.mp3"),
    long: require("../../../assets/audio/breath-exhale-long.mp3"),
  },
};
