import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateTrackSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(160),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateTrackSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid title" },
        { status: 400 }
      );
    }

    const existing = await prisma.favoriteTrack.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const updated = await prisma.favoriteTrack.update({
      where: { id: existing.id },
      data: { title: parsed.data.title },
    });

    return NextResponse.json({
      track: {
        id: updated.id,
        provider: updated.provider,
        url: updated.url,
        externalId: updated.externalId,
        title: updated.title,
        author: updated.author,
        thumbnailUrl: updated.thumbnailUrl,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks/:id] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update track" },
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

    const existing = await prisma.favoriteTrack.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    await prisma.favoriteTrack.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks/:id] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete track" },
      { status: 500 }
    );
  }
}
