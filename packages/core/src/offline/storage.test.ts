import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMER_PREFERENCES,
  parseTimerPreferences,
  TIMER_PREFERENCES_STORAGE_KEY,
} from "../timer/preferences";
import { createOfflineSessionQueue } from "./queue";
import { createMemoryStorage, createPreferenceStore } from "./storage";

describe("createPreferenceStore", () => {
  it("falls back safely to defaults on missing or corrupted JSON", () => {
    const storage = createMemoryStorage();
    storage.setItem(TIMER_PREFERENCES_STORAGE_KEY, "{not-valid-json");

    const store = createPreferenceStore({
      storageKey: TIMER_PREFERENCES_STORAGE_KEY,
      defaults: DEFAULT_TIMER_PREFERENCES,
      parse: parseTimerPreferences,
      storage,
    });

    expect(store.getSnapshot()).toEqual(DEFAULT_TIMER_PREFERENCES);
  });

  it("persists updates and notifies subscribers", () => {
    const storage = createMemoryStorage();
    const store = createPreferenceStore({
      storageKey: TIMER_PREFERENCES_STORAGE_KEY,
      defaults: DEFAULT_TIMER_PREFERENCES,
      parse: parseTimerPreferences,
      storage,
    });

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const updated = store.update({ durationMinutes: 25, openEnded: true });
    expect(updated.durationMinutes).toBe(25);
    expect(updated.openEnded).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    const reloaded = createPreferenceStore({
      storageKey: TIMER_PREFERENCES_STORAGE_KEY,
      defaults: DEFAULT_TIMER_PREFERENCES,
      parse: parseTimerPreferences,
      storage,
    });
    expect(reloaded.load().durationMinutes).toBe(25);

    unsubscribe();
    store.update({ durationMinutes: 15 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("createOfflineSessionQueue", () => {
  it("enqueues, updates notes, caches history, and removes pending sessions via KeyValueStorage", () => {
    const storage = createMemoryStorage();
    const queue = createOfflineSessionQueue(storage);

    const pending = queue.enqueuePendingSession("user-1", {
      mode: "TIMER",
      plannedDurationSec: 600,
      actualDurationSec: 600,
      completed: true,
    });

    expect(queue.readPendingSessions("user-1")).toHaveLength(1);

    const updated = queue.updatePendingSessionNote(
      "user-1",
      pending.id,
      "  Calm breath  "
    );
    expect(updated?.note).toBe("Calm breath");

    queue.removePendingSession("user-1", pending.id);
    expect(queue.readPendingSessions("user-1")).toEqual([]);
  });
});
