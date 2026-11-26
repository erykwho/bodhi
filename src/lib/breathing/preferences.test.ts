import { describe, expect, it } from "vitest";
import {
  DEFAULT_BREATHING_PREFERENCES,
  parseBreathingPreferences,
} from "./preferences";

describe("breathing preferences", () => {
  it("falls back safely on null, undefined, or malformed payloads", () => {
    expect(parseBreathingPreferences(null)).toEqual(
      DEFAULT_BREATHING_PREFERENCES
    );
    expect(parseBreathingPreferences("bad")).toEqual(
      DEFAULT_BREATHING_PREFERENCES
    );
  });

  it("parses legacy v1 payloads without mode or retention fields using safe defaults", () => {
    const parsed = parseBreathingPreferences({
      patternId: "4-7-8",
      customRhythm: {
        inhaleSec: 5,
        holdInSec: 3,
        exhaleSec: 7,
        holdOutSec: 1,
      },
      durationMinutes: 6,
      cueMode: "chime",
      hapticsEnabled: false,
      ambientSound: "ocean-waves",
      ambientVolume: 0.4,
    });

    expect(parsed).toEqual({
      mode: "rhythmic",
      patternId: "4-7-8",
      customRhythm: {
        inhaleSec: 5,
        holdInSec: 3,
        exhaleSec: 7,
        holdOutSec: 1,
      },
      durationMinutes: 6,
      retention: DEFAULT_BREATHING_PREFERENCES.retention,
      cueMode: "chime",
      hapticsEnabled: false,
      ambientSound: "ocean-waves",
      ambientVolume: 0.4,
    });
  });

  it("parses valid retention preferences, ignores legacy retentionMinuteChime, and clamps out-of-range values", () => {
    const parsed = parseBreathingPreferences({
      mode: "retention",
      retention: {
        rounds: 4,
        breathsPerRound: 40,
        pace: "fast",
        recoveryHoldSec: 18,
        retentionMinuteChime: true,
      },
    });

    expect(parsed.mode).toBe("retention");
    expect(parsed.retention).toEqual({
      rounds: 4,
      breathsPerRound: 40,
      pace: "fast",
      recoveryHoldSec: 18,
    });

    const sanitized = parseBreathingPreferences({
      mode: "unknown-mode",
      patternId: "unknown",
      durationMinutes: 120,
      retention: {
        rounds: 99,
        breathsPerRound: 3,
        pace: "turbo",
        recoveryHoldSec: 120,
        retentionMinuteChime: "nope",
      },
      cueMode: "loud",
      hapticsEnabled: "yes",
      ambientSound: "forest",
      ambientVolume: 2.5,
    });

    expect(sanitized.mode).toBe("rhythmic");
    expect(sanitized.patternId).toBe(DEFAULT_BREATHING_PREFERENCES.patternId);
    expect(sanitized.durationMinutes).toBe(30);
    expect(sanitized.retention).toEqual({
      rounds: 5,
      breathsPerRound: 15,
      pace: "standard",
      recoveryHoldSec: 20,
    });
    expect(sanitized.cueMode).toBe(DEFAULT_BREATHING_PREFERENCES.cueMode);
    expect(sanitized.hapticsEnabled).toBe(true);
    expect(sanitized.ambientSound).toBe("silence");
    expect(sanitized.ambientVolume).toBe(1);
  });
});
