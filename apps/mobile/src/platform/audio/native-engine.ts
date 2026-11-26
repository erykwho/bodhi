import { Asset } from "expo-asset";
import { setAudioModeAsync } from "expo-audio";
import {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  BiquadFilterNode,
  GainNode,
  OscillatorNode,
  PlaybackNotificationManager,
  decodeAudioData,
} from "react-native-audio-api";
import {
  BREATH_AUDIO_CATALOG,
  computeBreathPlaybackRate,
  MULTI_STRIKE_SPACING_MS,
  selectBreathDurationTier,
  type AudioUnlockOptions,
  type BreathDurationTier,
  type BreathSampleKind,
  type MeditationAudioPort,
} from "@bodhi/core/audio";
import {
  DEFAULT_END_BELL_ID,
  DEFAULT_START_BELL_ID,
  type AmbientSoundId,
  type BellSoundId,
} from "@bodhi/core/audio/sounds";
import type { BreathingCueMode, BreathingPhase } from "@bodhi/core/breathing/types";
import {
  AMBIENT_AUDIO_ASSETS,
  BELL_AUDIO_ASSETS,
  BREATH_AUDIO_ASSETS,
} from "./assets";

interface ActiveAmbientNodes {
  sources: Array<AudioBufferSourceNode | OscillatorNode>;
  masterGain: GainNode;
  gainCeiling: number;
}

interface ActiveBreathNodes {
  source: AudioBufferSourceNode;
  masterGain: GainNode;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

export interface LockScreenSessionInfo {
  title: string;
  artist?: string;
  durationSec?: number;
  elapsedSec?: number;
  state: "playing" | "paused";
}

/**
 * Native C++ Web Audio API engine (`react-native-audio-api`) implementing
 * `@bodhi/core`'s `MeditationAudioPort`.
 *
 * Features:
 * - True iOS Silent Switch bypass via `AVAudioSession.Category.playback` + `allowHaptics: true`
 * - True screen-locked background audio with ultra-low-power silent keep-alive for silent timers
 * - Lock Screen & Control Center Now Playing via `PlaybackNotificationManager`
 * - Polyphonic overlapping 1x/3x CC0 bells, seamless nature loops, real-time noise/drone DSP,
 *   and duration-matched variable-rate nasal breath cues.
 */
export class NativeMeditationAudioEngine implements MeditationAudioPort {
  private ctx: AudioContext | null = null;
  private decodedBuffers = new Map<string, AudioBuffer>();
  private loadingBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private noiseBuffers = new Map<string, AudioBuffer>();

  private activeSoundId: AmbientSoundId = "silence";
  private ambientNodes: ActiveAmbientNodes | null = null;
  private ambientPlayToken = 0;

  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;

