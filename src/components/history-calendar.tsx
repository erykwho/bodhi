"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  buildMonthlyCalendar,
  formatTotalTime,
  type CalendarDayCell,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

interface HistoryCalendarProps {
  sessions: ReadonlyArray<MeditationSessionItem>;
  selectedDateKey: string | null;
  onSelectDateKey: (dateKey: string | null) => void;
}

function getIntensityClasses(
  cell: CalendarDayCell,
  isSelected: boolean
): string {
  const base =
    "relative flex h-8 w-full items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors";

  const ring = isSelected
    ? " ring-2 ring-[var(--foreground)] ring-offset-1 ring-offset-[var(--surface)]"
    : cell.isToday
      ? " ring-1 ring-[var(--accent)]"
      : "";

  if (cell.isFuture) {
    return `${base} text-[var(--foreground-muted)]/30`;
  }

  switch (cell.intensity) {
    case 3:
      return `${base} bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]${ring}`;
    case 2:
      return `${base} bg-[var(--accent)]/60 text-[#fcfaf6] dark:text-[#151917]${ring}`;
    case 1:
      return `${base} bg-[var(--accent)]/25 text-[var(--foreground)]${ring}`;
    default:
      return `${base} bg-[var(--background)]/75 text-[var(--foreground-muted)]${ring}`;
  }
}

export function HistoryCalendar({
  sessions,
  selectedDateKey,
  onSelectDateKey,
}: HistoryCalendarProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const [viewYear, setViewYear] = useState<number>(currentYear);
  const [viewMonth, setViewMonth] = useState<number>(currentMonth);

  const calendar = useMemo(
    () => buildMonthlyCalendar(sessions, viewYear, viewMonth),
    [sessions, viewMonth, viewYear]
  );

  const isCurrentMonth =
    viewYear === currentYear && viewMonth === currentMonth;

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(viewYear, viewMonth, 1)),
    [viewMonth, viewYear]
  );

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (isCurrentMonth) return;
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectedCell = selectedDateKey
    ? calendar.days.find((d) => d.dateKey === selectedDateKey) ?? null
    : null;

  return (
    <div className="rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 shadow-xs dark:border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[8rem] text-center text-xs font-semibold text-[var(--foreground)]">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={handleNextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <span className="text-[11px] font-medium text-[var(--foreground-muted)] tabular-nums">
          {calendar.activeDaysCount}{" "}
          {calendar.activeDaysCount === 1 ? "day" : "days"}
          {calendar.totalSecondsInMonth > 0
            ? ` · ${formatTotalTime(calendar.totalSecondsInMonth)}`
            : ""}
        </span>
      </div>

      {/* Weekday Labels */}
      <div className="mt-2.5 grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((label, idx) => (
          <span
            key={`${label}-${idx}`}
            className="text-[10px] font-medium text-[var(--foreground-muted)]/75"
          >
            {label}
          </span>
        ))}
      </div>

      {/* Days Grid */}
      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {Array.from({ length: calendar.leadingEmptyCells }).map((_, idx) => (
          <div key={`empty-${idx}`} className="h-8" />
        ))}

        {calendar.days.map((cell) => {
          const isSelected = selectedDateKey === cell.dateKey;
          const canSelect = cell.sessionCount > 0;
          return (
            <button
              key={cell.dateKey}
              type="button"
              disabled={!canSelect}
              onClick={() =>
                onSelectDateKey(isSelected ? null : cell.dateKey)
              }
              title={
                cell.sessionCount > 0
                  ? `${cell.dateKey}: ${formatTotalTime(cell.totalSeconds)} (${cell.sessionCount})`
                  : cell.dateKey
              }
              className={getIntensityClasses(cell, isSelected)}
            >
              {cell.dayOfMonth}
            </button>
          );
        })}
      </div>

      {/* Selected Day Summary Bar */}
      {selectedCell && (
        <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[var(--background)] px-3 py-1.5 text-[11px] text-[var(--foreground-muted)]">
          <span>
            <strong className="font-semibold text-[var(--foreground)]">
              {selectedCell.dateKey}
            </strong>{" "}
            · {formatTotalTime(selectedCell.totalSeconds)} (
            {selectedCell.sessionCount}{" "}
            {selectedCell.sessionCount === 1 ? "session" : "sessions"})
          </span>
          <button
            type="button"
            onClick={() => onSelectDateKey(null)}
            className="inline-flex items-center gap-0.5 font-medium text-[var(--accent)] hover:underline"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
