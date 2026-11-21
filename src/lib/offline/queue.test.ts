import { describe, expect, it } from "vitest";
import {
  buildPendingSession,
  isPendingSessionId,
  mergeSessionsWithPending,
  pendingSessionToPayload,
} from "./queue";

describe("offline session queue", () => {
  it("builds a pending session with derived startedAt and pendingSync=true", () => {
    const endedAt = "2026-11-21T15:00:00.000Z";
    const pending = buildPendingSession(
      {
        mode: "TIMER",
        plannedDurationSec: 600,
        actualDurationSec: 600,
        completed: true,
        note: "  Calm morning  ",
        endedAt,
      },
      "pending-test-1"
    );

    expect(isPendingSessionId(pending.id)).toBe(true);
    expect(pending.pendingSync).toBe(true);
    expect(pending.note).toBe("Calm morning");
    expect(pending.startedAt).toBe("2026-11-21T14:50:00.000Z");
    expect(pending.endedAt).toBe(endedAt);
  });

  it("converts a pending session cleanly back to a save payload", () => {
    const pending = buildPendingSession(
      {
        mode: "TIMER",
        plannedDurationSec: 300,
        actualDurationSec: 180,
        completed: false,
        note: "Short break",
        startedAt: "2026-11-21T10:00:00.000Z",
        endedAt: "2026-11-21T10:03:00.000Z",
      },
      "pending-test-2"
    );

    expect(pendingSessionToPayload(pending)).toEqual({
      mode: "TIMER",
      trackId: null,
      trackTitle: null,
      trackProvider: null,
      plannedDurationSec: 300,
      actualDurationSec: 180,
      completed: false,
      note: "Short break",
      startedAt: "2026-11-21T10:00:00.000Z",
      endedAt: "2026-11-21T10:03:00.000Z",
    });
  });

  it("merges synced and pending sessions newest-first without duplicates", () => {
    const synced = [
      {
        id: "srv-1",
        mode: "TIMER" as const,
        trackId: null,
        trackTitle: null,
        trackProvider: null,
        plannedDurationSec: 600,
        actualDurationSec: 600,
        completed: true,
        note: null,
        startedAt: "2026-11-20T09:00:00.000Z",
        endedAt: "2026-11-20T09:10:00.000Z",
      },
    ];

    const pending = [
      buildPendingSession(
        {
          mode: "TIMER",
          plannedDurationSec: 900,
          actualDurationSec: 900,
          completed: true,
          endedAt: "2026-11-21T09:15:00.000Z",
        },
        "pending-1"
      ),
    ];

    const merged = mergeSessionsWithPending(synced, pending);
    expect(merged.map((s) => s.id)).toEqual(["pending-1", "srv-1"]);
    expect(merged[0].pendingSync).toBe(true);
    expect(merged[1].pendingSync).toBe(false);
  });
});
