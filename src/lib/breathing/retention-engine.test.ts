import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_BREATHING_PATTERN_LENGTH,
  clampRecoveryHoldSec,
  clampRetentionBreaths,
  clampRetentionConfig,
  clampRetentionRounds,
  computePowerBreathSnapshot,
  computeRecoverySnapshot,
  computeRetentionSummary,
  formatRetentionHistoryLabel,
  formatRetentionHoldCompact,
} from "./retention-engine";

describe("retention breathing engine", () => {
  it("clamps retention parameters safely within bounds", () => {
    expect(clampRetentionRounds(0)).toBe(1);
    expect(clampRetentionRounds(99)).toBe(5);
    expect(clampRetentionRounds(Number.NaN)).toBe(3);

    expect(clampRetentionBreaths(5)).toBe(15);
    expect(clampRetentionBreaths(90)).toBe(50);
    expect(clampRetentionBreaths(Number.NaN)).toBe(30);

    expect(clampRecoveryHoldSec(3)).toBe(10);
    expect(clampRecoveryHoldSec(40)).toBe(20);
    expect(clampRecoveryHoldSec(Number.NaN)).toBe(15);

    expect(
      clampRetentionConfig({
        rounds: 4,
        breathsPerRound: 40,
        pace: "fast",
        recoveryHoldSec: 18,
      })
    ).toEqual({
      rounds: 4,
      breathsPerRound: 40,
      pace: "fast",
      recoveryHoldSec: 18,
    });
  });

  it("computes drift-free power breath snapshots across inhale, exhale, last breath, and completion", () => {
    // Standard pace: 1.4s inhale + 1.1s exhale = 2.5s per breath
    const start = computePowerBreathSnapshot(0, "standard", 30);
    expect(start.breathNumber).toBe(1);
    expect(start.subPhase).toBe("inhale");
    expect(start.phaseStepIndex).toBe(0);
    expect(start.orbScale).toBeCloseTo(0, 5);
    expect(start.isLastBreath).toBe(false);
    expect(start.isComplete).toBe(false);

    // Mid-exhale of breath 1 (1400ms inhale + 550ms into 1100ms exhale)
    const exhale1 = computePowerBreathSnapshot(1950, "standard", 30);
    expect(exhale1.breathNumber).toBe(1);
    expect(exhale1.subPhase).toBe("exhale");
    expect(exhale1.phaseStepIndex).toBe(1);
    expect(exhale1.phaseProgress).toBeCloseTo(0.5, 2);
    expect(exhale1.orbScale).toBeCloseTo(0.5, 2);
    expect(exhale1.isComplete).toBe(false);

    // Breath 30 inhale (29 * 2500ms = 72500ms)
    const lastBreathInhale = computePowerBreathSnapshot(72600, "standard", 30);
    expect(lastBreathInhale.breathNumber).toBe(30);
    expect(lastBreathInhale.subPhase).toBe("inhale");
    expect(lastBreathInhale.isLastBreath).toBe(true);
    expect(lastBreathInhale.isComplete).toBe(false);

    // After all 30 breaths (30 * 2500ms = 75000ms)
    const done = computePowerBreathSnapshot(75000, "standard", 30);
    expect(done.breathNumber).toBe(30);
    expect(done.subPhase).toBe("exhale");
    expect(done.orbScale).toBe(0);
    expect(done.isLastBreath).toBe(true);
    expect(done.isComplete).toBe(true);
  });

  it("computes recovery inhale, recovery hold, and recovery exhale transitions", () => {
    const inhaleMid = computeRecoverySnapshot("recoveryInhale", 1000, 15);
    expect(inhaleMid.orbScale).toBeCloseTo(0.5, 2);
    expect(inhaleMid.isComplete).toBe(false);

    const inhaleEnd = computeRecoverySnapshot("recoveryInhale", 2000, 15);
    expect(inhaleEnd.orbScale).toBe(1);
    expect(inhaleEnd.isComplete).toBe(true);

    const holdStart = computeRecoverySnapshot("recoveryHold", 0, 15);
    expect(holdStart.orbScale).toBe(1);
    expect(holdStart.countdownSec).toBe(15);
    expect(holdStart.isComplete).toBe(false);

    const holdNearEnd = computeRecoverySnapshot("recoveryHold", 14200, 15);
    expect(holdNearEnd.countdownSec).toBe(1);
    expect(holdNearEnd.isComplete).toBe(false);

    const holdDone = computeRecoverySnapshot("recoveryHold", 15000, 15);
    expect(holdDone.countdownSec).toBe(0);
    expect(holdDone.isComplete).toBe(true);

    const exhaleMid = computeRecoverySnapshot("recoveryExhale", 1100, 15);
    expect(exhaleMid.orbScale).toBeCloseTo(0.5, 2);
    expect(exhaleMid.isComplete).toBe(false);

    const exhaleDone = computeRecoverySnapshot("recoveryExhale", 2200, 15);
    expect(exhaleDone.orbScale).toBe(0);
    expect(exhaleDone.isComplete).toBe(true);
  });

  it("computes retention hold summary statistics", () => {
    expect(computeRetentionSummary([])).toEqual({
      count: 0,
      longestSec: 0,
      averageSec: 0,
      totalHoldSec: 0,
    });

    expect(computeRetentionSummary([72, 100, 125])).toEqual({
      count: 3,
      longestSec: 125,
      averageSec: 99,
      totalHoldSec: 297,
    });
  });

  it("formats compact hold durations and canonical history labels within the 80-char API limit", () => {
    expect(formatRetentionHoldCompact(45)).toBe("0:45");
    expect(formatRetentionHoldCompact(125)).toBe("2:05");

    expect(
      formatRetentionHistoryLabel({
        completedRounds: 3,
        totalRounds: 3,
        breathsPerRound: 30,
        holdsSec: [72, 100, 125],
      })
    ).toBe("Retention 3×30 (1:12 · 1:40 · 2:05)");

    expect(
      formatRetentionHistoryLabel({
        completedRounds: 1,
        totalRounds: 3,
        breathsPerRound: 30,
        holdsSec: [65],
      })
    ).toBe("Retention 1/3×30 (1:05)");

    expect(
      formatRetentionHistoryLabel({
        completedRounds: 0,
        totalRounds: 3,
        breathsPerRound: 30,
        holdsSec: [],
      })
    ).toBe("Retention 3×30");

    // Even with many very long holds, always stays <= 80 chars
    const longLabel = formatRetentionHistoryLabel({
      completedRounds: 5,
      totalRounds: 5,
      breathsPerRound: 40,
      holdsSec: [600, 610, 620, 630, 640, 650, 660, 670, 680, 690],
    });
    expect(longLabel.length).toBeLessThanOrEqual(
      MAX_HISTORY_BREATHING_PATTERN_LENGTH
    );
  });
});
