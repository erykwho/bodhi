import {
  BREATHING_PREFERENCES_STORAGE_KEY,
  DEFAULT_BREATHING_PREFERENCES,
  parseBreathingPreferences,
} from "@bodhi/core/breathing/preferences";
import type { BreathingPreferences } from "@bodhi/core/breathing/types";

export {
  BREATHING_PREFERENCES_STORAGE_KEY,
  DEFAULT_BREATHING_PREFERENCES,
  parseBreathingPreferences,
} from "@bodhi/core/breathing/preferences";

export function loadBreathingPreferences(): BreathingPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_BREATHING_PREFERENCES;
  }

  try {
    const stored = window.localStorage.getItem(
      BREATHING_PREFERENCES_STORAGE_KEY
    );
    if (!stored) return DEFAULT_BREATHING_PREFERENCES;
    return parseBreathingPreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_BREATHING_PREFERENCES;
  }
}

export function saveBreathingPreferences(prefs: BreathingPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BREATHING_PREFERENCES_STORAGE_KEY,
      JSON.stringify(prefs)
    );
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

let cachedClientSnapshot: BreathingPreferences | null = null;
const preferenceListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of preferenceListeners) {
    listener();
  }
}

export function getBreathingPreferencesServerSnapshot(): BreathingPreferences {
  return DEFAULT_BREATHING_PREFERENCES;
}

export function getBreathingPreferencesSnapshot(): BreathingPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_BREATHING_PREFERENCES;
  }
  if (!cachedClientSnapshot) {
    cachedClientSnapshot = loadBreathingPreferences();
  }
  return cachedClientSnapshot;
}

export function subscribeBreathingPreferences(
  listener: () => void
): () => void {
  preferenceListeners.add(listener);

  if (typeof window === "undefined") {
    return () => {
      preferenceListeners.delete(listener);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === BREATHING_PREFERENCES_STORAGE_KEY) {
      cachedClientSnapshot = loadBreathingPreferences();
      notifyListeners();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function updateBreathingPreferences(
  patch: Partial<BreathingPreferences>
): BreathingPreferences {
  const current = getBreathingPreferencesSnapshot();
  const next = parseBreathingPreferences({ ...current, ...patch });
  cachedClientSnapshot = next;
  saveBreathingPreferences(next);
  notifyListeners();
  return next;
}
