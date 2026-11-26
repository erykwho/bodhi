import type { BreathingCueMode, BreathingPhase } from "../breathing/types";
import type { AmbientSoundId, BellSoundId } from "./sounds";

export interface BreathUnlockOptions {
  inhaleSec?: number;
  exhaleSec?: number;
}

export interface AudioUnlockOptions extends BreathUnlockOptions {
  bells?: BellSoundId[];
  ambientSound?: AmbientSoundId;
}

/**
 * Platform-agnostic contract implemented by both Web (`MeditationAudioEngine`)
 * and React Native (`NativeMeditationAudioEngine`) practice audio engines.
 */
export interface MeditationAudioPort {
  unlock(options?: AudioUnlockOptions): void;
  playBell(variant?: "start" | "end", volume?: number): void;
  cancelBellStrikes(): void;
  playBellStrikes(soundId: BellSoundId, strikes?: 1 | 3, volume?: number): void;
  playBellSound(soundId: BellSoundId, volume?: number): void;
  previewBellSound(soundId: BellSoundId, volume?: number): void;
  stopBellPreview(): void;
  stopBreathingCue(fadeSeconds?: number): void;
  previewBreathingCue(
    cueMode: BreathingCueMode,
    volume?: number,
    inhaleSec?: number,
    exhaleSec?: number
  ): void;
  playBreathingCue(
    phase: BreathingPhase,
    cueMode: BreathingCueMode,
    volume?: number,
    durationSec?: number
  ): void;
  startAmbient(
    soundId: AmbientSoundId,
    volume: number,
    fadeInSeconds?: number
  ): void;
  setAmbientVolume(volume: number): void;
  stopAmbient(fadeOutSeconds?: number): void;
  startPreview(
    soundId: AmbientSoundId,
    volume: number,
    onEnded?: () => void,
    durationMs?: number
  ): void;
  stopPreview(): void;
  getActiveSoundId(): AmbientSoundId;
  dispose(): void;
}
