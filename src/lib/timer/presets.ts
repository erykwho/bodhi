import { getAmbientSoundOption } from "@/lib/audio/sounds";
import { parseTimerPreferences } from "@/lib/timer/preferences";
import type { TimerPreferences } from "@/lib/timer/types";

export const MAX_TIMER_PRESETS = 12;
export const MAX_PRESET_NAME_LENGTH = 36;
export const LOCAL_PRESETS_STORAGE_KEY = "bodhi.timer.presets.v1";

export interface TimerPresetItem {
  id: string;
  name: string;
  preferences: TimerPreferences;
  createdAt: string;
}

/**
 * Normalizes and clamps a user-provided preset name.
 */
export function sanitizePresetName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PRESET_NAME_LENGTH);
}

/**
 * Checks whether a saved preset matches the active TimerPreferences exactly.
 */
export function doesPresetMatchPreferences(
  preset: Pick<TimerPresetItem, "preferences">,
  prefs: TimerPreferences
): boolean {
  const p = preset.preferences;
  return (
    p.openEnded === prefs.openEnded &&
    (p.openEnded || p.durationMinutes === prefs.durationMinutes) &&
    p.warmupSeconds === prefs.warmupSeconds &&
    p.startBell === prefs.startBell &&
    p.endBell === prefs.endBell &&
    (p.endBell === "none" || p.endBellStrikes === prefs.endBellStrikes) &&
    Math.abs(p.bellVolume - prefs.bellVolume) < 0.001 &&
    p.intervalEnabled === prefs.intervalEnabled &&
    (!p.intervalEnabled ||
      (p.intervalMinutes === prefs.intervalMinutes &&
        p.intervalBell === prefs.intervalBell)) &&
    p.ambientSound === prefs.ambientSound &&
    (p.ambientSound === "silence" ||
      Math.abs(p.ambientVolume - prefs.ambientVolume) < 0.001)
  );
}

/**
 * Builds a compact human-readable subtitle for a preset (e.g., "15m · Gentle Rain" or "Open · Gentle Rain").
 */
export function formatPresetSummary(prefs: TimerPreferences): string {
  const parts = [prefs.openEnded ? "Open" : `${prefs.durationMinutes}m`];
  if (prefs.ambientSound !== "silence") {
    parts.push(getAmbientSoundOption(prefs.ambientSound).name);
  }
  if (prefs.intervalEnabled) {
    parts.push(`Every ${prefs.intervalMinutes}m`);
  }
  return parts.join(" · ");
}

export function readLocalPresets(): TimerPresetItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).name === "string"
      )
      .map((item) => ({
        id: String(item.id),
        name: sanitizePresetName(String(item.name)) || "Preset",
        preferences: parseTimerPreferences(item.preferences),
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
      }))
      .slice(0, MAX_TIMER_PRESETS);
  } catch {
    return [];
  }
}

export function writeLocalPresets(presets: ReadonlyArray<TimerPresetItem>): void {
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
