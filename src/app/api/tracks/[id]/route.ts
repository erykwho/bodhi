import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeTrackTags } from "@/lib/tracks/providers";

const updateTrackSchema = z
  .object({
    title: z.string().trim().min(1, "Title cannot be empty").max(160).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
  })
  .refine((data) => data.title !== undefined || data.tags !== undefined, {
    message: "Provide a title or tags to update",
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
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
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
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.tags !== undefined
          ? { tags: normalizeTrackTags(parsed.data.tags) }
          : {}),
      },
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
        tags: updated.tags,
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
