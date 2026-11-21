import { describe, expect, it } from "vitest";
import { sessionsToCsv, sessionsToJson } from "./export";
import type { MeditationSessionItem } from "./types";

const sampleSessions: MeditationSessionItem[] = [
  {
    id: "s1",
    mode: "TIMER",
    trackId: null,
    trackTitle: null,
    trackProvider: null,
    plannedDurationSec: 600,
    actualDurationSec: 600,
    completed: true,
    note: 'Felt calm, "grounded"\nand rested',
    startedAt: "2026-11-21T08:00:00.000Z",
    endedAt: "2026-11-21T08:10:00.000Z",
  },
  {
    id: "s2",
    mode: "TRACK",
    trackId: "t1",
    trackTitle: "Morning Breath, Vol. 1",
    trackProvider: "YOUTUBE",
    plannedDurationSec: null,
    actualDurationSec: 900,
    completed: true,
    note: null,
    startedAt: "2026-11-20T07:00:00.000Z",
    endedAt: "2026-11-20T07:15:00.000Z",
  },
];

describe("history export", () => {
  it("serializes sessions into RFC-4180 CSV with escaped quotes, commas, and newlines", () => {
    const csv = sessionsToCsv(sampleSessions);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "ended_at,started_at,mode,title,provider,duration_seconds,duration_minutes,completed,note"
    );
    expect(csv).toContain('"Felt calm, ""grounded""\nand rested"');
    expect(csv).toContain('"Morning Breath, Vol. 1",YOUTUBE,900,15,true,');
  });

  it("serializes sessions into structured JSON backup", () => {
    const json = sessionsToJson(sampleSessions, "2026-11-21T12:00:00.000Z");
    const parsed = JSON.parse(json) as {
      app: string;
      exportedAt: string;
      totalSessions: number;
      sessions: MeditationSessionItem[];
    };
    expect(parsed.app).toBe("Bodhi");
    expect(parsed.exportedAt).toBe("2026-11-21T12:00:00.000Z");
    expect(parsed.totalSessions).toBe(2);
    expect(parsed.sessions).toHaveLength(2);
  });
});
