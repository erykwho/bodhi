import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BREATH_PLAYBACK_RATE,
  MIN_BREATH_PLAYBACK_RATE,
  MeditationAudioEngine,
  computeBreathPlaybackRate,
} from "./engine";

describe("computeBreathPlaybackRate", () => {
  it("computes exact proportional playback rates within WebKit's [0.5, 2.0] range", () => {
    expect(computeBreathPlaybackRate(3.61, 4.0)).toBeCloseTo(0.9025, 4);
    expect(computeBreathPlaybackRate(3.61, 5.5)).toBeCloseTo(0.6564, 3);
    expect(computeBreathPlaybackRate(3.98, 4.0)).toBeCloseTo(0.995, 3);
    expect(computeBreathPlaybackRate(3.98, 5.5)).toBeCloseTo(0.7236, 3);
    expect(computeBreathPlaybackRate(3.98, 2.0)).toBeCloseTo(1.99, 3);
  });

  it("clamps very long phases to MIN_BREATH_PLAYBACK_RATE (0.5x)", () => {
    expect(computeBreathPlaybackRate(3.61, 8.0)).toBe(MIN_BREATH_PLAYBACK_RATE);
    expect(computeBreathPlaybackRate(3.98, 8.0)).toBe(MIN_BREATH_PLAYBACK_RATE);
  });

  it("clamps very short phases to MAX_BREATH_PLAYBACK_RATE (2.0x)", () => {
    expect(computeBreathPlaybackRate(3.61, 1.0)).toBe(MAX_BREATH_PLAYBACK_RATE);
    expect(computeBreathPlaybackRate(3.98, 1.0)).toBe(MAX_BREATH_PLAYBACK_RATE);
  });

  it("returns 1 for invalid or non-positive durations", () => {
    expect(computeBreathPlaybackRate(0, 4)).toBe(1);
    expect(computeBreathPlaybackRate(3.61, 0)).toBe(1);
    expect(computeBreathPlaybackRate(Number.NaN, 4)).toBe(1);
    expect(computeBreathPlaybackRate(3.61, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("MeditationAudioEngine breath cues & iOS playback audioSession", () => {
  const originalAudio = globalThis.Audio;
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAudio === undefined) {
      delete (globalThis as { Audio?: typeof Audio }).Audio;
    } else {
      globalThis.Audio = originalAudio;
    }
    if (originalNavigator !== undefined) {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  });

  it("switches navigator.audioSession.type to 'playback' on unlock for iOS Silent Mode", () => {
    const audioSession = { type: "ambient" };
    Object.defineProperty(globalThis, "navigator", {
      value: { audioSession },
      configurable: true,
      writable: true,
    });

    const createdSources: string[] = [];
    class FakeAudio {
      src: string;
      preload = "";
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      paused = true;
      duration = 4.0;
      preservesPitch = false;
      setAttribute = vi.fn();
      play = vi.fn(() => {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      constructor(src: string) {
        this.src = src;
        createdSources.push(src);
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    const engine = new MeditationAudioEngine();
    engine.unlock();

    expect(audioSession.type).toBe("playback");
    expect(createdSources.some((s) => s.startsWith("data:audio/wav;base64,"))).toBe(true);
    expect(createdSources).toContain("/audio/breath-inhale.mp3");
    expect(createdSources).toContain("/audio/breath-exhale.mp3");

    engine.dispose();
  });

  it("plays denoised inhale/exhale audio scaled to phase duration and stays silent on hold phases", () => {
    const instances = new Map<string, FakeAudioInstance>();

    interface FakeAudioInstance {
      src: string;
      muted: boolean;
      volume: number;
      playbackRate: number;
      currentTime: number;
      paused: boolean;
      duration: number;
      preservesPitch: boolean;
      setAttribute: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    }

    class FakeAudio implements FakeAudioInstance {
      src: string;
      preload = "";
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      paused = true;
      duration: number;
      preservesPitch = false;
      setAttribute = vi.fn();
      play = vi.fn(() => {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      constructor(src: string) {
        this.src = src;
        this.duration = src.includes("inhale") ? 3.61 : 3.98;
        instances.set(src, this);
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    const engine = new MeditationAudioEngine();
    engine.playBreathingCue("inhale", "tone", 0.8, 5.5);

    const inhale = instances.get("/audio/breath-inhale.mp3");
    expect(inhale).toBeDefined();
    expect(inhale?.preservesPitch).toBe(true);
    expect(inhale?.muted).toBe(false);
    expect(inhale?.volume).toBeCloseTo(0.8, 3);
    expect(inhale?.playbackRate).toBeCloseTo(3.61 / 5.5, 3);
    expect(inhale?.play).toHaveBeenCalledTimes(1);

    // Hold phase must stay silent and stop active inhale cleanly
    engine.playBreathingCue("holdIn", "tone", 0.8, 4.0);
    expect(instances.get("/audio/breath-exhale.mp3")).toBeUndefined();

    // Exhale phase plays exhale sample scaled to 8s (clamped to 0.5x)
    engine.playBreathingCue("exhale", "tone", 0.9, 8.0);
    const exhale = instances.get("/audio/breath-exhale.mp3");
    expect(exhale).toBeDefined();
    expect(exhale?.preservesPitch).toBe(true);
    expect(exhale?.playbackRate).toBe(MIN_BREATH_PLAYBACK_RATE);
    expect(exhale?.play).toHaveBeenCalledTimes(1);

    engine.dispose();
  });
});
