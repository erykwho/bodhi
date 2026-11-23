import type { MeditationSessionItem } from "@/lib/history/types";

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes meditation sessions into RFC-4180 CSV format.
 */
export function sessionsToCsv(
  sessions: ReadonlyArray<MeditationSessionItem>
): string {
  const headers = [
    "ended_at",
    "started_at",
    "mode",
    "title",
    "provider",
    "duration_seconds",
    "duration_minutes",
    "completed",
    "note",
  ];

  const rows = sessions.map((session) => {
    const title =
      session.mode === "TRACK"
        ? (session.trackTitle ?? "Guided Meditation")
        : session.mode === "BREATHING"
          ? session.breathingPattern
            ? `Breathing · ${session.breathingPattern}`
            : "Guided Breathing"
          : session.plannedDurationSec === null
            ? "Open Timer"
            : "Silent Timer";
    const durationMinutes = Number((session.actualDurationSec / 60).toFixed(2));

    return [
      session.endedAt,
      session.startedAt,
      session.mode,
      title,
      session.trackProvider ?? "",
      session.actualDurationSec,
      durationMinutes,
      session.completed,
      session.note ?? "",
    ]
      .map(escapeCsvCell)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Serializes meditation sessions into a clean JSON backup payload.
 */
export function sessionsToJson(
  sessions: ReadonlyArray<MeditationSessionItem>,
  exportedAt: string = new Date().toISOString()
): string {
  return JSON.stringify(
    {
      app: "Bodhi",
      exportedAt,
      totalSessions: sessions.length,
      sessions,
    },
    null,
    2
  );
}

/**
 * Triggers a browser file download for the generated CSV or JSON export.
 */
export function triggerFileDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
