import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSessionSchema = z.object({
  note: z.string().trim().max(500).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid note" },
        { status: 400 }
      );
    }

    const existing = await prisma.meditationSession.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.meditationSession.update({
      where: { id: existing.id },
      data: { note: parsed.data.note?.trim() || null },
    });

    return NextResponse.json({
      session: {
        id: updated.id,
        mode: updated.mode,
        trackId: updated.trackId,
        trackTitle: updated.trackTitle,
        trackProvider: updated.trackProvider,
        plannedDurationSec: updated.plannedDurationSec,
        actualDurationSec: updated.actualDurationSec,
        completed: updated.completed,
        note: updated.note,
        startedAt: updated.startedAt.toISOString(),
        endedAt: updated.endedAt.toISOString(),
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/sessions/:id] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update session note" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.meditationSession.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    await prisma.meditationSession.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/sessions/:id] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
