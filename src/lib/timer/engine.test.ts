import { describe, expect, it } from "vitest";
import {
  clampDurationMinutes,
  clampIntervalMinutes,
  computeElapsedMs,
  computeIntervalBellIndex,
  computeIntervalCount,
  computeOpenEndedIntervalBellIndex,
  computeProgress,
  computeRemainingMs,
  formatDurationLabel,
  formatElapsedDisplay,
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

  describe("clampIntervalMinutes", () => {
    it("clamps values to [1, 60]", () => {
      expect(clampIntervalMinutes(0)).toBe(1);
      expect(clampIntervalMinutes(-3)).toBe(1);
      expect(clampIntervalMinutes(Number.NaN)).toBe(1);
      expect(clampIntervalMinutes(90)).toBe(60);
      expect(clampIntervalMinutes(4.6)).toBe(5);
    });
  });

  describe("computeIntervalCount", () => {
    it("excludes both session start (0) and completion", () => {
      expect(computeIntervalCount(10, 5)).toBe(1);
      expect(computeIntervalCount(15, 5)).toBe(2);
      expect(computeIntervalCount(5, 5)).toBe(0);
      expect(computeIntervalCount(4, 5)).toBe(0);
    });

    it("handles non-divisible durations accurately", () => {
      expect(computeIntervalCount(7, 5)).toBe(1);
      expect(computeIntervalCount(11, 5)).toBe(2);
      expect(computeIntervalCount(10, 3)).toBe(3);
    });

    it("returns 0 for invalid or non-positive inputs", () => {
      expect(computeIntervalCount(0, 5)).toBe(0);
      expect(computeIntervalCount(10, 0)).toBe(0);
      expect(computeIntervalCount(10, -2)).toBe(0);
      expect(computeIntervalCount(Number.NaN, 5)).toBe(0);
    });
  });

  describe("computeIntervalBellIndex", () => {
    const tenMin = 10 * 60_000;
    const fifteenMin = 15 * 60_000;
    const fiveMin = 5 * 60_000;

    it("returns 0 at start and before the first interval mark", () => {
      expect(computeIntervalBellIndex(0, tenMin, fiveMin)).toBe(0);
      expect(computeIntervalBellIndex(fiveMin - 1, tenMin, fiveMin)).toBe(0);
    });

    it("advances index once each interval mark is crossed", () => {
      expect(computeIntervalBellIndex(fiveMin, fifteenMin, fiveMin)).toBe(1);
      expect(computeIntervalBellIndex(fiveMin + 500, fifteenMin, fiveMin)).toBe(
        1
      );
      expect(computeIntervalBellIndex(2 * fiveMin, fifteenMin, fiveMin)).toBe(
        2
      );
    });

    it("returns 0 at or past session completion so closing bell takes over", () => {
      expect(computeIntervalBellIndex(tenMin, tenMin, fiveMin)).toBe(0);
      expect(computeIntervalBellIndex(tenMin + 1000, tenMin, fiveMin)).toBe(0);
    });

    it("returns 0 when interval is greater than or equal to total duration", () => {
      expect(computeIntervalBellIndex(fiveMin - 1000, fiveMin, fiveMin)).toBe(
        0
      );
      expect(computeIntervalBellIndex(2 * 60_000, 4 * 60_000, fiveMin)).toBe(0);
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

  describe("computeOpenEndedIntervalBellIndex", () => {
    it("advances indefinitely without an upper session limit", () => {
      const fiveMin = 5 * 60_000;
      expect(computeOpenEndedIntervalBellIndex(0, fiveMin)).toBe(0);
      expect(computeOpenEndedIntervalBellIndex(fiveMin - 1, fiveMin)).toBe(0);
      expect(computeOpenEndedIntervalBellIndex(fiveMin, fiveMin)).toBe(1);
      expect(computeOpenEndedIntervalBellIndex(3 * fiveMin + 1000, fiveMin)).toBe(
        3
      );
      expect(computeOpenEndedIntervalBellIndex(-100, fiveMin)).toBe(0);
    });
  });

  describe("formatElapsedDisplay", () => {
    it("formats count-up elapsed time starting cleanly at 00:00", () => {
      expect(formatElapsedDisplay(0)).toBe("00:00");
      expect(formatElapsedDisplay(999)).toBe("00:00");
      expect(formatElapsedDisplay(1_000)).toBe("00:01");
      expect(formatElapsedDisplay(65_400)).toBe("01:05");
      expect(formatElapsedDisplay(3_661_000)).toBe("1:01:01");
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
