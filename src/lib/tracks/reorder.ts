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

export interface FavoritableItem {
  id: string;
  isFavorite: boolean;
}

/**
 * Stably partitions tracks so favorited tracks always appear before
 * non-favorited tracks while preserving relative order inside each group.
 */
export function sortTracksWithFavoritesFirst<T extends { isFavorite: boolean }>(
  tracks: readonly T[]
): T[] {
  const favorites: T[] = [];
  const others: T[] = [];

  for (const track of tracks) {
    if (track.isFavorite) {
      favorites.push(track);
    } else {
      others.push(track);
    }
  }

  return [...favorites, ...others];
}

/**
 * Toggles a track's favorite flag and places it at the top of its destination
 * group: top of favorites when favorited, or top of non-favorites when unfavorited.
 */
export function applyFavoriteToggle<T extends FavoritableItem>(
  tracks: readonly T[],
  trackId: string,
  nextIsFavorite: boolean
): T[] {
  const target = tracks.find((track) => track.id === trackId);
  if (!target) {
    return [...tracks];
  }

  const updated: T = { ...target, isFavorite: nextIsFavorite };
  const favorites: T[] = [];
  const others: T[] = [];

  for (const track of tracks) {
    if (track.id === trackId) continue;
    if (track.isFavorite) {
      favorites.push(track);
    } else {
      others.push(track);
    }
  }

  return nextIsFavorite
    ? [updated, ...favorites, ...others]
    : [...favorites, updated, ...others];
}

/**
 * Returns the inclusive index range [start, end] for the favorite or non-favorite
 * group containing `index` in a favorites-first track list.
 */
export function getFavoriteGroupRange<T extends { isFavorite: boolean }>(
  tracks: readonly T[],
  index: number
): { start: number; end: number } {
  if (tracks.length === 0) {
    return { start: 0, end: -1 };
  }

  const clamped = Math.max(0, Math.min(index, tracks.length - 1));
  const isFav = tracks[clamped].isFavorite;

  let start = clamped;
  while (start > 0 && tracks[start - 1].isFavorite === isFav) {
    start--;
  }

  let end = clamped;
  while (end < tracks.length - 1 && tracks[end + 1].isFavorite === isFav) {
    end++;
  }

  return { start, end };
}

/**
 * Computes the drag target index constrained strictly to the dragged track's
 * own group (favorites or non-favorites) so items never cross the boundary.
 */
export function computeGroupedTargetIndex<T extends { isFavorite: boolean }>(
  pointerY: number,
  itemRects: readonly VerticalBounds[],
  tracks: readonly T[],
  currentIndex: number
): number {
  if (tracks.length <= 1 || itemRects.length !== tracks.length) {
    return Math.max(0, Math.min(currentIndex, Math.max(0, tracks.length - 1)));
  }

  const { start, end } = getFavoriteGroupRange(tracks, currentIndex);
  if (end <= start) {
    return currentIndex;
  }

  const groupRects = itemRects.slice(start, end + 1);
  const relativeTarget = computeTargetIndex(
    pointerY,
    groupRects,
    currentIndex - start
  );
  return start + relativeTarget;
}

/**
 * Normalizes a client-supplied ordered ID list while strictly preserving
 * separation between favorited and non-favorited tracks.
 */
export function mergeGroupedTrackOrder(
  orderedIds: readonly string[],
  existingTracks: readonly FavoritableItem[]
): {
  favoriteIds: string[];
  otherIds: string[];
  orderedIds: string[];
} {
  const existingFavoriteIds: string[] = [];
  const existingOtherIds: string[] = [];

  for (const track of existingTracks) {
    if (track.isFavorite) {
      existingFavoriteIds.push(track.id);
    } else {
      existingOtherIds.push(track.id);
    }
  }

  const favoriteIds = mergeTrackOrder(orderedIds, existingFavoriteIds);
  const otherIds = mergeTrackOrder(orderedIds, existingOtherIds);

  return {
    favoriteIds,
    otherIds,
    orderedIds: [...favoriteIds, ...otherIds],
  };
}

