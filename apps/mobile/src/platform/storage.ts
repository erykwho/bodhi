import { Storage } from "expo-sqlite/kv-store";
import {
  BREATHING_PREFERENCES_STORAGE_KEY,
  DEFAULT_BREATHING_PREFERENCES,
  parseBreathingPreferences,
} from "@bodhi/core/breathing/preferences";
import { LOCALE_STORAGE_KEY, resolveLocale } from "@bodhi/core/i18n";
import type { Locale } from "@bodhi/core/i18n/types";
import { createOfflineSessionQueue } from "@bodhi/core/offline/queue";
import {
  createPreferenceStore,
  type KeyValueStorage,
} from "@bodhi/core/offline/storage";
import {
  DEFAULT_TIMER_PREFERENCES,
  parseTimerPreferences,
  TIMER_PREFERENCES_STORAGE_KEY,
} from "@bodhi/core/timer/preferences";
import {
  LOCAL_PRESETS_STORAGE_KEY,
  MAX_TIMER_PRESETS,
  parseLocalPresets,
  type TimerPresetItem,
} from "@bodhi/core/timer/presets";
import {
  GUIDED_AUTO_ADVANCE_STORAGE_KEY,
  parseCachedPlaylists,
  parseGuidedAutoAdvancePreference,
} from "@bodhi/core/tracks/playlists";
import type {
  FavoriteTrackItem,
  TrackPlaylistItem,
} from "@bodhi/core/tracks/types";

export const THEME_PREFERENCE_STORAGE_KEY = "bodhi.theme.preference.v1";
export const REMINDER_PREFERENCES_STORAGE_KEY = "bodhi.reminders.v1";
export const HEALTH_SYNC_STORAGE_KEY = "bodhi.health.sync.v1";
export const TRACKS_CACHE_KEY_PREFIX = "bodhi.tracks.cache.v1:";
export const PLAYLISTS_CACHE_KEY_PREFIX = "bodhi.playlists.cache.v1:";

export type ThemePreference = "system" | "light" | "dark";

export interface ReminderPreferences {
  enabled: boolean;
  hour: number; // 0..23
  minute: number; // 0..59
  /** 1 = Sunday .. 7 = Saturday (Expo CalendarTrigger weekday convention). */
  weekdays: number[];
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: false,
  hour: 7,
  minute: 30,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

/**
 * Synchronous persistent KeyValueStorage backed by `expo-sqlite/kv-store`.
 * Safely swallows storage errors to satisfy Bodhi's backward-compatible storage invariant.
 */
export const mobileStorage: KeyValueStorage = {
  getItem(key) {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      Storage.setItemSync(key, value);
    } catch {
      // Ignore transient disk write failures
    }
  },
  removeItem(key) {
    try {
      Storage.removeItemSync(key);
    } catch {
      // Ignore transient disk delete failures
    }
  },
};

export const timerPreferencesStore = createPreferenceStore({
  storageKey: TIMER_PREFERENCES_STORAGE_KEY,
  defaults: DEFAULT_TIMER_PREFERENCES,
  parse: parseTimerPreferences,
  storage: mobileStorage,
});

export const breathingPreferencesStore = createPreferenceStore({
  storageKey: BREATHING_PREFERENCES_STORAGE_KEY,
  defaults: DEFAULT_BREATHING_PREFERENCES,
  parse: parseBreathingPreferences,
  storage: mobileStorage,
});

export const mobileOfflineQueue = createOfflineSessionQueue(mobileStorage);

export function readStoredLocale(): Locale {
  return resolveLocale(mobileStorage.getItem(LOCALE_STORAGE_KEY));
}

export function writeStoredLocale(locale: Locale): void {
  mobileStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function readThemePreference(): ThemePreference {
  const raw = mobileStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

export function writeThemePreference(pref: ThemePreference): void {
  mobileStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, pref);
}

export function readLocalPresets(): TimerPresetItem[] {
  const raw = mobileStorage.getItem(LOCAL_PRESETS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return parseLocalPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalPresets(
  presets: ReadonlyArray<TimerPresetItem>
): void {
  mobileStorage.setItem(
    LOCAL_PRESETS_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_TIMER_PRESETS))
  );
}

export function readCachedTracks(userId: string): FavoriteTrackItem[] {
  if (!userId) return [];
  const raw = mobileStorage.getItem(`${TRACKS_CACHE_KEY_PREFIX}${userId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FavoriteTrackItem[]) : [];
  } catch {
    return [];
  }
}

export function writeCachedTracks(
  userId: string,
  tracks: ReadonlyArray<FavoriteTrackItem>
): void {
  if (!userId) return;
  mobileStorage.setItem(
    `${TRACKS_CACHE_KEY_PREFIX}${userId}`,
    JSON.stringify(tracks)
  );
}

export function readCachedPlaylists(userId: string): TrackPlaylistItem[] {
  if (!userId) return [];
  const raw = mobileStorage.getItem(`${PLAYLISTS_CACHE_KEY_PREFIX}${userId}`);
  if (!raw) return [];
  try {
    return parseCachedPlaylists(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCachedPlaylists(
  userId: string,
  playlists: ReadonlyArray<TrackPlaylistItem>
): void {
  if (!userId) return;
  mobileStorage.setItem(
    `${PLAYLISTS_CACHE_KEY_PREFIX}${userId}`,
    JSON.stringify(playlists)
  );
}

export function readGuidedAutoAdvance(): boolean {
  return parseGuidedAutoAdvancePreference(
    mobileStorage.getItem(GUIDED_AUTO_ADVANCE_STORAGE_KEY)
  );
}

export function writeGuidedAutoAdvance(enabled: boolean): void {
  mobileStorage.setItem(
    GUIDED_AUTO_ADVANCE_STORAGE_KEY,
    enabled ? "true" : "false"
  );
}

export function readReminderPreferences(): ReminderPreferences {
  const raw = mobileStorage.getItem(REMINDER_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_REMINDER_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderPreferences>;
    const hour =
      typeof parsed.hour === "number" && parsed.hour >= 0 && parsed.hour <= 23
        ? Math.floor(parsed.hour)
        : DEFAULT_REMINDER_PREFERENCES.hour;
    const minute =
      typeof parsed.minute === "number" &&
      parsed.minute >= 0 &&
      parsed.minute <= 59
        ? Math.floor(parsed.minute)
        : DEFAULT_REMINDER_PREFERENCES.minute;
    const weekdays = Array.isArray(parsed.weekdays)
      ? parsed.weekdays.filter(
          (d): d is number => typeof d === "number" && d >= 1 && d <= 7
        )
      : DEFAULT_REMINDER_PREFERENCES.weekdays;
    return {
      enabled: Boolean(parsed.enabled),
      hour,
      minute,
      weekdays: weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5, 6, 7],
    };
  } catch {
    return { ...DEFAULT_REMINDER_PREFERENCES };
  }
}

export function writeReminderPreferences(prefs: ReminderPreferences): void {
  mobileStorage.setItem(REMINDER_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
}

export function readHealthSyncEnabled(): boolean {
  return mobileStorage.getItem(HEALTH_SYNC_STORAGE_KEY) === "true";
}

export function writeHealthSyncEnabled(enabled: boolean): void {
  mobileStorage.setItem(HEALTH_SYNC_STORAGE_KEY, enabled ? "true" : "false");
}
