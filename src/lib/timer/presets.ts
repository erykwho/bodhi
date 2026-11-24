import {
  LOCAL_PRESETS_STORAGE_KEY,
  MAX_TIMER_PRESETS,
  parseLocalPresets,
  type TimerPresetItem,
} from "@bodhi/core/timer/presets";

export {
  doesPresetMatchPreferences,
  formatPresetSummary,
  LOCAL_PRESETS_STORAGE_KEY,
  MAX_PRESET_NAME_LENGTH,
  MAX_TIMER_PRESETS,
  parseLocalPresets,
  sanitizePresetName,
  type TimerPresetItem,
} from "@bodhi/core/timer/presets";

export function readLocalPresets(): TimerPresetItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    return parseLocalPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalPresets(
  presets: ReadonlyArray<TimerPresetItem>
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_PRESETS_STORAGE_KEY,
      JSON.stringify(presets.slice(0, MAX_TIMER_PRESETS))
    );
  } catch {
    // Ignore storage quota errors
  }
}
