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
import { useI18n } from "@/components/i18n-provider";
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

const PERIOD_IDS: readonly HistoryPeriod[] = ["7d", "30d", "all"] as const;

interface MeditationHistoryProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  isOnline?: boolean;
  sessions: MeditationSessionItem[];
  onSessionSaved: (session: MeditationSessionItem) => void;
  onSessionUpdated: (session: MeditationSessionItem) => void;
  onSessionDeleted: (id: string) => void;
}

function formatSessionTimestamp(iso: string, intlTag: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlTag, {
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
  const { intlTag, m } = useI18n();
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
        const [y, mo, d] = manualDate.split("-").map(Number);
        endedAt = new Date(y, mo - 1, d, 12, 0, 0);
      }

      if (Number.isNaN(endedAt.getTime())) {
        setErrorMessage(m.history.errInvalidDate);
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
          setErrorMessage(m.history.errSaveManual);
          return;
        }

        onSessionSaved(saved);
        setManualNote("");
        setIsLoggingManual(false);
      } catch {
        setErrorMessage(m.history.errSaveManual);
      } finally {
        setIsSavingManual(false);
      }
    },
    [
      m.history.errInvalidDate,
      m.history.errSaveManual,
      manualDate,
      manualMinutes,
      manualNote,
      onSessionSaved,
      userId,
    ]
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
          setErrorMessage(data.error ?? m.history.errUpdateNote);
          return;
        }

        onSessionUpdated(data.session);
        setEditingId(null);
        setNoteDraft("");
      } catch {
        setErrorMessage(m.history.errUpdateNote);
      } finally {
        setSavingId(null);
      }
    },
    [m.history.errUpdateNote, noteDraft, onSessionUpdated, userId]
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
          setErrorMessage(data.error ?? m.history.errDeleteSession);
          return;
        }

        onSessionDeleted(id);
      } catch {
        setErrorMessage(m.history.errDeleteSession);
      } finally {
        setDeletingId(null);
      }
    },
    [m.history.errDeleteSession, onSessionDeleted, userId]
  );

  if (!user) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <CalendarDays className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            {m.history.signedOutTitle}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            {m.history.signedOutBody}
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
                  ? m.common.continueWithGoogle
                  : m.common.signInWhenOnline}
              </button>
            </form>
          ) : (
            <p className="mt-4 rounded-xl bg-[var(--surface-muted)] px-3.5 py-2.5 text-xs text-[var(--foreground-muted)]">
              {m.history.authNotConfigured}
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
          {PERIOD_IDS.map((periodId) => {
            const isActive = period === periodId && !selectedDateKey;
            const label = periodId === "all" ? m.common.all : periodId;
            return (
              <button
                key={periodId}
                type="button"
                onClick={() => {
                  setSelectedDateKey(null);
                  setPeriod(periodId);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[var(--surface)] text-[var(--foreground)] shadow-2xs"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
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
                {m.common.cancel}
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                {m.history.log}
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
              aria-label={m.history.exportAria}
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
            {m.history.exportCount(displayedSessions.length)}
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
            {m.history.manualTitle}
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
              {m.history.date}
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
              {m.history.minutes}
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
            placeholder={m.timer.optionalNotePlaceholder}
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
            {m.history.saveSession}
          </button>
        </form>
      )}

      {/* Compact 3-Column KPI Strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <Clock className="h-3 w-3 text-[var(--accent)]" />
            <span>{m.history.total}</span>
          </div>
          <p className="mt-1 text-base font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
            {formatTotalTime(periodStats.totalSeconds)}
          </p>
        </div>

        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <Flame className="h-3 w-3 text-[var(--warm-amber)]" />
            <span>{m.history.streak}</span>
          </div>
          <p className="mt-1 text-base font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
            {allTimeStats.currentStreakDays}{" "}
            <span className="text-xs font-medium text-[var(--foreground-muted)]">
              {allTimeStats.currentStreakDays === 1
                ? m.history.day
                : m.history.days}
            </span>
          </p>
          {allTimeStats.longestStreakDays > 0 && (
            <p className="mt-0.5 text-[10px] text-[var(--foreground-muted)] tabular-nums">
              {m.history.bestStreak(allTimeStats.longestStreakDays)}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-black/6 bg-[var(--surface)] px-3 py-3 text-center shadow-xs dark:border-white/10">
          <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            <CalendarDays className="h-3 w-3 text-[var(--accent)]" />
            <span>{m.history.sessions}</span>
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
              ? m.history.noSessionsTitle
              : m.history.noRangeTitle}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            {sessions.length === 0
              ? m.history.noSessionsBody
              : m.history.noRangeBody}
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
                ? (session.trackTitle ?? m.history.guidedFallback)
                : m.history.silentTimer;

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
                        <span>
                          {formatSessionTimestamp(session.endedAt, intlTag)}
                        </span>
                        {!session.completed && (
                          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--warm-amber)]">
                            {m.history.partial}
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground-muted)]">
                            <CloudOff className="h-2.5 w-2.5" />
                            {m.history.pendingSync}
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
                      title={canMutate ? undefined : m.history.reconnectToEdit}
                      aria-label={
                        session.note
                          ? m.history.editNoteAria
                          : m.history.addNoteAria
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
                        canMutate ? undefined : m.history.reconnectToDelete
                      }
                      aria-label={m.history.deleteSessionAria}
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
                      placeholder={m.history.reflectionPlaceholder}
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
                        {m.common.cancel}
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
                        {m.common.save}
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
