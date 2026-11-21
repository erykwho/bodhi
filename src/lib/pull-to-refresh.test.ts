import { describe, expect, it } from "vitest";
import {
  PULL_DEAD_ZONE,
  PULL_MAX_DISTANCE,
  PULL_THRESHOLD,
  calculatePullDistance,
  getPullPhase,
  getPullProgress,
} from "./pull-to-refresh";

describe("pull-to-refresh", () => {
  it("returns 0 inside or below the dead-zone", () => {
    expect(calculatePullDistance(-20)).toBe(0);
    expect(calculatePullDistance(0)).toBe(0);
    expect(calculatePullDistance(PULL_DEAD_ZONE)).toBe(0);
    expect(calculatePullDistance(Number.NaN)).toBe(0);
  });

  it("applies rubber-band damping up to PULL_MAX_DISTANCE", () => {
    const mid = calculatePullDistance(100);
    const large = calculatePullDistance(5000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(PULL_MAX_DISTANCE);
    expect(large).toBeLessThanOrEqual(PULL_MAX_DISTANCE);
  });

  it("resolves pull phases accurately", () => {
    expect(getPullPhase(0, false)).toBe("idle");
    expect(getPullPhase(20, false)).toBe("pulling");
    expect(getPullPhase(PULL_THRESHOLD, false)).toBe("ready");
    expect(getPullPhase(10, true)).toBe("refreshing");
  });

  it("computes normalized progress in [0, 1]", () => {
    expect(getPullProgress(-5)).toBe(0);
    expect(getPullProgress(0)).toBe(0);
    expect(getPullProgress(PULL_THRESHOLD / 2)).toBeCloseTo(0.5);
    expect(getPullProgress(PULL_THRESHOLD * 2)).toBe(1);
  });
});
