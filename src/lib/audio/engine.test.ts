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

  it("selects medium tier (thomasXkiteXforXlife) for 2.3s–4.6s phases", () => {
    expect(selectBreathDurationTier(2.5)).toBe("medium");
    expect(selectBreathDurationTier(3.0)).toBe("medium");
    expect(selectBreathDurationTier(4.0)).toBe("medium");
    expect(selectBreathDurationTier(4.6)).toBe("medium");
  });

  it("selects long tier (thomasXkiteXforXlife multi-take) for phases over 4.6s", () => {
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
  it("keeps Web Audio multi-sample playback rates near 1.0x across official presets", () => {
    // 1.5s short (giddster)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.short.nominalDurationSec, 1.5)
    ).toBeCloseTo(0.967, 2);

    // 4s Box (thomas medium ~3.7s -> ~0.92x–0.94x)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.medium.nominalDurationSec, 4.0)
    ).toBeCloseTo(0.915, 3);
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.exhale.medium.nominalDurationSec, 4.0)
    ).toBeCloseTo(0.935, 3);

    // 5.5s Coherent & 8s 4-7-8 exhale (thomas long ~6.2s -> 1.12x / 0.78x)
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.inhale.long.nominalDurationSec, 5.5)
    ).toBeCloseTo(1.124, 2);
    expect(
      computeBreathPlaybackRate(BREATH_AUDIO_CATALOG.exhale.long.nominalDurationSec, 8.0)
    ).toBeCloseTo(0.784, 2);
  });

  it("clamps extreme ratios to [0.5, 2.0]", () => {
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

interface MockSourceNode {
  buffer: AudioBuffer | null;
  playbackRate: { setValueAtTime: ReturnType<typeof vi.fn> };
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function createFakeAudioContext(initialState: string = "running") {
  const createdSources: MockSourceNode[] = [];
  const ctx = {
    state: initialState,
    currentTime: 10,
    destination: {},
    resume: vi.fn(() => {
      ctx.state = "running";
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    decodeAudioData: vi.fn((ab: ArrayBuffer) => {
      // Encode mock duration in the first float64 of the ArrayBuffer
      const view = new Float64Array(ab);
      const duration = view[0] || 3.66;
      return Promise.resolve({ duration } as AudioBuffer);
    }),
    createBufferSource: vi.fn(() => {
      const node: MockSourceNode = {
        buffer: null,
        playbackRate: { setValueAtTime: vi.fn() },
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      createdSources.push(node);
      return node;
    }),
    createGain: vi.fn(() => ({
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
  return { ctx, createdSources };
}

function makeDurationBuffer(durationSec: number): ArrayBuffer {
  const ab = new ArrayBuffer(8);
  new Float64Array(ab)[0] = durationSec;
  return ab;
}

describe("MeditationAudioEngine Web Audio breath buffers & iOS resilience", () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      globalThis.window = originalWindow;
    }
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
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  });

  it("sets playback audioSession, resumes iOS interrupted AudioContext, and preloads rhythm-matched buffers", async () => {
    const audioSession = { type: "ambient" };
    Object.defineProperty(globalThis, "navigator", {
      value: { audioSession },
      configurable: true,
      writable: true,
    });

    const { ctx } = createFakeAudioContext("interrupted");
    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      AudioContext: vi.fn(function () {
        return ctx;
      }),
    };

    const audioElementSources: string[] = [];
    class FakeAudio {
      src: string;
      preload = "";
      volume = 1;
      setAttribute = vi.fn();
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        audioElementSources.push(src);
      }
    }
    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    const fetchedUrls: string[] = [];
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const s = String(url);
      fetchedUrls.push(s);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(makeDurationBuffer(s.includes("long") ? 6.27 : 3.66)),
      } as Response);
    }) as typeof fetch;

    const engine = new MeditationAudioEngine();
    // 4-7-8 breathing: 4s inhale (medium) + 8s exhale (long)
    engine.unlock({ inhaleSec: 4, exhaleSec: 8 });
    await Promise.resolve();
    await Promise.resolve();

    expect(audioSession.type).toBe("playback");
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    // Only the 50ms silent WAV unlock uses HTMLAudioElement; breath MP3s are decoded into Web Audio RAM
    expect(audioElementSources).toHaveLength(1);
    expect(audioElementSources[0]).toMatch(/^data:audio\/wav;base64,/);
    expect(fetchedUrls).toContain("/audio/breath-inhale-medium.mp3");
    expect(fetchedUrls).toContain("/audio/breath-exhale-long.mp3");

    engine.dispose();
  });

  it("plays breath cues directly from cached Web Audio AudioBuffers across tiers without re-fetching", async () => {
    const { ctx, createdSources } = createFakeAudioContext("running");
    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      AudioContext: vi.fn(function () {
        return ctx;
      }),
    };

    const durationMap: Record<string, number> = {
      "/audio/breath-inhale-short.mp3": 1.45,
      "/audio/breath-inhale-medium.mp3": 3.66,
      "/audio/breath-exhale-long.mp3": 6.27,
    };

    const fetchSpy = vi.fn((url: string | URL | Request) => {
      const s = String(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(makeDurationBuffer(durationMap[s] ?? 3.66)),
      } as Response);
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const engine = new MeditationAudioEngine();

    // Preload medium inhale + long exhale (4-7-8)
    engine.unlock({ inhaleSec: 4, exhaleSec: 8 });
    await new Promise((r) => setTimeout(r, 0));

    // Play 4s inhale synchronously from RAM buffer (no extra fetch!)
    const fetchesAfterPreload = fetchSpy.mock.calls.length;
    engine.playBreathingCue("inhale", "tone", 0.85, 4.0);
    expect(fetchSpy.mock.calls.length).toBe(fetchesAfterPreload);
    expect(createdSources).toHaveLength(1);
    expect(createdSources[0]?.playbackRate.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(3.66 / 4.0, 3),
      10
    );
    expect(createdSources[0]?.start).toHaveBeenCalledWith(10, 0);

    // Hold phase must stay silent
    engine.playBreathingCue("holdIn", "tone", 0.85, 7.0);
    expect(createdSources).toHaveLength(1);

    // Play 8s exhale synchronously from RAM buffer
    engine.playBreathingCue("exhale", "tone", 0.9, 8.0);
    expect(createdSources).toHaveLength(2);
    expect(createdSources[1]?.playbackRate.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(6.27 / 8.0, 3),
      10
    );

    // Switching to short 1.5s inhale fetches short sample once and plays it
    engine.playBreathingCue("inhale", "tone", 0.8, 1.5);
    await new Promise((r) => setTimeout(r, 0));
    expect(createdSources).toHaveLength(3);
    expect(createdSources[2]?.playbackRate.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(1.45 / 1.5, 3),
      10
    );

    engine.dispose();
  });
});
