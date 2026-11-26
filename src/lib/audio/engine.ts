import {
  BREATH_AUDIO_CATALOG,
  computeBreathPlaybackRate,
  MAX_BREATH_PLAYBACK_RATE,
  MIN_BREATH_PLAYBACK_RATE,
  MULTI_STRIKE_SPACING_MS,
  selectBreathDurationTier,
  type AudioUnlockOptions,
  type BreathDurationTier,
  type BreathSampleKind,
  type BreathUnlockOptions,
  type MeditationAudioPort,
} from "@bodhi/core/audio";
import {
  getAmbientSoundOption,
  getBellSoundOption,
  type AmbientSoundId,
  type BellSoundId,
} from "@/lib/audio/sounds";
import type { BreathingCueMode, BreathingPhase } from "@/lib/breathing/types";

export {
  BREATH_AUDIO_CATALOG,
  computeBreathPlaybackRate,
  MAX_BREATH_PLAYBACK_RATE,
  MIN_BREATH_PLAYBACK_RATE,
  selectBreathDurationTier,
  type AudioUnlockOptions,
  type BreathDurationTier,
  type BreathUnlockOptions,
  type MeditationAudioPort,
};

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: string;
  };
};

interface ActiveAmbientGraph {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  masterGain: GainNode;
  gainCeiling: number;
}

interface ActiveBreathBufferCue {
  source: AudioBufferSourceNode;
  masterGain: GainNode;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Valid 50ms silent 8kHz mono PCM WAV played once on user gesture to switch
 * pre-iOS 16.4 Safari AVAudioSession from "ambient" to "playback" so Web Audio
 * bells, breath buffers, and ambient loops remain audible with the Silent switch ON.
 */
const SILENT_UNLOCK_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

/**
 * Self-contained offline-first Web Audio API engine for meditation bells,
 * ambient soundscapes, and decoded in-RAM multi-sample CC0 human nasal breath cues.
 * Configures iOS "playback" audio session so all practice audio plays reliably
 * even when the device's hardware Silent switch is enabled — without relying on
 * HTML5 <audio> (AVPlayer) for recurring breathing phase playback.
 */
export class MeditationAudioEngine implements MeditationAudioPort {
  private ctx: AudioContext | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private brownNoiseBuffer: AudioBuffer | null = null;
  private ambientGraph: ActiveAmbientGraph | null = null;
  private ambientPlayToken = 0;
  private ambientVolume = 0.35;
  private audioBuffers = new Map<string, AudioBuffer>();
  private audioBufferLoads = new Map<string, Promise<AudioBuffer | null>>();
  private activeBreathCue: ActiveBreathBufferCue | null = null;
  private breathPlayToken = 0;
  private breathPreviewTimeout: ReturnType<typeof setTimeout> | null = null;
  private silentUnlockAudio: HTMLAudioElement | null = null;
  private silentSwitchUnlocked = false;
  private activeSoundId: AmbientSoundId = "silence";
  private isPreviewing = false;
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;
  private bellStrikeTimeouts: Array<ReturnType<typeof setTimeout>> = [];
  private activeBellPreview: {
    source: AudioBufferSourceNode | null;
    outputGain: GainNode;
  } | null = null;
  private bellPreviewToken = 0;

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
   * older iOS Safari / standalone PWA sessions into the "playback" AVAudioSession category.
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

