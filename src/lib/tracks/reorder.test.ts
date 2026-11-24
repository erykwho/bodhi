import { describe, expect, it } from "vitest";
import {
  applyFavoriteToggle,
  computeGroupedTargetIndex,
  computeTargetIndex,
  getFavoriteGroupRange,
  hasOrderChanged,
  mergeGroupedTrackOrder,
  mergeTrackOrder,
  reorderItems,
  sortTracksWithFavoritesFirst,
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

describe("favorite grouping and constrained reordering", () => {
  const sample = [
    { id: "f1", isFavorite: true },
    { id: "f2", isFavorite: true },
    { id: "o1", isFavorite: false },
    { id: "o2", isFavorite: false },
  ];

  it("stably sorts favorites before non-favorites", () => {
    const mixed = [
      { id: "o1", isFavorite: false },
      { id: "f1", isFavorite: true },
      { id: "o2", isFavorite: false },
      { id: "f2", isFavorite: true },
    ];
    expect(sortTracksWithFavoritesFirst(mixed).map((t) => t.id)).toEqual([
      "f1",
      "f2",
      "o1",
      "o2",
    ]);
  });

  it("places a newly favorited track at the top of favorites and an unfavorited track at the top of others", () => {
    const favorited = applyFavoriteToggle(sample, "o2", true);
    expect(favorited.map((t) => `${t.id}:${t.isFavorite}`)).toEqual([
      "o2:true",
      "f1:true",
      "f2:true",
      "o1:false",
    ]);

    const unfavorited = applyFavoriteToggle(favorited, "f2", false);
    expect(unfavorited.map((t) => `${t.id}:${t.isFavorite}`)).toEqual([
      "o2:true",
      "f1:true",
      "f2:false",
      "o1:false",
    ]);
  });

  it("returns exact group index ranges for favorites and non-favorites", () => {
    expect(getFavoriteGroupRange(sample, 0)).toEqual({ start: 0, end: 1 });
    expect(getFavoriteGroupRange(sample, 1)).toEqual({ start: 0, end: 1 });
    expect(getFavoriteGroupRange(sample, 2)).toEqual({ start: 2, end: 3 });
    expect(getFavoriteGroupRange(sample, 3)).toEqual({ start: 2, end: 3 });
  });

  it("constrains drag target index strictly within the dragged item's own group", () => {
    const rects = [
      { top: 0, height: 70 }, // f1 midpoint 35
      { top: 80, height: 70 }, // f2 midpoint 115
      { top: 180, height: 70 }, // o1 midpoint 215
      { top: 260, height: 70 }, // o2 midpoint 295
    ];

    // Dragging f1 far downward stops at f2 (index 1), never crossing into o1/o2
    expect(computeGroupedTargetIndex(400, rects, sample, 0)).toBe(1);
    // Dragging o2 far upward stops at o1 (index 2), never crossing into f1/f2
    expect(computeGroupedTargetIndex(0, rects, sample, 3)).toBe(2);
  });

  it("merges client reorder payloads while keeping favorite and non-favorite groups strictly separated", () => {
    const result = mergeGroupedTrackOrder(
      ["o2", "f2", "foreign", "o1", "f1"],
      sample
    );
    expect(result.favoriteIds).toEqual(["f2", "f1"]);
    expect(result.otherIds).toEqual(["o2", "o1"]);
    expect(result.orderedIds).toEqual(["f2", "f1", "o2", "o1"]);
  });
});

