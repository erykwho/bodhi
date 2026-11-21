"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  CloudOff,
  Download,
  Flame,
  Headphones,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { signInWithGoogle } from "@/app/actions";
import { HistoryCalendar } from "@/components/history-calendar";
import type { SessionUserSummary } from "@/lib/auth";
import { saveMeditationSession } from "@/lib/history/client";
import {
  sessionsToCsv,
  sessionsToJson,
  triggerFileDownload,
} from "@/lib/history/export";
import {
  computeHistoryStats,
  filterSessionsByPeriod,
  formatSessionDuration,
  formatTotalTime,
  toLocalDateKey,
  type HistoryPeriod,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  isPendingSessionId,
  removePendingSession,
  updatePendingSessionNote,
} from "@/lib/offline/queue";
import { clampDurationMinutes } from "@/lib/timer/engine";
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from "@/lib/timer/types";

const PERIOD_OPTIONS: ReadonlyArray<{ id: HistoryPeriod; label: string }> = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
] as const;

interface MeditationHistoryProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  isOnline?: boolean;
  sessions: MeditationSessionItem[];
  onSessionSaved: (session: MeditationSessionItem) => void;
  onSessionUpdated: (session: MeditationSessionItem) => void;
  onSessionDeleted: (id: string) => void;
}

function formatSessionTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MeditationHistory({
  user,
  authConfigured,
  isOnline = true,
  sessions,
  onSessionSaved,
  onSessionUpdated,
  onSessionDeleted,
}: MeditationHistoryProps) {
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  // Manual session log form state
  const [isLoggingManual, setIsLoggingManual] = useState<boolean>(false);
  const [manualDate, setManualDate] = useState<string>(() =>
    toLocalDateKey(new Date())
  );
  const [manualMinutes, setManualMinutes] = useState<string>("15");
  const [manualNote, setManualNote] = useState<string>("");
  const [isSavingManual, setIsSavingManual] = useState<boolean>(false);

  // Export panel state
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);

  // Existing row edit/delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const userId = user?.id ?? null;

  // All-time stats for streaks; period-filtered sessions for Total, Sessions, and list
  const allTimeStats = useMemo(() => computeHistoryStats(sessions), [sessions]);
  const periodSessions = useMemo(
    () => filterSessionsByPeriod(sessions, period),
    [period, sessions]
  );
  const periodStats = useMemo(
    () => computeHistoryStats(periodSessions),
    [periodSessions]
  );

  const displayedSessions = useMemo(() => {
    if (selectedDateKey) {
      return sessions.filter((s) => {
        const parsed = new Date(s.endedAt);
        return (
          !Number.isNaN(parsed.getTime()) &&
          toLocalDateKey(parsed) === selectedDateKey
        );
      });
    }
    return periodSessions;
  }, [periodSessions, selectedDateKey, sessions]);

  const startEditingNote = useCallback((session: MeditationSessionItem) => {
    setEditingId(session.id);
    setNoteDraft(session.note ?? "");
    setErrorMessage(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setNoteDraft("");
  }, []);

  const handleManualSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!userId) return;

      const parsedMinutes = clampDurationMinutes(Number(manualMinutes));
      const durationSec = parsedMinutes * 60;

      // Build local date timestamp (noon local time for past dates, current time for today)
      const todayKey = toLocalDateKey(new Date());
      let endedAt: Date;
      if (!manualDate || manualDate === todayKey) {
        endedAt = new Date();
      } else {
        const [y, m, d] = manualDate.split("-").map(Number);
        endedAt = new Date(y, m - 1, d, 12, 0, 0);
      }

      if (Number.isNaN(endedAt.getTime())) {
        setErrorMessage("Please choose a valid date.");
        return;
      }

      const startedAt = new Date(endedAt.getTime() - durationSec * 1000);
      setIsSavingManual(true);
      setErrorMessage(null);

      try {
        const saved = await saveMeditationSession(
          {
            mode: "TIMER",
            plannedDurationSec: durationSec,
            actualDurationSec: durationSec,
            completed: true,
            note: manualNote.trim() || null,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
          userId
        );

        if (!saved) {
          setErrorMessage("Failed to save manual session.");
          return;
        }

        onSessionSaved(saved);
        setManualNote("");
        setIsLoggingManual(false);
      } catch {
        setErrorMessage("Failed to save manual session.");
      } finally {
        setIsSavingManual(false);
      }
    },
    [manualDate, manualMinutes, manualNote, onSessionSaved, userId]
  );

  const handleExportCsv = useCallback(() => {
    const dateStamp = toLocalDateKey(new Date());
    triggerFileDownload(
      sessionsToCsv(displayedSessions),
      `bodhi-history-${dateStamp}.csv`,
      "text/csv;charset=utf-8"
    );
    setShowExportMenu(false);
  }, [displayedSessions]);

  const handleExportJson = useCallback(() => {
    const dateStamp = toLocalDateKey(new Date());
    triggerFileDownload(
      sessionsToJson(displayedSessions),
      `bodhi-history-${dateStamp}.json`,
      "application/json;charset=utf-8"
    );
    setShowExportMenu(false);
  }, [displayedSessions]);

  const handleSaveNote = useCallback(
    async (id: string) => {
      setSavingId(id);
      setErrorMessage(null);

      if (isPendingSessionId(id)) {
        if (userId) {
          const updated = updatePendingSessionNote(
            userId,
            id,
            noteDraft.trim() || null
          );
          if (updated) {
            onSessionUpdated(updated);
          }
        }
        setSavingId(null);
        setEditingId(null);
        setNoteDraft("");
        return;
      }

      try {
        const response = await fetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: noteDraft.trim() || null }),
        });

        const data = (await response.json()) as {
          session?: MeditationSessionItem;
          error?: string;
        };

        if (!response.ok || !data.session) {
          setErrorMessage(data.error ?? "Failed to update note.");
          return;
        }

        onSessionUpdated(data.session);
        setEditingId(null);
        setNoteDraft("");
      } catch {
        setErrorMessage("Failed to update note.");
      } finally {
        setSavingId(null);
      }
    },
    [noteDraft, onSessionUpdated, userId]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      setDeletingId(id);
      setErrorMessage(null);

      if (isPendingSessionId(id)) {
        if (userId) {
          removePendingSession(userId, id);
        }
        onSessionDeleted(id);
        setDeletingId(null);
        return;
      }

      try {
        const response = await fetch(`/api/sessions/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setErrorMessage(data.error ?? "Failed to delete session.");
          return;
        }

        onSessionDeleted(id);
      } catch {
        setErrorMessage("Failed to delete session.");
      } finally {
        setDeletingId(null);
      }
    },
    [onSessionDeleted, userId]
  );

  if (!user) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <CalendarDays className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Meditation History
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            Sign in with Google to automatically log your timer and guided
            sessions, track your daily streak, and keep short reflections.
          </p>

          {authConfigured ? (
            <form action={signInWithGoogle} className="mt-5">
              <button
                type="submit"
                disabled={!isOnline}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
              >
                <LogIn className="h-4 w-4" />
                {isOnline
                  ? "Continue with Google"
                  : "Sign in available when online"}
              </button>
            </form>
          ) : (
            <p className="mt-4 rounded-xl bg-[var(--surface-muted)] px-3.5 py-2.5 text-xs text-[var(--foreground-muted)]">
              Configure Google OAuth and Neon Postgres environment variables to
              enable meditation history.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-3.5 py-1">
      {/* Single-row Period Filter & Manual Log / Export Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-[var(--surface-muted)] p-0.5">
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = period === opt.id && !selectedDateKey;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelectedDateKey(null);
                  setPeriod(opt.id);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[var(--surface)] text-[var(--foreground)] shadow-2xs"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setShowExportMenu(false);
              setIsLoggingManual((prev) => !prev);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[#fcfaf6] whitespace-nowrap transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
          >
            {isLoggingManual ? (
              <>
                <X className="h-3.5 w-3.5" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Log
              </>
            )}
          </button>

          {sessions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsLoggingManual(false);
                setShowExportMenu((prev) => !prev);
              }}
              aria-label="Export history"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Compact Export Row */}
      {showExportMenu && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-black/6 bg-[var(--surface)] px-3.5 py-2.5 text-xs dark:border-white/10">
          <span className="font-medium text-[var(--foreground-muted)]">
            Export {displayedSessions.length}{" "}
            {displayedSessions.length === 1 ? "session" : "sessions"}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCsv}
              className="rounded-lg bg-[var(--surface-muted)] px-2.5 py-1 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className="rounded-lg bg-[var(--surface-muted)] px-2.5 py-1 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            >
              JSON
            </button>
          </div>
        </div>
      )}

      {/* Manual Session Logging Form */}
      {isLoggingManual && (
        <form
          onSubmit={handleManualSubmit}
          className="flex flex-col gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10"
        >
          <p className="text-xs font-semibold text-[var(--foreground)]">
            Log offline or manual practice
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
              Date
              <input
                type="date"
                required
                max={toLocalDateKey(new Date())}
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
                className="h-9 rounded-xl border border-black/10 bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
              Minutes
              <input
                type="number"
                required
                min={MIN_DURATION_MINUTES}
                max={MAX_DURATION_MINUTES}
                value={manualMinutes}
                onChange={(event) => setManualMinutes(event.target.value)}
                className="h-9 rounded-xl border border-black/10 bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] tabular-nums outline-none focus:border-[var(--accent)] dark:border-white/12"
              />
            </label>
          </div>

          <textarea
            rows={2}
            maxLength={500}
            placeholder="Optional reflection note..."
            value={manualNote}
            onChange={(event) => setManualNote(event.target.value)}
            className="w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
          />

          <button
            type="submit"
            disabled={isSavingManual}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
          >
            {isSavingManual ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save Session
          </button>
        </form>
      )}

      {/* Compact 3-Column KPI Strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <Clock className="h-3 w-3 text-[var(--accent)]" />
            <span>Total</span>
          </div>
          <p className="mt-1 text-base font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
            {formatTotalTime(periodStats.totalSeconds)}
          </p>
        </div>

        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <Flame className="h-3 w-3 text-[var(--warm-amber)]" />
            <span>Streak</span>
          </div>
          <p className="mt-1 text-base font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
            {allTimeStats.currentStreakDays}{" "}
            <span className="text-xs font-medium text-[var(--foreground-muted)]">
              {allTimeStats.currentStreakDays === 1 ? "day" : "days"}
            </span>
          </p>
          {allTimeStats.longestStreakDays > 0 && (
            <p className="mt-0.5 text-[10px] text-[var(--foreground-muted)] tabular-nums">
              Best {allTimeStats.longestStreakDays}d
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <CalendarDays className="h-3 w-3 text-[var(--accent)]" />
            <span>Sessions</span>
          </div>
          <p className="mt-1 text-base font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
            {periodStats.totalSessions}
          </p>
        </div>
      </div>

      {/* Minimalist Monthly Practice Calendar / Heatmap */}
      <HistoryCalendar
        sessions={sessions}
        selectedDateKey={selectedDateKey}
        onSelectDateKey={setSelectedDateKey}
      />

      {errorMessage && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      {/* Chronological Session Log */}
      {displayedSessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-10 text-center dark:border-white/12">
          <Clock className="h-7 w-7 text-[var(--foreground-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            {sessions.length === 0
              ? "No sessions recorded yet"
              : "No sessions in this range"}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            {sessions.length === 0
              ? "Complete a Timer or Guided meditation, or tap Log to record offline practice."
              : "Switch the period filter above or select another day on the calendar."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {displayedSessions.map((session) => {
            const isEditing = editingId === session.id;
            const isPending = Boolean(
              session.pendingSync || isPendingSessionId(session.id)
            );
            const canMutate = isOnline || isPending;
            const title =
              session.mode === "TRACK"
                ? (session.trackTitle ?? "Guided Meditation")
                : "Silent Timer";

            return (
              <li
                key={session.id}
                className="rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 shadow-xs dark:border-white/10"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      {session.mode === "TRACK" ? (
                        <Headphones className="h-4 w-4" />
                      ) : (
                        <Timer className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--foreground-muted)]">
                        <span className="font-semibold text-[var(--foreground)] tabular-nums">
                          {formatSessionDuration(session.actualDurationSec)}
                        </span>
                        <span>·</span>
                        <span>{formatSessionTimestamp(session.endedAt)}</span>
                        {!session.completed && (
                          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--warm-amber)]">
                            Partial
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground-muted)]">
                            <CloudOff className="h-2.5 w-2.5" />
                            Pending sync
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        isEditing ? cancelEditing() : startEditingNote(session)
                      }
                      disabled={!canMutate}
                      title={
                        canMutate
                          ? undefined
                          : "Reconnect to edit synced sessions"
                      }
                      aria-label={
                        session.note ? "Edit session note" : "Add session note"
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-35"
                    >
                      {isEditing ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteSession(session.id)}
                      disabled={deletingId === session.id || !canMutate}
                      title={
                        canMutate
                          ? undefined
                          : "Reconnect to delete synced sessions"
                      }
                      aria-label="Delete session"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-35 dark:hover:text-red-400"
                    >
                      {deletingId === session.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Existing note */}
                {!isEditing && session.note && (
                  <p className="mt-2.5 rounded-xl bg-[var(--background)] px-3 py-2 text-xs leading-relaxed text-[var(--foreground-muted)]">
                    {session.note}
                  </p>
                )}

                {/* Inline note editor */}
                {isEditing && (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <textarea
                      rows={2}
                      maxLength={500}
                      placeholder="Add a short reflection..."
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveNote(session.id)}
                        disabled={savingId === session.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#fcfaf6] disabled:opacity-50 dark:text-[#151917]"
                      >
                        {savingId === session.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
