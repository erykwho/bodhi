import { describe, expect, it } from "vitest";
import {
  computeCurrentStreak,
  computeHistoryStats,
  computeLongestStreak,
  formatSessionDuration,
  formatTotalTime,
} from "./stats";

function localIso(year: number, month: number, day: number, hour = 9): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

describe("meditation history stats", () => {
  describe("computeCurrentStreak", () => {
    it("returns 0 for empty sessions", () => {
      expect(computeCurrentStreak([], new Date(2026, 10, 21, 12))).toBe(0);
    });

    it("counts consecutive days ending today and deduplicates same-day sessions", () => {
      const now = new Date(2026, 10, 21, 14);
      const sessions = [
        { endedAt: localIso(2026, 11, 21, 8) },
        { endedAt: localIso(2026, 11, 21, 13) },
        { endedAt: localIso(2026, 11, 20, 9) },
        { endedAt: localIso(2026, 11, 19, 20) },
        { endedAt: localIso(2026, 11, 17, 9) },
      ];
      expect(computeCurrentStreak(sessions, now)).toBe(3);
    });

    it("preserves streak when the latest session was yesterday", () => {
      const now = new Date(2026, 10, 21, 8);
      const sessions = [
        { endedAt: localIso(2026, 11, 20, 19) },
        { endedAt: localIso(2026, 11, 19, 18) },
      ];
      expect(computeCurrentStreak(sessions, now)).toBe(2);
    });

    it("resets streak to 0 if neither today nor yesterday has a session", () => {
      const now = new Date(2026, 10, 21, 12);
      const sessions = [{ endedAt: localIso(2026, 11, 19, 10) }];
      expect(computeCurrentStreak(sessions, now)).toBe(0);
    });
  });

  describe("computeLongestStreak", () => {
    it("finds the longest consecutive run across history", () => {
      const sessions = [
        { endedAt: localIso(2026, 11, 1) },
        { endedAt: localIso(2026, 11, 2) },
        { endedAt: localIso(2026, 11, 3) },
        { endedAt: localIso(2026, 11, 4) },
        { endedAt: localIso(2026, 11, 10) },
        { endedAt: localIso(2026, 11, 11) },
      ];
      expect(computeLongestStreak(sessions)).toBe(4);
    });
  });

  describe("computeHistoryStats", () => {
    it("aggregates total sessions, total seconds, and streaks", () => {
      const now = new Date(2026, 10, 21, 15);
      const stats = computeHistoryStats(
        [
          { actualDurationSec: 600, endedAt: localIso(2026, 11, 21, 9) },
          { actualDurationSec: 900, endedAt: localIso(2026, 11, 20, 9) },
        ],
        now
      );
      expect(stats).toEqual({
        totalSessions: 2,
        totalSeconds: 1500,
        currentStreakDays: 2,
        longestStreakDays: 2,
      });
    });
  });

  describe("duration formatters", () => {
    it("formats total practice time cleanly", () => {
      expect(formatTotalTime(0)).toBe("0 min");
      expect(formatTotalTime(45)).toBe("< 1 min");
      expect(formatTotalTime(900)).toBe("15 min");
      expect(formatTotalTime(3600)).toBe("1 h");
      expect(formatTotalTime(5100)).toBe("1 h 25m");
    });

    it("formats individual session durations cleanly", () => {
      expect(formatSessionDuration(45)).toBe("45s");
      expect(formatSessionDuration(600)).toBe("10 min");
      expect(formatSessionDuration(630)).toBe("10m 30s");
      expect(formatSessionDuration(3600)).toBe("1 h");
      expect(formatSessionDuration(3900)).toBe("1 h 5m");
    });
  });
});
