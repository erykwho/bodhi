import type { AmbientSoundId } from "@/lib/audio/sounds";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

/**
 * Self-contained Web Audio API engine for meditation bells and ambient loops.
 * Designed to stay 100% offline with smooth fade envelopes and zero audio files
 * required in V1, while remaining extensible for file-backed tracks later.
 */
export class MeditationAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private activeSoundId: AmbientSoundId = "silence";
  private isPreviewing = false;
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    return this.ctx;
  }

  /**
   * Unlocks the AudioContext on a direct user gesture (required on mobile Safari/Chrome).
   */
  public unlock(): void {
    this.ensureContext();
  }

  /**
   * Synthesizes a warm Tibetan singing bowl strike using harmonic partials
   * with natural exponential decay.
   */
  public playBell(variant: "start" | "end" = "start"): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const baseFreq = variant === "start" ? 216 : 196;
    const duration = variant === "start" ? 5.5 : 7.0;

    // Singing bowl partials: fundamental + gentle metallic overtones
    const partials: Array<{ ratio: number; gain: number; decay: number }> = [
      { ratio: 1.0, gain: 0.28, decay: duration },
      { ratio: 2.0, gain: 0.11, decay: duration * 0.72 },
      { ratio: 2.756, gain: 0.06, decay: duration * 0.5 },
      { ratio: 5.404, gain: 0.025, decay: duration * 0.3 },
    ];

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.85, now + 0.035);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(ctx.destination);

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const partialGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq * partial.ratio, now);

      partialGain.gain.setValueAtTime(partial.gain, now);
      partialGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + partial.decay
      );

      osc.connect(partialGain);
      partialGain.connect(masterGain);

      osc.start(now);
      osc.stop(now + partial.decay + 0.05);
    }
  }

  private getWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }

    // 4-second stereo buffer for seamless, non-repetitive looping
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Starts looping the chosen ambient sound with a smooth fade-in.
   */
  public startAmbient(
    soundId: AmbientSoundId,
    volume: number,
    fadeInSeconds = 1.2
  ): void {
    this.clearPreviewTimer();
    this.isPreviewing = false;

    if (soundId === "silence") {
      this.stopAmbient(0.4);
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    // Tear down any existing ambient loop cleanly before starting a new one
    this.teardownAmbientImmediate();

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.getWhiteNoiseBuffer(ctx);
    source.loop = true;

    // Gentle low-pass filter softens harsh high-frequency hiss into a calm air texture
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(0.5, now);

    const gainNode = ctx.createGain();
    const targetGain = this.mapVolumeToGain(volume);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, targetGain),
      now + Math.max(0.05, fadeInSeconds)
    );

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(now);

    this.ambientSource = source;
    this.ambientFilter = filter;
    this.ambientGain = gainNode;
    this.activeSoundId = soundId;
  }

  /**
   * Smoothly adjusts ambient sound volume while playing.
   */
  public setAmbientVolume(volume: number): void {
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    const target = Math.max(0.0001, this.mapVolumeToGain(volume));
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setTargetAtTime(target, now, 0.08);
  }

  /**
   * Smoothly fades out and stops the active ambient sound.
   */
  public stopAmbient(fadeOutSeconds = 0.8): void {
    this.clearPreviewTimer();
    this.isPreviewing = false;

    if (!this.ctx || !this.ambientSource || !this.ambientGain) {
      this.teardownAmbientImmediate();
      return;
    }

    const ctx = this.ctx;
    const source = this.ambientSource;
    const gainNode = this.ambientGain;
    const filter = this.ambientFilter;

    this.ambientSource = null;
    this.ambientGain = null;
    this.ambientFilter = null;
    this.activeSoundId = "silence";

    const now = ctx.currentTime;
    const fade = Math.max(0.05, fadeOutSeconds);
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + fade);

    setTimeout(() => {
      try {
        source.stop();
      } catch {
        // Ignore if already stopped
      }
      source.disconnect();
      filter?.disconnect();
      gainNode.disconnect();
    }, Math.ceil((fade + 0.08) * 1000));
  }

  /**
   * Plays a short preview of an ambient sound and invokes `onEnded` when it stops.
   */
  public startPreview(
    soundId: AmbientSoundId,
    volume: number,
    onEnded?: () => void,
    durationMs = 8000
  ): void {
    if (soundId === "silence") {
      this.stopPreview();
      onEnded?.();
      return;
    }

    this.startAmbient(soundId, volume, 0.35);
    this.isPreviewing = true;

    this.previewTimeout = setTimeout(() => {
      if (this.isPreviewing) {
        this.stopAmbient(0.5);
        onEnded?.();
      }
    }, durationMs);
  }

  public stopPreview(): void {
    if (this.isPreviewing) {
      this.stopAmbient(0.3);
    }
    this.clearPreviewTimer();
  }

  public getActiveSoundId(): AmbientSoundId {
    return this.activeSoundId;
  }

  public dispose(): void {
    this.clearPreviewTimer();
    this.teardownAmbientImmediate();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
      this.previewTimeout = null;
    }
  }

  private teardownAmbientImmediate(): void {
    if (this.ambientSource) {
      try {
        this.ambientSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this.ambientSource.disconnect();
      this.ambientSource = null;
    }
    if (this.ambientFilter) {
      this.ambientFilter.disconnect();
      this.ambientFilter = null;
    }
    if (this.ambientGain) {
      this.ambientGain.disconnect();
      this.ambientGain = null;
    }
    this.activeSoundId = "silence";
  }

  /**
   * Maps a [0, 1] UI slider value to a comfortable acoustic gain ceiling
   * so white noise remains gentle even near 100%.
   */
  private mapVolumeToGain(volume: number): number {
    const clamped = Math.min(1, Math.max(0, volume));
    return clamped * clamped * 0.28;
  }
}
