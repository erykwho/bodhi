import { describe, expect, it } from "vitest";
import {
  computeTargetIndex,
  hasOrderChanged,
  mergeTrackOrder,
  reorderItems,
} from "./reorder";

describe("reorderItems", () => {
  it("moves an item downward", () => {
    expect(reorderItems(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves an item upward", () => {
    expect(reorderItems(["a", "b", "c", "d"], 3, 1)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns a shallow copy without mutating when indices are equal or out of range", () => {
    const source = ["a", "b", "c"];
    const same = reorderItems(source, 1, 1);
    expect(same).toEqual(["a", "b", "c"]);
    expect(same).not.toBe(source);

    expect(reorderItems(source, -1, 1)).toEqual(["a", "b", "c"]);
    expect(reorderItems(source, 0, 10)).toEqual(["a", "b", "c"]);
  });
});

describe("computeTargetIndex", () => {
  const rects = [
    { top: 0, height: 70 }, // midpoint 35
    { top: 80, height: 70 }, // midpoint 115
    { top: 160, height: 70 }, // midpoint 195
  ];

  it("keeps current index when pointer stays within hysteresis zone", () => {
    expect(computeTargetIndex(50, rects, 0)).toBe(0);
    expect(computeTargetIndex(110, rects, 0)).toBe(0);
    expect(computeTargetIndex(115, rects, 1)).toBe(1);
    expect(computeTargetIndex(180, rects, 1)).toBe(1);
  });

  it("advances downward when crossing subsequent item midpoints", () => {
    expect(computeTargetIndex(116, rects, 0)).toBe(1);
    expect(computeTargetIndex(210, rects, 0)).toBe(2);
  });

  it("moves upward when crossing preceding item midpoints", () => {
    expect(computeTargetIndex(114, rects, 2)).toBe(1);
    expect(computeTargetIndex(20, rects, 2)).toBe(0);
  });

  it("handles empty or single-item lists safely", () => {
    expect(computeTargetIndex(50, [], 0)).toBe(0);
    expect(computeTargetIndex(50, [{ top: 0, height: 70 }], 0)).toBe(0);
  });
});

describe("mergeTrackOrder", () => {
  it("applies valid client order, deduplicates, ignores unknown IDs, and appends missing IDs", () => {
    const result = mergeTrackOrder(
      ["c", "unknown", "a", "c"],
      ["a", "b", "c", "d"]
    );
    expect(result).toEqual(["c", "a", "b", "d"]);
  });

  it("handles a complete valid permutation", () => {
    expect(mergeTrackOrder(["b", "c", "a"], ["a", "b", "c"])).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("hasOrderChanged", () => {
  it("detects identical vs changed orders", () => {
    expect(hasOrderChanged(["a", "b", "c"], ["a", "b", "c"])).toBe(false);
    expect(hasOrderChanged(["a", "b", "c"], ["a", "c", "b"])).toBe(true);
    expect(hasOrderChanged(["a", "b"], ["a", "b", "c"])).toBe(true);
  });
});
