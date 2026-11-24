import {
  DEFAULT_TIMER_PREFERENCES,
  parseTimerPreferences,
  TIMER_PREFERENCES_STORAGE_KEY,
} from "@bodhi/core/timer/preferences";
import type { TimerPreferences } from "@bodhi/core/timer/types";

export {
  DEFAULT_TIMER_PREFERENCES,
  parseTimerPreferences,
  TIMER_PREFERENCES_STORAGE_KEY,
} from "@bodhi/core/timer/preferences";

export function loadTimerPreferences(): TimerPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_TIMER_PREFERENCES };
  }

  try {
    const stored = window.localStorage.getItem(TIMER_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_TIMER_PREFERENCES };
    }
    return parseTimerPreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_TIMER_PREFERENCES };
  }
}

export function saveTimerPreferences(prefs: TimerPreferences): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      TIMER_PREFERENCES_STORAGE_KEY,
      JSON.stringify(prefs)
    );
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

let cachedClientSnapshot: TimerPreferences | null = null;
const preferenceListeners = new Set<() => void>();

function notifyPreferenceListeners(): void {
  for (const listener of preferenceListeners) {
    listener();
  }
}

export function getTimerPreferencesServerSnapshot(): TimerPreferences {
  return DEFAULT_TIMER_PREFERENCES;
}

export function getTimerPreferencesSnapshot(): TimerPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_TIMER_PREFERENCES;
  }
  if (!cachedClientSnapshot) {
    cachedClientSnapshot = loadTimerPreferences();
  }
  return cachedClientSnapshot;
}

export function subscribeTimerPreferences(listener: () => void): () => void {
  preferenceListeners.add(listener);

  if (typeof window === "undefined") {
    return () => {
      preferenceListeners.delete(listener);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === TIMER_PREFERENCES_STORAGE_KEY) {
      cachedClientSnapshot = loadTimerPreferences();
      notifyPreferenceListeners();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function updateTimerPreferences(
  patch: Partial<TimerPreferences>
): TimerPreferences {
  const current = getTimerPreferencesSnapshot();
  const next = parseTimerPreferences({ ...current, ...patch });
  cachedClientSnapshot = next;
  saveTimerPreferences(next);
  notifyPreferenceListeners();
  return next;
}
