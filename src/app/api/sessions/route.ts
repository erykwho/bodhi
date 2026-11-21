import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createSessionSchema = z.object({
  mode: z.enum(["TIMER", "TRACK"]),
  trackId: z.string().trim().min(1).max(100).optional().nullable(),
  trackTitle: z.string().trim().max(160).optional().nullable(),
  trackProvider: z.enum(["YOUTUBE", "SOUNDCLOUD"]).optional().nullable(),
  plannedDurationSec: z
    .number()
    .int()
    .min(1)
    .max(60 * 60 * 6)
    .optional()
    .nullable(),
  actualDurationSec: z
    .number()
    .int()
    .min(1)
    .max(60 * 60 * 6),
  completed: z.boolean().default(true),
  note: z.string().trim().max(500).optional().nullable(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

function serializeSession(session: {
  id: string;
  mode: "TIMER" | "TRACK";
  trackId: string | null;
  trackTitle: string | null;
  trackProvider: "YOUTUBE" | "SOUNDCLOUD" | null;
  plannedDurationSec: number | null;
  actualDurationSec: number;
  completed: boolean;
  note: string | null;
  startedAt: Date;
  endedAt: Date;
}) {
  return {
    id: session.id,
    mode: session.mode,
    trackId: session.trackId,
    trackTitle: session.trackTitle,
    trackProvider: session.trackProvider,
    plannedDurationSec: session.plannedDurationSec,
    actualDurationSec: session.actualDurationSec,
    completed: session.completed,
    note: session.note,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    const sessions = await prisma.meditationSession.findMany({
      where: { userId: user.id },
      orderBy: { endedAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      sessions: sessions.map(serializeSession),
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/sessions] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load meditation history" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid session payload" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const endedAt = data.endedAt ? new Date(data.endedAt) : new Date();
    const startedAt = data.startedAt
      ? new Date(data.startedAt)
      : new Date(endedAt.getTime() - data.actualDurationSec * 1000);

    let verifiedTrackId: string | null = null;
    let resolvedTrackTitle = data.trackTitle ?? null;
    let resolvedTrackProvider = data.trackProvider ?? null;

    if (data.trackId) {
      const ownedTrack = await prisma.favoriteTrack.findFirst({
        where: { id: data.trackId, userId: user.id },
        select: { id: true, title: true, provider: true },
      });
      if (ownedTrack) {
        verifiedTrackId = ownedTrack.id;
        resolvedTrackTitle = resolvedTrackTitle ?? ownedTrack.title;
        resolvedTrackProvider = resolvedTrackProvider ?? ownedTrack.provider;
      }
    }

    const created = await prisma.meditationSession.create({
      data: {
        userId: user.id,
        mode: data.mode,
        trackId: verifiedTrackId,
        trackTitle: resolvedTrackTitle,
        trackProvider: resolvedTrackProvider,
        plannedDurationSec: data.plannedDurationSec ?? null,
        actualDurationSec: data.actualDurationSec,
        completed: data.completed,
        note: data.note?.trim() || null,
        startedAt,
        endedAt,
      },
    });

    return NextResponse.json(
      { session: serializeSession(created) },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/sessions] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save meditation session" },
      { status: 500 }
    );
  }
}
