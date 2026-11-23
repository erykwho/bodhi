import { describe, expect, it } from "vitest";
import {
  buildBreathingSegments,
  clampBreathingDurationMinutes,
  clampBreathingRhythm,
  computeBreathingSnapshot,
  estimateTotalCycles,
  formatBreathingHistoryLabel,
  formatBreathingRhythm,
  getCycleDurationMs,
  resolveBreathingRhythm,
} from "./engine";
import { BREATHING_PRESETS } from "./types";

describe("breathing engine", () => {
  it("clamps duration and custom rhythm values into safe bounds", () => {
    expect(clampBreathingDurationMinutes(0)).toBe(1);
    expect(clampBreathingDurationMinutes(99)).toBe(30);
    expect(clampBreathingDurationMinutes(Number.NaN)).toBe(1);

    expect(
      clampBreathingRhythm({
        inhaleSec: 0,
        holdInSec: -2,
        exhaleSec: 40,
        holdOutSec: 25,
      })
    ).toEqual({
      inhaleSec: 1,
      holdInSec: 0,
      exhaleSec: 20,
      holdOutSec: 15,
    });
  });

  it("omits zero-second hold phases from active breathing segments", () => {
    expect(buildBreathingSegments(BREATHING_PRESETS.box)).toHaveLength(4);
    expect(buildBreathingSegments(BREATHING_PRESETS["4-7-8"])).toHaveLength(3);
    expect(buildBreathingSegments(BREATHING_PRESETS.coherent)).toHaveLength(2);
    expect(getCycleDurationMs(BREATHING_PRESETS.coherent)).toBe(11_000);
  });

  it("computes drift-free phase transitions, cycle count, and orb scale", () => {
    const box = BREATHING_PRESETS.box; // 4-4-4-4 => 16s cycle

    const start = computeBreathingSnapshot(0, box);
    expect(start.phase).toBe("inhale");
    expect(start.cycleNumber).toBe(1);
    expect(start.phaseCountdownSec).toBe(4);
    expect(start.orbScale).toBeCloseTo(0, 3);

    const midInhale = computeBreathingSnapshot(2000, box);
    expect(midInhale.phase).toBe("inhale");
    expect(midInhale.orbScale).toBeCloseTo(0.5, 2);

    const holdIn = computeBreathingSnapshot(5000, box);
    expect(holdIn.phase).toBe("holdIn");
    expect(holdIn.orbScale).toBe(1);

    const exhale = computeBreathingSnapshot(10_000, box);
    expect(exhale.phase).toBe("exhale");
    expect(exhale.orbScale).toBeCloseTo(0.5, 2);

    const holdOut = computeBreathingSnapshot(14_000, box);
    expect(holdOut.phase).toBe("holdOut");
    expect(holdOut.orbScale).toBe(0);

    const secondCycle = computeBreathingSnapshot(16_500, box);
    expect(secondCycle.phase).toBe("inhale");
    expect(secondCycle.cycleNumber).toBe(2);
    expect(secondCycle.completedCycles).toBe(1);
    expect(secondCycle.phaseStepIndex).toBe(4);
  });

  it("estimates cycle count and formats rhythm and history labels cleanly", () => {
    expect(estimateTotalCycles(3, BREATHING_PRESETS.box)).toBe(11);
    expect(formatBreathingRhythm(BREATHING_PRESETS.box)).toBe("4 · 4 · 4 · 4");
    expect(formatBreathingRhythm(BREATHING_PRESETS["4-7-8"])).toBe("4 · 7 · 8");
    expect(formatBreathingRhythm(BREATHING_PRESETS.coherent)).toBe("5.5 · 5.5");

    expect(formatBreathingHistoryLabel("box", BREATHING_PRESETS.box)).toBe(
      "Box 4-4-4-4"
    );
    expect(
      formatBreathingHistoryLabel("4-7-8", BREATHING_PRESETS["4-7-8"])
    ).toBe("4-7-8");
    expect(
      formatBreathingHistoryLabel("coherent", BREATHING_PRESETS.coherent)
    ).toBe("Coherent 5.5-5.5");
    expect(
      formatBreathingHistoryLabel(
        "custom",
        resolveBreathingRhythm("custom", {
          inhaleSec: 4,
          holdInSec: 2,
          exhaleSec: 6,
          holdOutSec: 0,
        })
      )
    ).toBe("Custom 4-2-6");
  });
});