  private decodeAudioBuffer(
    ctx: AudioContext,
    arrayBuffer: ArrayBuffer
  ): Promise<AudioBuffer> {
    // Copy buffer so repeated/fallback decode attempts never hit a detached ArrayBuffer
    const copy = arrayBuffer.slice(0);
    return new Promise<AudioBuffer>((resolve, reject) => {
      try {
        const maybePromise = ctx.decodeAudioData(
          copy,
          (decoded) => resolve(decoded),
          (err) => reject(err)
        );
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise.then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Fetches and decodes a bundled MP3 sample (bell, nature ambient, or breath cue)
   * into an in-memory Web Audio AudioBuffer (served from Service Worker cache offline).
   */
  private loadAudioBuffer(
    ctx: AudioContext,
    src: string
  ): Promise<AudioBuffer | null> {
    const cached = this.audioBuffers.get(src);
    if (cached) return Promise.resolve(cached);

    const inflight = this.audioBufferLoads.get(src);
    if (inflight) return inflight;

    if (typeof fetch === "undefined") {
      return Promise.resolve(null);
    }

    const loadPromise = fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => this.decodeAudioBuffer(ctx, buf))
      .then((decoded) => {
        // Keep buffer only if engine wasn't disposed while decoding
        if (this.ctx === ctx) {
          this.audioBuffers.set(src, decoded);
        }
        return decoded;
      })
      .catch(() => {
        this.audioBufferLoads.delete(src);
        return null;
      });

    this.audioBufferLoads.set(src, loadPromise);
    return loadPromise;
  }

  /**
   * Preloads the inhale & exhale AudioBuffers for the active rhythm on user gesture
   * so every phase transition plays from RAM with zero latency and zero AVPlayer glitches.
   */
  private preloadBreathBuffers(
    ctx: AudioContext,
    options?: BreathUnlockOptions
  ): void {
    const inhaleTier =
      options?.inhaleSec !== undefined
        ? selectBreathDurationTier(options.inhaleSec)
        : "medium";
    const exhaleTier =
      options?.exhaleSec !== undefined
        ? selectBreathDurationTier(options.exhaleSec)
        : "medium";

    void this.loadAudioBuffer(ctx, BREATH_AUDIO_CATALOG.inhale[inhaleTier].src);
    void this.loadAudioBuffer(ctx, BREATH_AUDIO_CATALOG.exhale[exhaleTier].src);
  }

  private preloadBellBuffers(ctx: AudioContext, bells: BellSoundId[]): void {
    const seen = new Set<string>();
    for (const id of bells) {
      const option = getBellSoundOption(id);
      if (option.kind === "file" && option.src && !seen.has(option.src)) {
        seen.add(option.src);
        void this.loadAudioBuffer(ctx, option.src);
      }
    }
  }

  private preloadAmbientBuffer(
    ctx: AudioContext,
    ambientSound: AmbientSoundId
  ): void {
    const option = getAmbientSoundOption(ambientSound);
    if (option.kind === "file" && option.src) {
      void this.loadAudioBuffer(ctx, option.src);
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

    // Resume both "suspended" and iOS Safari's proprietary "interrupted" state
    if (this.ctx.state !== "running") {
      try {
        const res = this.ctx.resume();
        if (res && typeof res.catch === "function") {
          void res.catch(() => {
            // Ignore autoplay restriction outside user gesture
          });
        }
      } catch {
        // Ignore if context is already closing
      }
    }

    return this.ctx;
  }

  /**
   * Unlocks the AudioContext, enables iOS "playback" audio session (Silent switch bypass),
   * and preloads in-memory AudioBuffers for active breathing cues, bells, and nature ambients.
   */
  public unlock(options?: AudioUnlockOptions): void {
    this.configurePlaybackAudioSession();
    const ctx = this.ensureContext();
    this.unlockSilentSwitchBridge();
    if (!ctx || !options) return;

    if (options.inhaleSec !== undefined || options.exhaleSec !== undefined) {
      this.preloadBreathBuffers(ctx, options);
    }
    if (options.bells && options.bells.length > 0) {
      this.preloadBellBuffers(ctx, options.bells);
    }
    if (options.ambientSound && options.ambientSound !== "silence") {
      this.preloadAmbientBuffer(ctx, options.ambientSound);
    }
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

  private isOffline(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.onLine === "boolean" &&
      navigator.onLine === false
    );
  }

  private playBellBufferNode(
    ctx: AudioContext,
    buffer: AudioBuffer,
    outputGain: GainNode,
    trackAsPreview: boolean = false
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);
    if (trackAsPreview) {
      this.activeBellPreview = { source, outputGain };
    }
    source.onended = () => {
      if (trackAsPreview && this.activeBellPreview?.source === source) {
        this.activeBellPreview = null;
      }
      try {
        source.disconnect();
      } catch {
        // Ignore
      }
      try {
        outputGain.disconnect();
      } catch {
        // Ignore
      }
    };
    source.start(ctx.currentTime);
  }

  /**
   * Immediately stops any active bell preview sound and cancels pending async decodes.
   */
  public stopBellPreview(): void {
    this.bellPreviewToken += 1;
    const active = this.activeBellPreview;
    if (!active) return;
    this.activeBellPreview = null;

    if (active.source) {
      try {
        active.source.stop();
      } catch {
        // Ignore already-stopped nodes
      }
      try {
        active.source.disconnect();
      } catch {
        // Ignore
      }
    }
    try {
      active.outputGain.disconnect();
    } catch {
      // Ignore
    }
  }

  /**
   * Plays an exclusive bell preview, stopping any active bell or ambient preview first
   * so two preview sounds never overlap.
   */
  public previewBellSound(soundId: BellSoundId, volume: number = 0.85): void {
    this.stopPreview();
    if (soundId === "none") return;
    const clampedVolume = Math.min(1, Math.max(0, volume));
    if (clampedVolume <= 0.001) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const token = ++this.bellPreviewToken;
    const outputGain = ctx.createGain();
    const gainScale = Math.pow(clampedVolume, 0.85);
    outputGain.gain.setValueAtTime(gainScale, ctx.currentTime);
    outputGain.connect(ctx.destination);

    const option = getBellSoundOption(soundId);
    if (option.kind === "file" && option.src) {
      const cached = this.audioBuffers.get(option.src);
      if (cached) {
        this.playBellBufferNode(ctx, cached, outputGain, true);
        return;
      }

      void this.loadAudioBuffer(ctx, option.src).then((decoded) => {
        if (this.ctx !== ctx || this.bellPreviewToken !== token) {
          try {
            outputGain.disconnect();
          } catch {
            // Ignore
          }
          return;
        }
        if (decoded) {
          this.playBellBufferNode(ctx, decoded, outputGain, true);
          return;
        }
        if (this.isOffline()) {
          this.activeBellPreview = { source: null, outputGain };
          this.playSynthBellFallback(ctx, soundId, outputGain);
        } else {
          try {
            outputGain.disconnect();
          } catch {
            // Ignore
          }
        }
      });
      return;
    }

    if (this.isOffline()) {
      this.activeBellPreview = { source: null, outputGain };
      this.playSynthBellFallback(ctx, soundId, outputGain);
    } else {
      try {
        outputGain.disconnect();
      } catch {
        // Ignore
      }
    }
  }

  private playSynthBellFallback(
    ctx: AudioContext,
    soundId: BellSoundId,
    outputGain: GainNode
  ): void {
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
      case "wood-block":
        this.playWoodBlock(ctx, outputGain);
        break;
    }
  }

  /**
   * Plays a meditation chime/bell by catalog ID at the given volume [0, 1].
   * Always loads and plays the real acoustic AudioBuffer (from RAM or Service Worker
   * cache / network). Web Audio synthesis is used strictly as an offline-only fallback
   * if the audio asset cannot be loaded while disconnected.
   */
  public playBellSound(soundId: BellSoundId, volume: number = 0.85): void {
    if (soundId === "none") return;
    const clampedVolume = Math.min(1, Math.max(0, volume));
    if (clampedVolume <= 0.001) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const outputGain = ctx.createGain();
    // Fuller curve so bells project clearly across typical slider positions (50%-100%)
    const gainScale = Math.pow(clampedVolume, 0.85);
    outputGain.gain.setValueAtTime(gainScale, ctx.currentTime);
    outputGain.connect(ctx.destination);

    const option = getBellSoundOption(soundId);
    if (option.kind === "file" && option.src) {
      const cached = this.audioBuffers.get(option.src);
      if (cached) {
        this.playBellBufferNode(ctx, cached, outputGain);
        return;
      }

      void this.loadAudioBuffer(ctx, option.src).then((decoded) => {
        if (this.ctx !== ctx) {
          try {
            outputGain.disconnect();
          } catch {
            // Ignore
          }
          return;
        }
        if (decoded) {
          this.playBellBufferNode(ctx, decoded, outputGain);
          return;
        }
        if (this.isOffline()) {
          this.playSynthBellFallback(ctx, soundId, outputGain);
        } else {
          try {
            outputGain.disconnect();
          } catch {
            // Ignore
          }
        }
      });
      return;
    }

    if (this.isOffline()) {
      this.playSynthBellFallback(ctx, soundId, outputGain);
    } else {
      try {
        outputGain.disconnect();
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Smoothly stops any currently playing breath cue or breath preview via Web Audio GainNode.
   */
  public stopBreathingCue(fadeSeconds: number = 0.2): void {
    if (this.breathPreviewTimeout) {
      clearTimeout(this.breathPreviewTimeout);
      this.breathPreviewTimeout = null;
    }
    this.breathPlayToken += 1;

    const active = this.activeBreathCue;
    if (!active) return;
    this.activeBreathCue = null;

    if (active.cleanupTimer) {
      clearTimeout(active.cleanupTimer);
      active.cleanupTimer = null;
    }

    const ctx = this.ctx;
    if (!ctx || fadeSeconds <= 0) {
      this.disposeBreathCueImmediate(active);
      return;
    }

    const now = ctx.currentTime;
    const fade = Math.max(0.03, fadeSeconds);
    try {
      active.masterGain.gain.cancelScheduledValues(now);
      active.masterGain.gain.setValueAtTime(
        Math.max(0.0001, active.masterGain.gain.value),
        now
      );
      active.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      active.source.stop(now + fade + 0.02);
    } catch {
      this.disposeBreathCueImmediate(active);
      return;
    }

    setTimeout(
      () => this.disposeBreathCueImmediate(active),
      Math.ceil((fade + 0.08) * 1000)
    );
  }

  /**
   * Plays a natural inhale + exhale preview in the Breathing Cues sheet.
   */
  public previewBreathingCue(
    cueMode: BreathingCueMode,
    volume: number = 0.85,
    inhaleSec: number = 3.2,
    exhaleSec: number = 3.4
  ): void {
    this.stopBreathingCue(0.1);
    if (cueMode === "silent") return;

    if (cueMode === "chime") {
      this.playBreathingCue("inhale", "chime", volume, 2.0);
      return;
    }

    this.playBreathingCue("inhale", "tone", volume, inhaleSec);
    this.breathPreviewTimeout = setTimeout(() => {
      this.breathPreviewTimeout = null;
      this.playBreathingCue("exhale", "tone", volume, exhaleSec);
    }, Math.round((inhaleSec + 0.25) * 1000));
  }

  /**
   * Plays an eyes-closed breathing phase cue spanning the full duration of
   * inhale or exhale phases directly from decoded Web Audio RAM buffers.
   * Hold phases stay silent to preserve calm focus.
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

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (cueMode === "chime") {
      this.playBellSound("soft-chime", clampedVolume * 0.45);
      return;
    }

    const kind: BreathSampleKind = phase === "inhale" ? "inhale" : "exhale";
    const targetDurationSec = Math.max(0.6, Math.min(12, durationSec));
    const tier = selectBreathDurationTier(targetDurationSec);
    const spec = BREATH_AUDIO_CATALOG[kind][tier];
    const token = ++this.breathPlayToken;
    const triggeredAtMs = Date.now();

    const cached = this.audioBuffers.get(spec.src);
    if (cached) {
      this.startBreathBufferNode(
        ctx,
        cached,
        targetDurationSec,
        clampedVolume,
        0,
        token
      );
      return;
    }

    // First-ever play before decode completes (~15-30ms from SW cache): decode & sync to elapsed time
    void this.loadAudioBuffer(ctx, spec.src).then((decoded) => {
      if (!decoded || this.breathPlayToken !== token || this.ctx !== ctx) {
        return;
      }
      const elapsedSec = Math.max(0, (Date.now() - triggeredAtMs) / 1000);
      if (targetDurationSec - elapsedSec < 0.25) return;
      this.startBreathBufferNode(
        ctx,
        decoded,
        targetDurationSec,
        clampedVolume,
        elapsedSec,
        token
      );
    });
  }

  private startBreathBufferNode(
    ctx: AudioContext,
    buffer: AudioBuffer,
    targetDurationSec: number,
    volume: number,
    elapsedSec: number,
    token: number
  ): void {
    if (this.breathPlayToken !== token) return;
    if (ctx.state !== "running") {
      try {
        const res = ctx.resume();
        if (res && typeof res.catch === "function") {
          void res.catch(() => {});
        }
      } catch {
        // Ignore
      }
    }

    const playbackRate = computeBreathPlaybackRate(
      buffer.duration,
      targetDurationSec
    );
    const offsetSec = Math.min(
      Math.max(0, elapsedSec * playbackRate),
      Math.max(0, buffer.duration - 0.1)
    );
    const remainingPhaseSec = Math.max(0.15, targetDurationSec - elapsedSec);
    const naturalRemainingSec = Math.max(
      0.1,
      (buffer.duration - offsetSec) / playbackRate
    );
    const playSec = Math.min(remainingPhaseSec, naturalRemainingSec);

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, now);

    const masterGain = ctx.createGain();
    const targetGain = Math.pow(volume, 1.15) * 1.15;
    const fadeInSec = Math.min(0.05, playSec * 0.2);
    const fadeOutSec = Math.min(0.18, playSec * 0.3);
    const holdUntilSec = Math.max(fadeInSec, playSec - fadeOutSec);

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(targetGain, now + fadeInSec);
    masterGain.gain.setValueAtTime(targetGain, now + holdUntilSec);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + playSec);

    source.connect(masterGain);
    masterGain.connect(ctx.destination);

    const cue: ActiveBreathBufferCue = {
      source,
      masterGain,
      cleanupTimer: null,
    };

    source.onended = () => {
      if (cue.cleanupTimer) {
        clearTimeout(cue.cleanupTimer);
        cue.cleanupTimer = null;
      }
      if (this.activeBreathCue === cue) {
        this.activeBreathCue = null;
      }
      this.disposeBreathCueImmediate(cue);
    };

    cue.cleanupTimer = setTimeout(() => {
      cue.cleanupTimer = null;
      if (this.activeBreathCue === cue) {
        this.activeBreathCue = null;
      }
      this.disposeBreathCueImmediate(cue);
    }, Math.ceil((playSec + 0.25) * 1000));

    this.activeBreathCue = cue;
    source.start(now, offsetSec);
    source.stop(now + playSec + 0.04);
  }

  private disposeBreathCueImmediate(cue: ActiveBreathBufferCue): void {
    try {
      cue.source.onended = null;
      cue.source.stop();
    } catch {
      // Ignore if already stopped
    }
    try {
      cue.source.disconnect();
    } catch {
      // Ignore if already disconnected
    }
    try {
      cue.masterGain.disconnect();
    } catch {
      // Ignore if already disconnected
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

  private activateAmbientGraph(
    ctx: AudioContext,
    graph: ActiveAmbientGraph,
    volume: number,
    fadeInSeconds: number
  ): void {
    const now = ctx.currentTime;
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
  }

  /**
   * Starts looping the chosen ambient sound with a smooth fade-in.
   * For file-backed nature soundscapes (Gentle Rain, Ocean Waves), always loads and
   * plays the real stereo recording (from RAM or Service Worker cache / network).
   * Web Audio synthesis is used strictly as an offline-only fallback if the asset
   * cannot be loaded while disconnected.
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

    const token = ++this.ambientPlayToken;
    this.ambientVolume = volume;
    this.activeSoundId = soundId;

    const option = getAmbientSoundOption(soundId);
    if (option.kind === "file" && option.src) {
      const cachedBuffer = this.audioBuffers.get(option.src);
      if (cachedBuffer) {
        const graph = this.buildFileAmbientGraph(ctx, cachedBuffer);
        this.activateAmbientGraph(ctx, graph, volume, fadeInSeconds);
        return;
      }

      void this.loadAudioBuffer(ctx, option.src).then((decoded) => {
        if (
          this.ambientPlayToken !== token ||
          this.ctx !== ctx ||
          this.activeSoundId !== soundId
        ) {
          return;
        }
        if (decoded) {
          const graph = this.buildFileAmbientGraph(ctx, decoded);
          this.activateAmbientGraph(
            ctx,
            graph,
            this.ambientVolume,
            fadeInSeconds
          );
          return;
        }
        if (this.isOffline()) {
          const fallbackGraph = this.buildAmbientGraph(
            ctx,
            soundId,
            ctx.currentTime
          );
          this.activateAmbientGraph(
            ctx,
            fallbackGraph,
            this.ambientVolume,
            fadeInSeconds
          );
        }
      });
      return;
    }

    const graph = this.buildAmbientGraph(ctx, soundId, ctx.currentTime);
    this.activateAmbientGraph(ctx, graph, volume, fadeInSeconds);
  }

  private buildFileAmbientGraph(
    ctx: AudioContext,
    buffer: AudioBuffer
  ): ActiveAmbientGraph {
    const masterGain = ctx.createGain();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(masterGain);

    return {
      sources: [source],
      nodes: [masterGain, source],
      masterGain,
      gainCeiling: 0.95,
    };
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
      return { sources, nodes, masterGain, gainCeiling: 0.36 };
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
      return { sources, nodes, masterGain, gainCeiling: 0.5 };
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
      return { sources, nodes, masterGain, gainCeiling: 0.68 };
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

    // "ocean-waves": slow ~9s wave swell modulating both filter cutoff and amplitude
    const source = ctx.createBufferSource();
    source.buffer = this.getBrownNoiseBuffer(ctx);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520, now);
    filter.Q.setValueAtTime(0.7, now);

    const swellGain = ctx.createGain();
    swellGain.gain.setValueAtTime(0.65, now);

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

  /**
   * Smoothly adjusts ambient sound volume while playing.
   */
  public setAmbientVolume(volume: number): void {
    this.ambientVolume = volume;
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
    this.ambientPlayToken += 1;

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
    this.stopBellPreview();
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
    this.stopBellPreview();
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
    this.stopBellPreview();
    this.cancelBellStrikes();
    this.stopBreathingCue(0);
    this.ambientPlayToken += 1;
    this.audioBuffers.clear();
    this.audioBufferLoads.clear();
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
    this.ambientPlayToken += 1;
    if (this.ambientGraph) {
      this.disposeGraph(this.ambientGraph);
      this.ambientGraph = null;
    }
    this.activeSoundId = "silence";
  }

  /**
   * Maps a [0, 1] UI slider value to a comfortable acoustic gain ceiling
   * using a near-linear curve (volume^0.95) so background soundscapes remain
   * naturally balanced with the meditation bells across 30%-100% slider positions.
   */
  private mapVolumeToGain(volume: number, ceiling: number): number {
    const clamped = Math.min(1, Math.max(0, volume));
    return Math.pow(clamped, 0.95) * ceiling;
  }
}
