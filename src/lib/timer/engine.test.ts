import { describe, expect, it } from "vitest";
import {
  clampDurationMinutes,
  computeElapsedMs,
  computeProgress,
  computeRemainingMs,
  formatDurationLabel,
  formatTimerDisplay,
} from "./engine";

describe("timer engine", () => {
  describe("clampDurationMinutes", () => {
    it("clamps values below minimum to 1 minute", () => {
      expect(clampDurationMinutes(0)).toBe(1);
      expect(clampDurationMinutes(-15)).toBe(1);
      expect(clampDurationMinutes(Number.NaN)).toBe(1);
    });

    it("clamps values above maximum to 180 minutes", () => {
      expect(clampDurationMinutes(240)).toBe(180);
    });

    it("rounds valid decimals to nearest integer", () => {
      expect(clampDurationMinutes(12.4)).toBe(12);
      expect(clampDurationMinutes(12.6)).toBe(13);
    });
  });

  describe("computeRemainingMs", () => {
    it("returns remaining milliseconds until target end time", () => {
      expect(computeRemainingMs(10_000, 3_500)).toBe(6_500);
    });

    it("never returns negative values after target time passes", () => {
      expect(computeRemainingMs(10_000, 12_500)).toBe(0);
    });
  });

  describe("computeProgress", () => {
    it("returns 0 at session start and 1 upon completion", () => {
      expect(computeProgress(600_000, 600_000)).toBe(0);
      expect(computeProgress(600_000, 0)).toBe(1);
    });

    it("computes fractional progress accurately", () => {
      expect(computeProgress(600_000, 300_000)).toBe(0.5);
    });

    it("handles non-positive total durations gracefully", () => {
      expect(computeProgress(0, 0)).toBe(1);
    });
  });

  describe("computeElapsedMs", () => {
    it("computes elapsed time within bounds", () => {
      expect(computeElapsedMs(600_000, 450_000)).toBe(150_000);
      expect(computeElapsedMs(600_000, 0)).toBe(600_000);
      expect(computeElapsedMs(600_000, 700_000)).toBe(0);
    });
  });

  describe("formatTimerDisplay", () => {
    it("formats MM:SS for durations under one hour", () => {
      expect(formatTimerDisplay(600_000)).toBe("10:00");
      expect(formatTimerDisplay(599_100)).toBe("10:00");
      expect(formatTimerDisplay(599_000)).toBe("09:59");
      expect(formatTimerDisplay(5_000)).toBe("00:05");
      expect(formatTimerDisplay(0)).toBe("00:00");
    });

    it("formats H:MM:SS for durations of one hour or more", () => {
      expect(formatTimerDisplay(3_600_000)).toBe("1:00:00");
      expect(formatTimerDisplay(5_430_000)).toBe("1:30:30");
    });
  });

  describe("formatDurationLabel", () => {
    it("formats minutes and hours cleanly", () => {
      expect(formatDurationLabel(10)).toBe("10 min");
      expect(formatDurationLabel(60)).toBe("1 h");
      expect(formatDurationLabel(90)).toBe("1 h 30 min");
    });
  });
});
