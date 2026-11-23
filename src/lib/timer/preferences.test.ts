import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMER_PREFERENCES,
  parseTimerPreferences,
} from "./preferences";

describe("timer preferences", () => {
  it("returns defaults for null, undefined, or non-object payloads", () => {
    expect(parseTimerPreferences(null)).toEqual(DEFAULT_TIMER_PREFERENCES);
    expect(parseTimerPreferences(undefined)).toEqual(DEFAULT_TIMER_PREFERENCES);
    expect(parseTimerPreferences("invalid")).toEqual(DEFAULT_TIMER_PREFERENCES);
  });

  it("parses valid preferences accurately", () => {
    const parsed = parseTimerPreferences({
      durationMinutes: 20,
      openEnded: true,
      warmupSeconds: 10,
      startBell: "tibetan-healing-bowl",
      endBell: "none",
      endBellStrikes: 3,
      bellVolume: 0.7,
      intervalEnabled: true,
      intervalMinutes: 5,
      intervalBell: "wood-block",
      ambientSound: "gentle-rain",
      ambientVolume: 0.65,
    });

    expect(parsed).toEqual({
      durationMinutes: 20,
      openEnded: true,
      warmupSeconds: 10,
      startBell: "tibetan-healing-bowl",
      endBell: "none",
      endBellStrikes: 3,
      bellVolume: 0.7,
      intervalEnabled: true,
      intervalMinutes: 5,
      intervalBell: "wood-block",
      ambientSound: "gentle-rain",
      ambientVolume: 0.65,
    });
  });

  it("clamps numeric fields and falls back for unknown sound IDs or legacy shapes", () => {
    const parsed = parseTimerPreferences({
      durationMinutes: 999,
      openEnded: "yes",
      warmupSeconds: 99,
      startBell: "unknown-bell",
      endBell: 123,
      endBellStrikes: 5,
      bellVolume: 1.5,
      intervalEnabled: "yes",
      intervalMinutes: 0,
      intervalBell: "none",
      ambientSound: "thunderstorm",
      ambientVolume: 1.5,
    });

    expect(parsed).toEqual({
      durationMinutes: 180,
      openEnded: false,
      warmupSeconds: DEFAULT_TIMER_PREFERENCES.warmupSeconds,
      startBell: DEFAULT_TIMER_PREFERENCES.startBell,
      endBell: DEFAULT_TIMER_PREFERENCES.endBell,
      endBellStrikes: DEFAULT_TIMER_PREFERENCES.endBellStrikes,
      bellVolume: 1,
      intervalEnabled: false,
      intervalMinutes: 1,
      intervalBell: DEFAULT_TIMER_PREFERENCES.intervalBell,
      ambientSound: DEFAULT_TIMER_PREFERENCES.ambientSound,
      ambientVolume: 1,
    });
  });
});
