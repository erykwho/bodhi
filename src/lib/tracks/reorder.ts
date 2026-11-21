export interface VerticalBounds {
  top: number;
  height: number;
}

/**
 * Returns a new array with the item at `fromIndex` moved to `toIndex`.
 */
export function reorderItems<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Computes the target list index for a dragged item based on pointer Y
 * and the current bounding rects of all items in the list.
 *
 * Uses directional midpoint crossing relative to `currentIndex` to avoid
 * jitter/oscillation when the pointer sits near the dragged item's center.
 */
export function computeTargetIndex(
  pointerY: number,
  itemRects: readonly VerticalBounds[],
  currentIndex: number
): number {
  if (itemRects.length <= 1) {
    return 0;
  }

  const clampedCurrent = Math.max(
    0,
    Math.min(currentIndex, itemRects.length - 1)
  );
  let target = clampedCurrent;

  // Check items below currentIndex (dragging downward)
  for (let i = clampedCurrent + 1; i < itemRects.length; i++) {
    const midpoint = itemRects[i].top + itemRects[i].height / 2;
    if (pointerY > midpoint) {
      target = i;
    } else {
      break;
    }
  }

  if (target !== clampedCurrent) {
    return target;
  }

  // Check items above currentIndex (dragging upward)
  for (let i = clampedCurrent - 1; i >= 0; i--) {
    const midpoint = itemRects[i].top + itemRects[i].height / 2;
    if (pointerY < midpoint) {
      target = i;
    } else {
      break;
    }
  }

  return target;
}

/**
 * Normalizes a client-supplied ordered ID list against the user's actual
 * track IDs in the database. Deduplicates valid IDs, ignores unknown IDs,
 * and preserves any newly added tracks not yet present in `orderedIds`.
 */
export function mergeTrackOrder(
  orderedIds: readonly string[],
  existingIds: readonly string[]
): string[] {
  const existingSet = new Set(existingIds);
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const id of orderedIds) {
    if (existingSet.has(id) && !seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }

  for (const id of existingIds) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }

  return merged;
}

/**
 * Returns true if two ordered ID arrays differ in length or element order.
 */
export function hasOrderChanged(
  previousIds: readonly string[],
  nextIds: readonly string[]
): boolean {
  if (previousIds.length !== nextIds.length) {
    return true;
  }
  for (let i = 0; i < previousIds.length; i++) {
    if (previousIds[i] !== nextIds[i]) {
      return true;
    }
  }
  return false;
}
