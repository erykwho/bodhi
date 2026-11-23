import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BREATH_AUDIO_CATALOG,
  MAX_BREATH_PLAYBACK_RATE,
  MIN_BREATH_PLAYBACK_RATE,
  MeditationAudioEngine,
  computeBreathPlaybackRate,
  selectBreathDurationTier,
} from "./engine";

describe("selectBreathDurationTier", () => {
  it("selects short tier (giddster) for phases up to 2.2s", () => {
    expect(selectBreathDurationTier(1.0)).toBe("short");
    expect(selectBreathDurationTier(1.5)).toBe("short");
    expect(selectBreathDurationTier(2.2)).toBe("short");
  });

  it("selects medium tier (thomasXkiteXforXlife) for 2.3s–4.5s phases", () => {
    expect(selectBreathDurationTier(2.5)).toBe("medium");
    expect(selectBreathDurationTier(3.0)).toBe("medium");
    expect(selectBreathDurationTier(4.0)).toBe("medium");
    expect(selectBreathDurationTier(4.5)).toBe("medium");
  });

  it("selects long tier (thomasXkiteXforXlife multi-take) for phases over 4.5s", () => {
    expect(selectBreathDurationTier(5.0)).toBe("long");
    expect(selectBreathDurationTier(5.5)).toBe("long");
    expect(selectBreathDurationTier(8.0)).toBe("long");
  });

  it("falls back to medium for invalid durations", () => {
    expect(selectBreathDurationTier(0)).toBe("medium");
    expect(selectBreathDurationTier(-2)).toBe("medium");
    expect(selectBreathDurationTier(Number.NaN)).toBe("medium");
  });
});

describe("computeBreathPlaybackRate", () => {
  it("keeps multi-sample playback rates inside the natural sweet spot across 1s–8s", () => {
    // 1s–2s short (giddster)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.short.nominalDurationSec, 1.0)
    ).toBeCloseTo(1.23, 2);
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.exhale.short.nominalDurationSec, 2.0)
    ).toBeCloseTo(0.635, 2);

    // 4s Box (thomas medium)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.medium.nominalDurationSec, 4.0)
    ).toBeCloseTo(0.7475, 3);
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.exhale.medium.nominalDurationSec, 4.0)
    ).toBeCloseTo(0.765, 3);

    // 5.5s Coherent & 8s 4-7-8 exhale (thomas long)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.long.nominalDurationSec, 5.5)
    ).toBeCloseTo(0.947, 2);
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.exhale.long.nominalDurationSec, 8.0)
    ).toBeCloseTo(0.681, 2);
  });

  it("clamps extreme ratios to WebKit's [0.5, 2.0] range", () => {
    expect(computeBreathPlaybackRate(2.0, 10.0)).toBe(MIN_BREATH_PLAYBACK_RATE);
    expect(computeBreathPlaybackRate(5.0, 1.0)).toBe(MAX_BREATH_PLAYBACK_RATE);
  });

  it("returns 1 for invalid or non-positive durations", () => {
    expect(computeBreathPlaybackRate(0, 4)).toBe(1);
    expect(computeBreathPlaybackRate(3.0, 0)).toBe(1);
    expect(computeBreathPlaybackRate(Number.NaN, 4)).toBe(1);
    expect(computeBreathPlaybackRate(3.0, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("MeditationAudioEngine multi-sample breath cues & iOS playback audioSession", () => {
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

  it("switches navigator.audioSession.type to 'playback' and primes rhythm-matched tiers on unlock", () => {
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
      duration = 3.0;
      preservesPitch = false;
      setAttribute = vi.fn();
      load = vi.fn();
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
    // 4-7-8 breathing: 4s inhale (medium), 8s exhale (long)
    engine.unlock({ inhaleSec: 4, exhaleSec: 8 });

    expect(audioSession.type).toBe("playback");
    expect(createdSources.some((s) => s.startsWith("data:audio/wav;base64,"))).toBe(true);
    expect(createdSources).toContain("/audio/breath-inhale-medium.mp3");
    expect(createdSources).toContain("/audio/breath-exhale-long.mp3");

    engine.dispose();
  });

  it("switches seamlessly between short, medium, and long breath tiers and stays silent on holds", () => {
    const created: FakeAudioInstance[] = [];

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
      load: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    }

    const durationForSrc = (src: string): number => {
      if (src.includes("inhale-short")) return 1.23;
      if (src.includes("exhale-short")) return 1.27;
      if (src.includes("inhale-medium")) return 2.99;
      if (src.includes("exhale-medium")) return 3.06;
      if (src.includes("inhale-long")) return 5.21;
      if (src.includes("exhale-long")) return 5.45;
      return 3.0;
    };

    class FakeAudio implements FakeAudioInstance {
      private _src: string;
      preload = "";
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      paused = true;
      duration: number;
      preservesPitch = false;
      setAttribute = vi.fn();
      load = vi.fn();
      play = vi.fn(() => {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      constructor(src: string) {
        this._src = src;
        this.duration = durationForSrc(src);
        created.push(this);
      }
      get src() {
        return this._src;
      }
      set src(next: string) {
        this._src = next;
        this.duration = durationForSrc(next);
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    const engine = new MeditationAudioEngine();

    // Short inhale (1.5s) -> giddster short sample
    engine.playBreathingCue("inhale", "tone", 0.8, 1.5);
    const inhaleEl = created[0];
    expect(inhaleEl?.src).toBe("/audio/breath-inhale-short.mp3");
    expect(inhaleEl?.preservesPitch).toBe(true);
    expect(inhaleEl?.playbackRate).toBeCloseTo(1.23 / 1.5, 3);

    // Switch to long inhale (5.5s Coherent) -> reuses same element and swaps to thomas long
    engine.playBreathingCue("inhale", "tone", 0.8, 5.5);
    expect(inhaleEl?.src).toBe("/audio/breath-inhale-long.mp3");
    expect(inhaleEl?.load).toHaveBeenCalledTimes(1);
    expect(inhaleEl?.playbackRate).toBeCloseTo(5.21 / 5.5, 3);

    // Hold phase stays silent
    engine.playBreathingCue("holdIn", "tone", 0.8, 4.0);
    expect(created).toHaveLength(1);

    // 8s exhale -> thomas long exhale at ~0.68x (never hits harsh 0.5x floor)
    engine.playBreathingCue("exhale", "tone", 0.9, 8.0);
    const exhaleEl = created[1];
    expect(exhaleEl?.src).toBe("/audio/breath-exhale-long.mp3");
    expect(exhaleEl?.playbackRate).toBeCloseTo(5.45 / 8.0, 3);

    engine.dispose();
  });
});
