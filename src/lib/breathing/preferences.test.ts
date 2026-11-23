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

  it("parses valid preferences and clamps out-of-range values", () => {
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

    const sanitized = parseBreathingPreferences({
      patternId: "unknown",
      durationMinutes: 120,
      cueMode: "loud",
      hapticsEnabled: "yes",
      ambientSound: "forest",
      ambientVolume: 2.5,
    });

    expect(sanitized.patternId).toBe(DEFAULT_BREATHING_PREFERENCES.patternId);
    expect(sanitized.durationMinutes).toBe(30);
    expect(sanitized.cueMode).toBe(DEFAULT_BREATHING_PREFERENCES.cueMode);
    expect(sanitized.hapticsEnabled).toBe(true);
    expect(sanitized.ambientSound).toBe("silence");
    expect(sanitized.ambientVolume).toBe(1);
  });
});