  private activeBreath: ActiveBreathNodes | null = null;
  private breathPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private strikeTimers: Array<ReturnType<typeof setTimeout>> = [];
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private isPreviewing = false;
  private sessionConfigured = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state !== "running") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private configureNativeAudioSession(): void {
    if (this.sessionConfigured) return;
    this.sessionConfigured = true;

    try {
      AudioManager.setSystemOptions({
        ios: {
          category: "playback",
          mode: "default",
          allowHaptics: true,
          notifyOthersOnDeactivation: true,
        },
      });
      void AudioManager.setAudioSessionActivity(true).catch(() => {});
    } catch {
      // Safe no-op in non-native test runtimes
    }

    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => {});
  }

  private async loadBundledBuffer(
    cacheKey: string,
    assetModule: number
  ): Promise<AudioBuffer | null> {
    const cached = this.decodedBuffers.get(cacheKey);
    if (cached) return cached;

    const inflight = this.loadingBuffers.get(cacheKey);
    if (inflight) return inflight;

    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const asset = Asset.fromModule(assetModule);
        if (!asset.localUri) {
          await asset.downloadAsync();
        }
        const uri = asset.localUri ?? asset.uri;
        if (!uri) return null;

        const ctx = this.ensureContext();
        const buffer = await decodeAudioData(uri, ctx.sampleRate);
        this.decodedBuffers.set(cacheKey, buffer);
        return buffer;
      } catch {
        return null;
      } finally {
        this.loadingBuffers.delete(cacheKey);
      }
    })();

    this.loadingBuffers.set(cacheKey, task);
    return task;
  }

  public unlock(options?: AudioUnlockOptions): void {
    this.configureNativeAudioSession();
    this.ensureContext();

    const bells = options?.bells ?? [DEFAULT_START_BELL_ID, DEFAULT_END_BELL_ID];
    for (const bellId of bells) {
      const mod = BELL_AUDIO_ASSETS[bellId];
      if (mod) {
        void this.loadBundledBuffer(`bell:${bellId}`, mod);
      }
    }

    if (options?.ambientSound) {
      const ambientMod = AMBIENT_AUDIO_ASSETS[options.ambientSound];
      if (ambientMod) {
        void this.loadBundledBuffer(`ambient:${options.ambientSound}`, ambientMod);
      }
    }

    if (options?.inhaleSec !== undefined) {
      const tier = selectBreathDurationTier(options.inhaleSec);
      void this.loadBundledBuffer(
        `breath:inhale:${tier}`,
        BREATH_AUDIO_ASSETS.inhale[tier]
      );
    }
    if (options?.exhaleSec !== undefined) {
      const tier = selectBreathDurationTier(options.exhaleSec);
      void this.loadBundledBuffer(
        `breath:exhale:${tier}`,
        BREATH_AUDIO_ASSETS.exhale[tier]
      );
    }
  }

  /**
   * Keeps the iOS/Android background audio session alive during silent
   * meditation sessions so interval and closing bells ring accurately even
   * when the screen is locked.
   */
  public startBackgroundKeepAlive(): void {
    this.configureNativeAudioSession();
    if (this.keepAliveOsc) return;

    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 40;
    gain.gain.value = 0.00001; // Inaudible keep-alive pulse
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    this.keepAliveOsc = osc;
    this.keepAliveGain = gain;
  }

  public stopBackgroundKeepAlive(): void {
    if (this.keepAliveOsc) {
      try {
        this.keepAliveOsc.stop();
        this.keepAliveOsc.disconnect();
      } catch {
        // Ignore
      }
      this.keepAliveOsc = null;
    }
    if (this.keepAliveGain) {
      try {
        this.keepAliveGain.disconnect();
      } catch {
        // Ignore
      }
      this.keepAliveGain = null;
    }
  }

  public updateLockScreen(info: LockScreenSessionInfo): void {
    void PlaybackNotificationManager.show({
      title: info.title,
      artist: info.artist ?? "Bodhi Meditation",
      duration: info.durationSec,
      elapsedTime: info.elapsedSec ?? 0,
      state: info.state,
    }).catch(() => {});
  }

  public clearLockScreen(): void {
    void PlaybackNotificationManager.hide().catch(() => {});
  }

  public playBell(
    variant: "start" | "end" = "start",
    volume: number = 0.85
  ): void {
    this.playBellSound(
      variant === "start" ? DEFAULT_START_BELL_ID : DEFAULT_END_BELL_ID,
      volume
    );
  }

  public cancelBellStrikes(): void {
    for (const timer of this.strikeTimers) {
      clearTimeout(timer);
    }
    this.strikeTimers = [];
  }

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
      this.strikeTimers.push(timer);
    }
  }

  private activeBellPreview: {
    source: AudioBufferSourceNode;
    gain: GainNode;
  } | null = null;
  private bellPreviewToken = 0;

  private playDecodedBellBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    clampedVol: number,
    trackAsPreview: boolean = false
  ): void {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.pow(clampedVol, 0.85);
    source.connect(gain);
    gain.connect(ctx.destination);
    if (trackAsPreview) {
      this.activeBellPreview = { source, gain };
    }
    source.start();
  }

  public stopBellPreview(): void {
    this.bellPreviewToken += 1;
    const active = this.activeBellPreview;
    if (!active) return;
    this.activeBellPreview = null;
    try {
      active.source.stop();
      active.source.disconnect();
    } catch {
      // Ignore already-stopped nodes
    }
    try {
      active.gain.disconnect();
    } catch {
      // Ignore
    }
  }

  public previewBellSound(soundId: BellSoundId, volume: number = 0.85): void {
    this.stopPreview();
    if (soundId === "none") return;
    const clampedVol = Math.min(1, Math.max(0, volume));
    if (clampedVol <= 0.001) return;

    this.configureNativeAudioSession();
    const ctx = this.ensureContext();
    const token = ++this.bellPreviewToken;
    const cacheKey = `bell:${soundId}`;
    const cached = this.decodedBuffers.get(cacheKey);

    if (cached) {
      this.playDecodedBellBuffer(ctx, cached, clampedVol, true);
      return;
    }

    const mod = BELL_AUDIO_ASSETS[soundId];
    if (!mod) return;

    void this.loadBundledBuffer(cacheKey, mod).then((decoded) => {
      if (!decoded || this.ctx !== ctx || this.bellPreviewToken !== token) return;
      this.playDecodedBellBuffer(ctx, decoded, clampedVol, true);
    });
  }

  public playBellSound(soundId: BellSoundId, volume: number = 0.85): void {
    if (soundId === "none") return;
    const clampedVol = Math.min(1, Math.max(0, volume));
    if (clampedVol <= 0.001) return;

    this.configureNativeAudioSession();
    const ctx = this.ensureContext();
    const cacheKey = `bell:${soundId}`;
    const cached = this.decodedBuffers.get(cacheKey);

    if (cached) {
      this.playDecodedBellBuffer(ctx, cached, clampedVol);
      return;
    }

    // All bell recordings are bundled inside the native app (zero synth fallback)
    const mod = BELL_AUDIO_ASSETS[soundId];
    if (!mod) return;

    void this.loadBundledBuffer(cacheKey, mod).then((decoded) => {
      if (!decoded || this.ctx !== ctx) return;
      this.playDecodedBellBuffer(ctx, decoded, clampedVol);
    });
  }

  public stopBreathingCue(fadeSeconds: number = 0.2): void {
    if (this.breathPreviewTimer) {
      clearTimeout(this.breathPreviewTimer);
      this.breathPreviewTimer = null;
    }

    const active = this.activeBreath;
    if (!active) return;
    this.activeBreath = null;

    if (active.cleanupTimer) {
      clearTimeout(active.cleanupTimer);
    }

    try {
      const ctx = this.ctx;
      if (ctx) {
        const now = ctx.currentTime;
        const fade = Math.max(0.04, fadeSeconds);
        active.masterGain.gain.cancelScheduledValues(now);
        active.masterGain.gain.setValueAtTime(
          Math.max(0.0001, active.masterGain.gain.value),
          now
        );
        active.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        active.source.stop(now + fade + 0.02);
      } else {
        active.source.stop();
      }
    } catch {
      // Ignore already-stopped nodes
    }
  }

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
    this.breathPreviewTimer = setTimeout(() => {
      this.breathPreviewTimer = null;
      this.playBreathingCue("exhale", "tone", volume, exhaleSec);
    }, Math.round((inhaleSec + 0.25) * 1000));
  }

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

    if (cueMode === "chime") {
      this.playBellSound("soft-chime", clampedVolume * 0.45);
      return;
    }

    const kind: BreathSampleKind = phase === "inhale" ? "inhale" : "exhale";
    const tier: BreathDurationTier = selectBreathDurationTier(durationSec);
    const cacheKey = `breath:${kind}:${tier}`;
    const spec = BREATH_AUDIO_CATALOG[kind][tier];

    this.configureNativeAudioSession();
    const ctx = this.ensureContext();

    const playBuffer = (buffer: AudioBuffer) => {
      const source = ctx.createBufferSource();
      const masterGain = ctx.createGain();
      source.buffer = buffer;
      const nominal = buffer.duration > 0 ? buffer.duration : spec.nominalDurationSec;
      const rate = computeBreathPlaybackRate(nominal, durationSec);
      source.playbackRate.value = rate;

      const now = ctx.currentTime;
      const playDuration = Math.min(durationSec, nominal / rate);
      const peakGain = clampedVolume * (kind === "inhale" ? 0.65 : 0.6);

      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(peakGain, now + 0.12);
      masterGain.gain.setValueAtTime(
        peakGain,
        Math.max(now + 0.14, now + playDuration - 0.18)
      );
      masterGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + playDuration
      );

      source.connect(masterGain);
      masterGain.connect(ctx.destination);
      source.start(now);
      source.stop(now + playDuration + 0.04);

      const cleanupTimer = setTimeout(() => {
        if (this.activeBreath?.source === source) {
          this.activeBreath = null;
        }
      }, Math.ceil((playDuration + 0.1) * 1000));

      this.activeBreath = { source, masterGain, cleanupTimer };
    };

    const cached = this.decodedBuffers.get(cacheKey);
    if (cached) {
      playBuffer(cached);
    } else {
      void this.loadBundledBuffer(cacheKey, BREATH_AUDIO_ASSETS[kind][tier]).then(
        (buf) => {
          if (buf) playBuffer(buf);
        }
      );
    }
  }

  private getNoiseBuffer(
    ctx: AudioContext,
    kind: "white-noise" | "pink-noise" | "brown-noise"
  ): AudioBuffer {
    const cached = this.noiseBuffers.get(kind);
    if (cached) return cached;

    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 4;
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const output = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      let lastOut = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === "white-noise") {
          output[i] = white * 0.25;
        } else if (kind === "pink-noise") {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;
          output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
          b6 = white * 0.115926;
        } else {
          lastOut = (lastOut + 0.02 * white) / 1.02;
          output[i] = lastOut * 1.4;
        }
      }
    }

    this.noiseBuffers.set(kind, buffer);
    return buffer;
  }

  public startAmbient(
    soundId: AmbientSoundId,
    volume: number,
    fadeInSeconds = 1.0
  ): void {
    this.clearPreviewTimer();
    this.isPreviewing = false;

    if (soundId === "silence") {
      this.stopAmbient(0.5);
      return;
    }

    this.configureNativeAudioSession();
    const ctx = this.ensureContext();
    this.teardownAmbientImmediate();

    const token = ++this.ambientPlayToken;
    this.activeSoundId = soundId;

    const startGraph = (
      sources: Array<AudioBufferSourceNode | OscillatorNode>,
      masterGain: GainNode,
      gainCeiling: number
    ) => {
      if (token !== this.ambientPlayToken) {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // Ignore
          }
        }
        return;
      }

      const now = ctx.currentTime;
      const clampedVol = Math.min(1, Math.max(0, volume));
      const targetGain = Math.max(
        0.0001,
        Math.pow(clampedVol, 0.95) * gainCeiling
      );
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(
        targetGain,
        now + Math.max(0.1, fadeInSeconds)
      );
      masterGain.connect(ctx.destination);

      for (const s of sources) {
        s.start(now);
      }

      this.ambientNodes = { sources, masterGain, gainCeiling };
    };

    const assetMod = AMBIENT_AUDIO_ASSETS[soundId];
    if (assetMod) {
      void this.loadBundledBuffer(`ambient:${soundId}`, assetMod).then((buf) => {
        if (!buf || token !== this.ambientPlayToken) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const masterGain = ctx.createGain();
        src.connect(masterGain);
        startGraph([src], masterGain, 0.95);
      });
      return;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.getNoiseBuffer(
      ctx,
      soundId as "white-noise" | "pink-noise" | "brown-noise"
    );
    noiseSrc.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value =
      soundId === "white-noise"
        ? 2600
        : soundId === "pink-noise"
          ? 1600
          : 520;

    const masterGain = ctx.createGain();
    noiseSrc.connect(filter);
    filter.connect(masterGain);
    startGraph([noiseSrc], masterGain, 0.7);
  }

  public setAmbientVolume(volume: number): void {
    if (!this.ambientNodes || !this.ctx) return;
    const now = this.ctx.currentTime;
    const clampedVol = Math.min(1, Math.max(0, volume));
    const target = Math.max(
      0.0001,
      Math.pow(clampedVol, 0.95) * this.ambientNodes.gainCeiling
    );
    this.ambientNodes.masterGain.gain.cancelScheduledValues(now);
    this.ambientNodes.masterGain.gain.linearRampToValueAtTime(target, now + 0.12);
  }

  public stopAmbient(fadeOutSeconds = 0.8): void {
    this.ambientPlayToken++;
    this.activeSoundId = "silence";
    const active = this.ambientNodes;
    if (!active) return;
    this.ambientNodes = null;

    if (!this.ctx) {
      for (const s of active.sources) {
        try {
          s.stop();
        } catch {
          // Ignore
        }
      }
      return;
    }

    const now = this.ctx.currentTime;
    const fade = Math.max(0.05, fadeOutSeconds);
    active.masterGain.gain.cancelScheduledValues(now);
    active.masterGain.gain.setValueAtTime(
      Math.max(0.0001, active.masterGain.gain.value),
      now
    );
    active.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fade);

    setTimeout(() => {
      for (const s of active.sources) {
        try {
          s.stop();
          s.disconnect();
        } catch {
          // Ignore
        }
      }
      try {
        active.masterGain.disconnect();
      } catch {
        // Ignore
      }
    }, Math.ceil((fade + 0.08) * 1000));
  }

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

    this.previewTimer = setTimeout(() => {
      if (this.isPreviewing) {
        this.stopAmbient(0.5);
        this.isPreviewing = false;
        onEnded?.();
      }
    }, durationMs);
  }

  public stopPreview(): void {
    this.stopBellPreview();
    if (this.isPreviewing) {
      this.stopAmbient(0.3);
      this.isPreviewing = false;
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
    this.stopBreathingCue(0.05);
    this.teardownAmbientImmediate();
    this.stopBackgroundKeepAlive();
    this.clearLockScreen();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  private teardownAmbientImmediate(): void {
    const active = this.ambientNodes;
    if (!active) return;
    this.ambientNodes = null;
    for (const s of active.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // Ignore
      }
    }
    try {
      active.masterGain.disconnect();
    } catch {
      // Ignore
    }
  }
}

export const nativeAudioEngine = new NativeMeditationAudioEngine();
