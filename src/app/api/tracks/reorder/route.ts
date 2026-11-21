import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mergeTrackOrder } from "@/lib/tracks/reorder";

const reorderTracksSchema = z.object({
  orderedIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one track ID is required")
    .max(500),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = reorderTracksSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid track order" },
        { status: 400 }
      );
    }

    const existing = await prisma.favoriteTrack.findMany({
      where: { userId: user.id },
      select: { id: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });

    const finalIds = mergeTrackOrder(
      parsed.data.orderedIds,
      existing.map((track) => track.id)
    );

    if (finalIds.length > 0) {
      await prisma.$transaction(
        finalIds.map((id, index) =>
          prisma.favoriteTrack.update({
            where: { id },
            data: { position: index },
          })
        )
      );
    }

    return NextResponse.json({ orderedIds: finalIds });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/tracks/reorder] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to save track order" },
      { status: 500 }
    );
  }
}
