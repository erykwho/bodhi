import { describe, expect, it } from "vitest";
import { DEFAULT_TIMER_PREFERENCES } from "./preferences";
import {
  MAX_PRESET_NAME_LENGTH,
  doesPresetMatchPreferences,
  formatPresetSummary,
  sanitizePresetName,
} from "./presets";

describe("timer presets", () => {
  it("sanitizes whitespace and clamps long preset names", () => {
    expect(sanitizePresetName("   Morning   Calm  ")).toBe("Morning Calm");
    expect(sanitizePresetName("A".repeat(60))).toHaveLength(
      MAX_PRESET_NAME_LENGTH
    );
  });

  it("matches presets accurately while ignoring disabled interval/silence details", () => {
    const preset = {
      preferences: {
        ...DEFAULT_TIMER_PREFERENCES,
        durationMinutes: 15,
        intervalEnabled: false,
        intervalMinutes: 3,
        ambientSound: "silence" as const,
        ambientVolume: 0.2,
      },
    };

    expect(
      doesPresetMatchPreferences(preset, {
        ...DEFAULT_TIMER_PREFERENCES,
        durationMinutes: 15,
        intervalEnabled: false,
        intervalMinutes: 7,
        ambientSound: "silence",
        ambientVolume: 0.8,
      })
    ).toBe(true);

    expect(
      doesPresetMatchPreferences(preset, {
        ...DEFAULT_TIMER_PREFERENCES,
        durationMinutes: 20,
      })
    ).toBe(false);
  });

  it("formats compact preset summaries", () => {
    expect(formatPresetSummary(DEFAULT_TIMER_PREFERENCES)).toBe("10m");
    expect(
      formatPresetSummary({
        ...DEFAULT_TIMER_PREFERENCES,
        openEnded: true,
        ambientSound: "ocean-waves",
      })
    ).toBe("Open · Ocean Waves");
    expect(
      formatPresetSummary({
        ...DEFAULT_TIMER_PREFERENCES,
        durationMinutes: 20,
        ambientSound: "gentle-rain",
        intervalEnabled: true,
        intervalMinutes: 5,
      })
    ).toBe("20m · Gentle Rain · Every 5m");
  });
});
