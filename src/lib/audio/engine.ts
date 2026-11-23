import type { AmbientSoundId, BellSoundId } from "@/lib/audio/sounds";
import type { BreathingCueMode, BreathingPhase } from "@/lib/breathing/types";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: string;
  };
};

type PitchPreservingAudioElement = HTMLAudioElement & {
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

type BreathSampleKind = "inhale" | "exhale";

interface ActiveAmbientGraph {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  masterGain: GainNode;
  gainCeiling: number;
}

const MULTI_STRIKE_SPACING_MS = 2100;

/**
 * WebKit / iOS Safari guarantees pitch-preserved <audio> output within [0.5, 2.0].
 * Our denoised breath samples are centered around ~3.6-4.0s so every phase duration
 * from 2s to 8s (including 4s Box, 5.5s Coherent, and 8s 4-7-8 exhale) stays cleanly
 * within this natural range.
 */
export const MIN_BREATH_PLAYBACK_RATE = 0.5;
export const MAX_BREATH_PLAYBACK_RATE = 2.0;

const BREATH_AUDIO_SOURCES: Record<
  BreathSampleKind,
  { src: string; nominalDurationSec: number }
> = {
  inhale: {
    src: "/audio/breath-inhale.mp3",
    nominalDurationSec: 3.61,
  },
  exhale: {
    src: "/audio/breath-exhale.mp3",
    nominalDurationSec: 3.98,
  },
};

/**
 * Valid 50ms silent 8kHz mono PCM WAV played once on user gesture to switch
 * pre-iOS 16.4 Safari AVAudioSession from "ambient" to "playback" so Web Audio
 * bells and ambient loops remain audible even with the hardware Silent switch ON.
 */
const SILENT_UNLOCK_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

/**
 * Computes the pitch-preserved playbackRate required to span a breath sample
 * across `targetPhaseDurationSec`, safely clamped to WebKit's [0.5, 2.0] range.
 */
export function computeBreathPlaybackRate(
  sampleDurationSec: number,
  targetPhaseDurationSec: number
): number {
  if (
    !Number.isFinite(sampleDurationSec) ||
    sampleDurationSec <= 0 ||
    !Number.isFinite(targetPhaseDurationSec) ||
    targetPhaseDurationSec <= 0
  ) {
    return 1;
  }

  const rawRate = sampleDurationSec / targetPhaseDurationSec;
  return Math.min(
    MAX_BREATH_PLAYBACK_RATE,
    Math.max(MIN_BREATH_PLAYBACK_RATE, rawRate)
  );
}

/**
 * Self-contained offline-first audio engine for meditation bells, ambient soundscapes
 * (Web Audio API), and denoised CC0 human breath cues (pitch-preserving HTML5 Audio).
 * Configures iOS "playback" audio session so practice audio plays even when the
 * device's hardware Silent switch is enabled.
 */
export class MeditationAudioEngine {
  private ctx: AudioContext | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private brownNoiseBuffer: AudioBuffer | null = null;
  private ambientGraph: ActiveAmbientGraph | null = null;
  private breathAudioElements: Record<
    BreathSampleKind,
    PitchPreservingAudioElement | null
  > = {
    inhale: null,
    exhale: null,
  };
  private breathAudioPrimed: Record<BreathSampleKind, boolean> = {
    inhale: false,
    exhale: false,
  };
  private breathPlayTokens: Record<BreathSampleKind, number> = {
    inhale: 0,
    exhale: 0,
  };
  private activeBreathKind: BreathSampleKind | null = null;
  private breathPhaseEndTimer: ReturnType<typeof setTimeout> | null = null;
  private breathFadeInterval: ReturnType<typeof setInterval> | null = null;
  private breathPreviewTimeout: ReturnType<typeof setTimeout> | null = null;
  private silentUnlockAudio: HTMLAudioElement | null = null;
  private silentSwitchUnlocked = false;
  private activeSoundId: AmbientSoundId = "silence";
  private isPreviewing = false;
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;
  private bellStrikeTimeouts: Array<ReturnType<typeof setTimeout>> = [];

  /**
   * Requests the "playback" AudioSession category (iOS Safari 16.4+ / iOS 17-18+)
   * so bells, ambient soundscapes, and breathing cues bypass the hardware Silent switch.
   */
  private configurePlaybackAudioSession(): void {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithAudioSession;
    if (nav.audioSession && nav.audioSession.type !== "playback") {
      try {
        nav.audioSession.type = "playback";
      } catch {
        // Ignore on platforms where audioSession.type is unsupported or read-only
      }
    }
  }

  /**
   * Plays a 50ms silent HTML5 <audio> clip once during a user gesture to nudge
   * older iOS Safari versions into the "playback" AVAudioSession category.
   */
  private unlockSilentSwitchBridge(): void {
    if (this.silentSwitchUnlocked || typeof Audio === "undefined") return;
    this.silentSwitchUnlocked = true;

    try {
      const el = new Audio(SILENT_UNLOCK_WAV_DATA_URI);
      el.setAttribute("playsinline", "true");
      el.preload = "auto";
      el.volume = 0.01;
      this.silentUnlockAudio = el;

      const promise = el.play();
      if (promise && typeof promise.catch === "function") {
        void promise.catch(() => {
          // Retry on next user gesture if blocked
          this.silentSwitchUnlocked = false;
        });
      }
    } catch {
      this.silentSwitchUnlocked = false;
    }
  }

  private getOrCreateBreathAudio(
    kind: BreathSampleKind
  ): PitchPreservingAudioElement | null {
    if (typeof Audio === "undefined") return null;

    const existing = this.breathAudioElements[kind];
    if (existing) return existing;

    const audio = new Audio(
      BREATH_AUDIO_SOURCES[kind].src
    ) as PitchPreservingAudioElement;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    this.applyPreservePitch(audio);
    this.breathAudioElements[kind] = audio;
    return audio;
  }

  private applyPreservePitch(audio: PitchPreservingAudioElement): void {
    try {
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      if ("mozPreservesPitch" in audio) audio.mozPreservesPitch = true;
      if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;
    } catch {
      // Ignore if browser disallows vendor pitch property
    }
  }

  /**
   * Primes reusable inhale/exhale <audio> elements during a direct user gesture so
   * subsequent timer-driven phase transitions play without iOS autoplay restrictions.
   */
  private primeBreathAudioElements(): void {
    if (typeof Audio === "undefined") return;

    for (const kind of ["inhale", "exhale"] as const) {
      if (this.breathAudioPrimed[kind] || this.activeBreathKind === kind) {
        continue;
      }

      const audio = this.getOrCreateBreathAudio(kind);
      if (!audio) continue;

      const token = ++this.breathPlayTokens[kind];
      audio.muted = true;
      try {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === "function") {
          void playPromise
            .then(() => {
              this.breathAudioPrimed[kind] = true;
              // Guard against racing with an immediate playBreathingCue() in the same tap
              if (this.breathPlayTokens[kind] === token) {
                audio.pause();
                try {
                  audio.currentTime = 0;
                } catch {
                  // Ignore if metadata not loaded yet
                }
                audio.muted = false;
              }
            })
            .catch(() => {
              if (this.breathPlayTokens[kind] === token) {
                audio.muted = false;
              }
            });
        } else {
          this.breathAudioPrimed[kind] = true;
          audio.pause();
          audio.muted = false;
        }
      } catch {
        audio.muted = false;
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    this.configurePlaybackAudioSession();

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
   * Unlocks the AudioContext, enables iOS "playback" audio session (Silent switch bypass),
   * and primes breathing <audio> elements on a direct user gesture.
   */
  public unlock(): void {
    this.configurePlaybackAudioSession();
    this.ensureContext();
    this.unlockSilentSwitchBridge();
    this.primeBreathAudioElements();
  }

  /**
   * Backward-compatible helper used by GuidedSessionPlayer and legacy callers.
   */
  public playBell(variant: "start" | "end" = "start", volume: number = 0.85): void {
    this.playBellSound(variant === "end" ? "deep-gong" : "singing-bowl", volume);
  }

  /**
   * Cancels any queued follow-up strikes from a multi-strike closing bell.
   */
  public cancelBellStrikes(): void {
    for (const timer of this.bellStrikeTimeouts) {
      clearTimeout(timer);
    }
    this.bellStrikeTimeouts = [];
  }

  /**
   * Plays a bell 1 or 3 times with serene spacing (classic meditation closing).
   */
  public playBellStrikes(
    soundId: BellSoundId,
    strikes: 1 | 3 = 1,
    volume: number = 0.85
  ): void {
    this.cancelBellStrikes();
    if (soundId === "none") return;

    this.playBellSound(soundId, volume);
    if (strikes <= 1) return;

    for (let i = 1; i < strikes; i++) {
      const timer = setTimeout(() => {
        this.playBellSound(soundId, volume);
      }, i * MULTI_STRIKE_SPACING_MS);
      this.bellStrikeTimeouts.push(timer);
    }
  }

  /**
   * Plays a synthesized meditation chime/bell by catalog ID at the given volume [0, 1].
   */
  public playBellSound(soundId: BellSoundId, volume: number = 0.85): void {
    if (soundId === "none") return;
    const clampedVolume = Math.min(1, Math.max(0, volume));
    if (clampedVolume <= 0.001) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const outputGain = ctx.createGain();
    // Slight gentle curve so 85% feels full and lower settings stay crisp
    const gainScale = Math.pow(clampedVolume, 1.35);
    outputGain.gain.setValueAtTime(gainScale, ctx.currentTime);
    outputGain.connect(ctx.destination);

    switch (soundId) {
      case "singing-bowl":
        this.playSingingBowl(ctx, outputGain);
        break;
      case "tibetan-healing-bowl":
        this.playTibetanHealingBowl(ctx, outputGain);
        break;
      case "deep-gong":
        this.playDeepGong(ctx, outputGain);
        break;
      case "soft-chime":
        this.playSoftChime(ctx, outputGain);
        break;
      case "crystal-bowl":
        this.playCrystalBowl(ctx, outputGain);
        break;
      case "wood-block":
        this.playWoodBlock(ctx, outputGain);
        break;
    }
  }

  /**
   * Smoothly stops any currently playing breath cue or breath preview.
   */
  public stopBreathingCue(fadeSeconds: number = 0.2): void {
    if (this.breathPreviewTimeout) {
      clearTimeout(this.breathPreviewTimeout);
      this.breathPreviewTimeout = null;
    }
    this.clearBreathTimers();

    const kind = this.activeBreathKind;
    if (!kind) return;
    this.activeBreathKind = null;

    const audio = this.breathAudioElements[kind];
    if (!audio) return;

    const token = ++this.breathPlayTokens[kind];
    if (fadeSeconds <= 0 || audio.paused) {
      this.stopBreathElementImmediate(audio);
      return;
    }

    const startVolume = audio.volume;
    const steps = Math.max(3, Math.round((fadeSeconds * 1000) / 20));
    const stepMs = Math.max(12, Math.round((fadeSeconds * 1000) / steps));
    let currentStep = 0;

    this.breathFadeInterval = setInterval(() => {
      if (this.breathPlayTokens[kind] !== token) {
        this.clearBreathFadeInterval();
        return;
      }

      currentStep += 1;
      const ratio = Math.max(0, 1 - currentStep / steps);
      try {
        audio.volume = startVolume * ratio;
      } catch {
        // Ignore on platforms where HTMLAudioElement.volume is read-only
      }

      if (currentStep >= steps) {
        this.clearBreathFadeInterval();
        this.stopBreathElementImmediate(audio);
      }
    }, stepMs);
  }

  /**
   * Plays a short real inhale + exhale preview in the Breathing Cues sheet.
   */
  public previewBreathingCue(
    cueMode: BreathingCueMode,
    volume: number = 0.85
  ): void {
    this.stopBreathingCue(0.1);
    if (cueMode === "silent") return;

    if (cueMode === "chime") {
      this.playBreathingCue("inhale", "chime", volume, 2.0);
      return;
    }

    const inhaleSec = 2.6;
    const exhaleSec = 3.0;
    this.playBreathingCue("inhale", "tone", volume, inhaleSec);
    this.breathPreviewTimeout = setTimeout(() => {
      this.breathPreviewTimeout = null;
      this.playBreathingCue("exhale", "tone", volume, exhaleSec);
    }, Math.round((inhaleSec + 0.25) * 1000));
  }

  /**
   * Plays an eyes-closed breathing phase cue spanning the full duration of
   * inhale or exhale phases. Hold phases stay silent to preserve calm focus.
   */
  public playBreathingCue(
    phase: BreathingPhase,
    cueMode: BreathingCueMode,
    volume: number = 0.85,
    durationSec: number = 4.0
  ): void {
    this.stopBreathingCue(0.12);

    if (cueMode === "silent") return;
    if (phase === "holdIn" || phase === "holdOut") return;

    const clampedVolume = Math.min(1, Math.max(0, volume));
    if (clampedVolume <= 0.001) return;

    this.configurePlaybackAudioSession();

    if (cueMode === "chime") {
      this.playBellSound("soft-chime", clampedVolume * 0.45);
      return;
    }

    // "tone": denoised CC0 human breath sample scaled smoothly across the phase duration
    const kind: BreathSampleKind = phase === "inhale" ? "inhale" : "exhale";
    const audio = this.getOrCreateBreathAudio(kind);
    if (!audio) return;

    const targetDurationSec = Math.max(0.6, Math.min(12, durationSec));
    const sampleDurationSec =
      Number.isFinite(audio.duration) && audio.duration > 0.5
        ? audio.duration
        : BREATH_AUDIO_SOURCES[kind].nominalDurationSec;
    const playbackRate = computeBreathPlaybackRate(
      sampleDurationSec,
      targetDurationSec
    );

    const token = ++this.breathPlayTokens[kind];
    this.activeBreathKind = kind;
    this.clearBreathTimers();

    this.applyPreservePitch(audio);
    audio.muted = false;
    try {
      audio.volume = clampedVolume;
    } catch {
      // iOS Safari exposes read-only HTMLAudioElement.volume (hardware volume controls output)
    }
    try {
      audio.playbackRate = playbackRate;
    } catch {
      // Fallback to default 1x rate if browser rejects rate change before metadata loads
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore if media is still initializing
    }

    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        void playPromise
          .then(() => {
            this.breathAudioPrimed[kind] = true;
            if (this.breathPlayTokens[kind] !== token) return;
            // Re-apply exact rate once real audio.duration metadata is guaranteed ready
            if (Number.isFinite(audio.duration) && audio.duration > 0.5) {
              const refinedRate = computeBreathPlaybackRate(
                audio.duration,
                targetDurationSec
              );
              if (Math.abs(audio.playbackRate - refinedRate) > 0.02) {
                try {
                  audio.playbackRate = refinedRate;
                } catch {
                  // Ignore
                }
              }
            }
          })
          .catch(() => {
            // Gracefully ignore autoplay or headless browser playback rejections
            if (
              this.activeBreathKind === kind &&
              this.breathPlayTokens[kind] === token
            ) {
              this.activeBreathKind = null;
            }
          });
      }
    } catch {
      this.activeBreathKind = null;
      return;
    }

    // Ensure short phases (e.g. 1s custom where playbackRate caps at 2.0x) fade cleanly on time
    const fadeOutSec = Math.min(0.16, targetDurationSec * 0.25);
    const fadeStartMs = Math.max(
      120,
      Math.round((targetDurationSec - fadeOutSec) * 1000)
    );
    this.breathPhaseEndTimer = setTimeout(() => {
      this.breathPhaseEndTimer = null;
      if (
        this.activeBreathKind === kind &&
        this.breathPlayTokens[kind] === token
      ) {
        this.stopBreathingCue(fadeOutSec);
      }
    }, fadeStartMs);
  }

  private clearBreathFadeInterval(): void {
    if (this.breathFadeInterval) {
      clearInterval(this.breathFadeInterval);
      this.breathFadeInterval = null;
    }
  }

  private clearBreathTimers(): void {
    this.clearBreathFadeInterval();
    if (this.breathPhaseEndTimer) {
      clearTimeout(this.breathPhaseEndTimer);
      this.breathPhaseEndTimer = null;
    }
  }

  private stopBreathElementImmediate(audio: PitchPreservingAudioElement): void {
    try {
      audio.pause();
    } catch {
      // Ignore
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore
    }
    try {
      audio.volume = 1;
    } catch {
      // Ignore
    }
  }

  /**
   * Warm Tibetan singing bowl strike with harmonic partials and natural decay.
   */
  private playSingingBowl(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;
    const baseFreq = 216;
    const duration = 8.5;

    const partials: Array<{ ratio: number; gain: number; decay: number }> = [
      { ratio: 1.0, gain: 0.28, decay: duration },
      { ratio: 1.004, gain: 0.1, decay: duration * 0.9 },
      { ratio: 2.0, gain: 0.11, decay: duration * 0.72 },
      { ratio: 2.756, gain: 0.06, decay: duration * 0.55 },
      { ratio: 5.404, gain: 0.025, decay: duration * 0.35 },
    ];

    this.playHarmonicTone(
      ctx,
      destination,
      now,
      baseFreq,
      partials,
      {
        attack: 0.04,
        masterPeak: 0.85,
        duration,
      }
    );
  }

  /**
   * Deep hand-hammered Tibetan healing bowl with soft felt mallet strike,
   * paired doublet partials for authentic slow acoustic beating ("wah-wah" shimmer),
   * subtle stereo width, and a long resonant tail.
   */
  private playTibetanHealingBowl(
    ctx: AudioContext,
    destination: AudioNode
  ): void {
    const now = ctx.currentTime;
    const baseFreq = 174; // Grounding deep healing bowl fundamental (~F3)
    const duration = 13.5;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.88, now + 0.08);
    masterGain.gain.setValueAtTime(0.88, now + duration * 0.65);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(destination);

    // Subtle soft felt mallet strike transient
    const malletSource = ctx.createBufferSource();
    malletSource.buffer = this.getPinkNoiseBuffer(ctx);

    const malletFilter = ctx.createBiquadFilter();
    malletFilter.type = "bandpass";
    malletFilter.frequency.setValueAtTime(260, now);
    malletFilter.Q.setValueAtTime(1.4, now);

    const malletGain = ctx.createGain();
    malletGain.gain.setValueAtTime(0.0001, now);
    malletGain.gain.exponentialRampToValueAtTime(0.24, now + 0.008);
    malletGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    malletSource.connect(malletFilter);
    malletFilter.connect(malletGain);
    malletGain.connect(masterGain);

    malletSource.start(now);
    malletSource.stop(now + 0.09);

    // Paired detuned partials replicate hand-hammered bowl asymmetry & lush beating
    const partials: Array<{
      freq: number;
      gain: number;
      attack: number;
      decay: number;
      pan: number;
    }> = [
      // Fundamental doublet (0.9 Hz warm breathing pulse)
      { freq: baseFreq, gain: 0.28, attack: 0.06, decay: duration, pan: -0.18 },
      {
        freq: baseFreq + 0.9,
        gain: 0.22,
        attack: 0.09,
        decay: duration * 0.96,
        pan: 0.18,
      },
      // Second bowl mode (~2.76x, 1.6 Hz shimmer)
      {
        freq: baseFreq * 2.756,
        gain: 0.11,
        attack: 0.03,
        decay: duration * 0.82,
        pan: -0.25,
      },
      {
        freq: baseFreq * 2.756 + 1.6,
        gain: 0.09,
        attack: 0.05,
        decay: duration * 0.78,
        pan: 0.25,
      },
      // Third metallic overtone (~5.40x, 2.4 Hz airy shimmer)
      {
        freq: baseFreq * 5.404,
        gain: 0.048,
        attack: 0.015,
        decay: duration * 0.56,
        pan: -0.15,
      },
      {
        freq: baseFreq * 5.404 + 2.4,
        gain: 0.038,
        attack: 0.02,
        decay: duration * 0.52,
        pan: 0.15,
      },
      // High crystalline strike sparkle (~8.93x)
      {
        freq: baseFreq * 8.93,
        gain: 0.018,
        attack: 0.008,
        decay: duration * 0.3,
        pan: 0,
      },
    ];

    const supportsStereoPanner = typeof ctx.createStereoPanner === "function";

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const partialGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(partial.freq, now);

      partialGain.gain.setValueAtTime(0.0001, now);
      partialGain.gain.exponentialRampToValueAtTime(
        partial.gain,
        now + partial.attack
      );
      partialGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + partial.decay
      );

      osc.connect(partialGain);

      if (supportsStereoPanner && partial.pan !== 0) {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(partial.pan, now);
        partialGain.connect(panner);
        panner.connect(masterGain);
      } else {
        partialGain.connect(masterGain);
      }

      osc.start(now);
      osc.stop(now + partial.decay + 0.08);
    }
  }

  /**
   * Deep resonant temple gong with slow bloom and gentle metallic shimmer.
   */
  private playDeepGong(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;
    const baseFreq = 110;
    const duration = 11.0;

    const partials: Array<{ ratio: number; gain: number; decay: number }> = [
      { ratio: 1.0, gain: 0.32, decay: duration },
      { ratio: 1.007, gain: 0.16, decay: duration * 0.94 },
      { ratio: 1.498, gain: 0.12, decay: duration * 0.76 },
      { ratio: 2.02, gain: 0.08, decay: duration * 0.62 },
      { ratio: 2.71, gain: 0.045, decay: duration * 0.46 },
      { ratio: 3.65, gain: 0.022, decay: duration * 0.32 },
    ];

    this.playHarmonicTone(ctx, destination, now, baseFreq, partials, {
      attack: 0.09,
      masterPeak: 0.88,
      duration,
    });
  }

  /**
   * Delicate ting-sha / wind chime with airy upper partials.
   */
  private playSoftChime(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;
    const baseFreq = 880;
    const duration = 6.0;

    const partials: Array<{ ratio: number; gain: number; decay: number }> = [
      { ratio: 1.0, gain: 0.22, decay: duration },
      { ratio: 1.003, gain: 0.12, decay: duration * 0.92 },
      { ratio: 1.5, gain: 0.085, decay: duration * 0.68 },
      { ratio: 2.0, gain: 0.055, decay: duration * 0.5 },
      { ratio: 2.997, gain: 0.025, decay: duration * 0.32 },
    ];

    this.playHarmonicTone(ctx, destination, now, baseFreq, partials, {
      attack: 0.012,
      masterPeak: 0.62,
      duration,
    });
  }

  /**
   * Pure quartz crystal bowl with serene beating and smooth bloom.
   */
  private playCrystalBowl(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;
    const baseFreq = 432;
    const duration = 9.5;

    const partials: Array<{ ratio: number; gain: number; decay: number }> = [
      { ratio: 1.0, gain: 0.26, decay: duration },
      { ratio: 1.0028, gain: 0.19, decay: duration * 0.96 },
      { ratio: 2.0, gain: 0.055, decay: duration * 0.64 },
      { ratio: 3.0, gain: 0.02, decay: duration * 0.38 },
    ];

    this.playHarmonicTone(ctx, destination, now, baseFreq, partials, {
      attack: 0.14,
      masterPeak: 0.72,
      duration,
    });
  }

  /**
   * Crisp organic temple wood block (mokugyo) tap.
   */
  private playWoodBlock(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.75, now + 0.004);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    masterGain.connect(destination);

    // Resonant hollow wooden body
    const bodySpecs = [
      { freq: 680, endFreq: 645, gain: 0.42, decay: 0.3 },
      { freq: 1035, endFreq: 985, gain: 0.2, decay: 0.18 },
    ];

    for (const spec of bodySpecs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(spec.freq, now);
      osc.frequency.exponentialRampToValueAtTime(spec.endFreq, now + spec.decay);

      g.gain.setValueAtTime(spec.gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + spec.decay);

      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + spec.decay + 0.04);
    }

    // Brief woody mallet transient
    const clickSource = ctx.createBufferSource();
    clickSource.buffer = this.getWhiteNoiseBuffer(ctx);

    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = "bandpass";
    clickFilter.frequency.setValueAtTime(1900, now);
    clickFilter.Q.setValueAtTime(4.5, now);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.35, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    clickSource.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(masterGain);

    clickSource.start(now);
    clickSource.stop(now + 0.045);
  }

  private playHarmonicTone(
    ctx: AudioContext,
    destination: AudioNode,
    now: number,
    baseFreq: number,
    partials: Array<{ ratio: number; gain: number; decay: number }>,
    envelope: { attack: number; masterPeak: number; duration: number }
  ): void {
    // Master envelope shapes the attack and final tail fade without doubling
    // each partial's exponential decay rate.
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(
      envelope.masterPeak,
      now + envelope.attack
    );
    masterGain.gain.setValueAtTime(
      envelope.masterPeak,
      now + envelope.duration * 0.7
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + envelope.duration
    );
    masterGain.connect(destination);

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
      osc.stop(now + partial.decay + 0.08);
    }
  }

  private getWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (
      this.whiteNoiseBuffer &&
      this.whiteNoiseBuffer.sampleRate === ctx.sampleRate
    ) {
      return this.whiteNoiseBuffer;
    }

    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    this.whiteNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Generates a 5-second stereo pink noise buffer using Paul Kellet's filter.
   */
  private getPinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (
      this.pinkNoiseBuffer &&
      this.pinkNoiseBuffer.sampleRate === ctx.sampleRate
    ) {
      return this.pinkNoiseBuffer;
    }

    const length = ctx.sampleRate * 5;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      let peak = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const sample = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = sample;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
      }

      const scale = peak > 0 ? 0.85 / peak : 1;
      for (let i = 0; i < length; i++) {
        data[i] *= scale;
      }
    }

    this.pinkNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Generates a 5-second stereo brown (Brownian) noise buffer.
   */
  private getBrownNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (
      this.brownNoiseBuffer &&
      this.brownNoiseBuffer.sampleRate === ctx.sampleRate
    ) {
      return this.brownNoiseBuffer;
    }

    const length = ctx.sampleRate * 5;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let lastOut = 0;
      let peak = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut;
        const abs = Math.abs(lastOut);
        if (abs > peak) peak = abs;
      }

      const scale = peak > 0 ? 0.85 / peak : 1;
      for (let i = 0; i < length; i++) {
        data[i] *= scale;
      }
    }

    this.brownNoiseBuffer = buffer;
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

    this.teardownAmbientImmediate();

    const now = ctx.currentTime;
    const graph = this.buildAmbientGraph(ctx, soundId, now);

    const targetGain = this.mapVolumeToGain(volume, graph.gainCeiling);
    graph.masterGain.gain.setValueAtTime(0.0001, now);
    graph.masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, targetGain),
      now + Math.max(0.05, fadeInSeconds)
    );
    graph.masterGain.connect(ctx.destination);

    for (const source of graph.sources) {
      source.start(now);
    }

    this.ambientGraph = graph;
    this.activeSoundId = soundId;
  }

  private buildAmbientGraph(
    ctx: AudioContext,
    soundId: Exclude<AmbientSoundId, "silence">,
    now: number
  ): ActiveAmbientGraph {
    const masterGain = ctx.createGain();
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [masterGain];

    if (soundId === "white-noise") {
      const source = ctx.createBufferSource();
      source.buffer = this.getWhiteNoiseBuffer(ctx);
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2600, now);
      filter.Q.setValueAtTime(0.5, now);

      source.connect(filter);
      filter.connect(masterGain);

      sources.push(source);
      nodes.push(source, filter);
      return { sources, nodes, masterGain, gainCeiling: 0.28 };
    }

    if (soundId === "pink-noise") {
      const source = ctx.createBufferSource();
      source.buffer = this.getPinkNoiseBuffer(ctx);
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(3200, now);
      filter.Q.setValueAtTime(0.4, now);

      source.connect(filter);
      filter.connect(masterGain);

      sources.push(source);
      nodes.push(source, filter);
      return { sources, nodes, masterGain, gainCeiling: 0.36 };
    }

    if (soundId === "brown-noise") {
      const source = ctx.createBufferSource();
      source.buffer = this.getBrownNoiseBuffer(ctx);
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(850, now);
      filter.Q.setValueAtTime(0.5, now);

      source.connect(filter);
      filter.connect(masterGain);

      sources.push(source);
      nodes.push(source, filter);
      return { sources, nodes, masterGain, gainCeiling: 0.45 };
    }

    if (soundId === "gentle-rain") {
      // Base steady rain layer
      const baseSource = ctx.createBufferSource();
      baseSource.buffer = this.getPinkNoiseBuffer(ctx);
      baseSource.loop = true;

      const baseFilter = ctx.createBiquadFilter();
      baseFilter.type = "lowpass";
      baseFilter.frequency.setValueAtTime(1600, now);
      baseFilter.Q.setValueAtTime(0.4, now);

      const baseGain = ctx.createGain();
      baseGain.gain.setValueAtTime(0.75, now);

      baseSource.connect(baseFilter);
      baseFilter.connect(baseGain);
      baseGain.connect(masterGain);

      // Soft upper-frequency rainfall shimmer with slow organic modulation
      const patterSource = ctx.createBufferSource();
      patterSource.buffer = this.getWhiteNoiseBuffer(ctx);
      patterSource.loop = true;

      const patterFilter = ctx.createBiquadFilter();
      patterFilter.type = "bandpass";
      patterFilter.frequency.setValueAtTime(3400, now);
      patterFilter.Q.setValueAtTime(0.9, now);

      const patterGain = ctx.createGain();
      patterGain.gain.setValueAtTime(0.18, now);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.17, now);

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.06, now);

      lfo.connect(lfoGain);
      lfoGain.connect(patterGain.gain);

      patterSource.connect(patterFilter);
      patterFilter.connect(patterGain);
      patterGain.connect(masterGain);

      sources.push(baseSource, patterSource, lfo);
      nodes.push(
        baseSource,
        baseFilter,
        baseGain,
        patterSource,
        patterFilter,
        patterGain,
        lfo,
        lfoGain
      );
      return { sources, nodes, masterGain, gainCeiling: 0.36 };
    }

    if (soundId === "ocean-waves") {
      const source = ctx.createBufferSource();
      source.buffer = this.getBrownNoiseBuffer(ctx);
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(520, now);
      filter.Q.setValueAtTime(0.7, now);

      const swellGain = ctx.createGain();
      swellGain.gain.setValueAtTime(0.65, now);

      // Slow ~9s wave swell modulating both filter cutoff and amplitude
      const waveLfo = ctx.createOscillator();
      waveLfo.type = "sine";
      waveLfo.frequency.setValueAtTime(0.11, now);

      const filterLfoGain = ctx.createGain();
      filterLfoGain.gain.setValueAtTime(320, now);

      const ampLfoGain = ctx.createGain();
      ampLfoGain.gain.setValueAtTime(0.3, now);

      waveLfo.connect(filterLfoGain);
      filterLfoGain.connect(filter.frequency);

      waveLfo.connect(ampLfoGain);
      ampLfoGain.connect(swellGain.gain);

      source.connect(filter);
      filter.connect(swellGain);
      swellGain.connect(masterGain);

      sources.push(source, waveLfo);
      nodes.push(
        source,
        filter,
        swellGain,
        waveLfo,
        filterLfoGain,
        ampLfoGain
      );
      return { sources, nodes, masterGain, gainCeiling: 0.48 };
    }

    // "warm-drone": meditative tanpura-inspired harmonic pad
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(540, now);
    filter.Q.setValueAtTime(0.6, now);

    const droneLfo = ctx.createOscillator();
    droneLfo.type = "sine";
    droneLfo.frequency.setValueAtTime(0.08, now);

    const droneLfoGain = ctx.createGain();
    droneLfoGain.gain.setValueAtTime(110, now);
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(filter.frequency);

    const voices: Array<{
      freq: number;
      type: OscillatorType;
      gain: number;
    }> = [
      { freq: 108, type: "sine", gain: 0.34 },
      { freq: 108.35, type: "sine", gain: 0.2 },
      { freq: 162, type: "triangle", gain: 0.14 },
      { freq: 216, type: "sine", gain: 0.12 },
    ];

    for (const voice of voices) {
      const osc = ctx.createOscillator();
      const voiceGain = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, now);
      voiceGain.gain.setValueAtTime(voice.gain, now);
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      sources.push(osc);
      nodes.push(osc, voiceGain);
    }

    filter.connect(masterGain);
    sources.push(droneLfo);
    nodes.push(filter, droneLfo, droneLfoGain);

    return { sources, nodes, masterGain, gainCeiling: 0.34 };
  }

  /**
   * Smoothly adjusts ambient sound volume while playing.
   */
  public setAmbientVolume(volume: number): void {
    if (!this.ctx || !this.ambientGraph) return;
    const now = this.ctx.currentTime;
    const target = Math.max(
      0.0001,
      this.mapVolumeToGain(volume, this.ambientGraph.gainCeiling)
    );
    this.ambientGraph.masterGain.gain.cancelScheduledValues(now);
    this.ambientGraph.masterGain.gain.setTargetAtTime(target, now, 0.08);
  }

  /**
   * Smoothly fades out and stops the active ambient sound.
   */
  public stopAmbient(fadeOutSeconds = 0.8): void {
    this.clearPreviewTimer();
    this.isPreviewing = false;

    if (!this.ctx || !this.ambientGraph) {
      this.teardownAmbientImmediate();
      return;
    }

    const ctx = this.ctx;
    const graph = this.ambientGraph;

    this.ambientGraph = null;
    this.activeSoundId = "silence";

    const now = ctx.currentTime;
    const fade = Math.max(0.05, fadeOutSeconds);
    graph.masterGain.gain.cancelScheduledValues(now);
    graph.masterGain.gain.setValueAtTime(
      Math.max(0.0001, graph.masterGain.gain.value),
      now
    );
    graph.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);

    setTimeout(() => {
      this.disposeGraph(graph);
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
    this.cancelBellStrikes();
    this.stopBreathingCue(0);
    for (const kind of ["inhale", "exhale"] as const) {
      const audio = this.breathAudioElements[kind];
      if (audio) {
        this.stopBreathElementImmediate(audio);
        this.breathAudioElements[kind] = null;
      }
      this.breathAudioPrimed[kind] = false;
    }
    if (this.silentUnlockAudio) {
      try {
        this.silentUnlockAudio.pause();
      } catch {
        // Ignore
      }
      this.silentUnlockAudio = null;
    }
    this.silentSwitchUnlocked = false;
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

  private disposeGraph(graph: ActiveAmbientGraph): void {
    for (const source of graph.sources) {
      try {
        source.stop();
      } catch {
        // Ignore if already stopped
      }
    }
    for (const node of graph.nodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore if already disconnected
      }
    }
  }

  private teardownAmbientImmediate(): void {
    if (this.ambientGraph) {
      this.disposeGraph(this.ambientGraph);
      this.ambientGraph = null;
    }
    this.activeSoundId = "silence";
  }

  /**
   * Maps a [0, 1] UI slider value to a comfortable acoustic gain ceiling
   * using a quadratic curve for smooth perceived loudness control.
   */
  private mapVolumeToGain(volume: number, ceiling: number): number {
    const clamped = Math.min(1, Math.max(0, volume));
    return clamped * clamped * ceiling;
  }
}
