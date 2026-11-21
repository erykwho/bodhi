import type {
  HistoryStats,
  MeditationSessionItem,
} from "@/lib/history/types";

/**
 * Minimum elapsed seconds required to prompt saving an early-stopped session.
 */
export const MIN_SAVEABLE_EARLY_STOP_SECONDS = 60;

/**
 * Converts a Date into a local YYYY-MM-DD calendar key.
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, deltaDays: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + deltaDays);
  return copy;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Computes the current daily meditation streak (in days).
 * Counts consecutive calendar days ending today — or yesterday if the user has
 * not yet meditated today — so the active streak persists until the day ends.
 */
export function computeCurrentStreak(
  sessions: ReadonlyArray<Pick<MeditationSessionItem, "endedAt">>,
  now: Date = new Date()
): number {
  if (sessions.length === 0) return 0;

  const uniqueDays = new Set<string>();
  for (const session of sessions) {
    const parsed = new Date(session.endedAt);
    if (!Number.isNaN(parsed.getTime())) {
      uniqueDays.add(toLocalDateKey(parsed));
    }
  }

  if (uniqueDays.size === 0) return 0;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = toLocalDateKey(today);
  const yesterday = addDays(today, -1);
  const yesterdayKey = toLocalDateKey(yesterday);

  let cursor: Date | null = null;
  if (uniqueDays.has(todayKey)) {
    cursor = today;
  } else if (uniqueDays.has(yesterdayKey)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (cursor && uniqueDays.has(toLocalDateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

/**
 * Computes the longest consecutive daily streak across all sessions.
 */
export function computeLongestStreak(
  sessions: ReadonlyArray<Pick<MeditationSessionItem, "endedAt">>
): number {
  if (sessions.length === 0) return 0;

  const uniqueKeys = Array.from(
    new Set(
      sessions
        .map((s) => new Date(s.endedAt))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => toLocalDateKey(d))
    )
  ).sort();

  if (uniqueKeys.length === 0) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < uniqueKeys.length; i++) {
    const prev = parseDateKey(uniqueKeys[i - 1]);
    const expectedNext = toLocalDateKey(addDays(prev, 1));
    if (uniqueKeys[i] === expectedNext) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }

  return longest;
}

/**
 * Computes aggregate meditation statistics for the History overview.
 */
export function computeHistoryStats(
  sessions: ReadonlyArray<
    Pick<MeditationSessionItem, "actualDurationSec" | "endedAt">
  >,
  now: Date = new Date()
): HistoryStats {
  const totalSeconds = sessions.reduce(
    (sum, session) => sum + Math.max(0, Math.round(session.actualDurationSec)),
    0
  );

  return {
    totalSessions: sessions.length,
    totalSeconds,
    currentStreakDays: computeCurrentStreak(sessions, now),
    longestStreakDays: computeLongestStreak(sessions),
  };
}

/**
 * Formats cumulative practice time cleanly for KPI summary cards.
 */
export function formatTotalTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const totalMinutes = Math.floor(safe / 60);
  if (totalMinutes < 1) {
    return safe > 0 ? "< 1 min" : "0 min";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (remMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remMinutes}m`;
}

/**
 * Formats an individual session duration cleanly (e.g., "10 min", "4m 30s", "1 h 5m").
 */
export function formatSessionDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remSeconds = safe % 60;

  if (hours > 0) {
    return remSeconds === 0 && minutes === 0
      ? `${hours} h`
      : `${hours} h ${minutes}m`;
  }
  if (remSeconds === 0) {
    return `${minutes} min`;
  }
  return `${minutes}m ${remSeconds}s`;
}
