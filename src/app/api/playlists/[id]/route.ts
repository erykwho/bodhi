import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  normalizePlaylistDescription,
  normalizePlaylistName,
} from "@/lib/tracks/playlists";
import {
  PLAYLIST_INCLUDE_ITEMS,
  serializePlaylist,
} from "@/lib/tracks/playlist-server";

const updatePlaylistSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Playlist name cannot be empty")
      .max(MAX_PLAYLIST_NAME_LENGTH)
      .optional(),
    description: z
      .string()
      .trim()
      .max(MAX_PLAYLIST_DESCRIPTION_LENGTH)
      .optional()
      .nullable(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    { message: "Provide a playlist name or description to update" }
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updatePlaylistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    const existing = await prisma.trackPlaylist.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    const nextName =
      parsed.data.name !== undefined
        ? normalizePlaylistName(parsed.data.name)
        : undefined;
    if (nextName !== undefined && !nextName) {
      return NextResponse.json(
        { error: "Playlist name cannot be empty" },
        { status: 400 }
      );
    }

    const updated = await prisma.trackPlaylist.update({
      where: { id: existing.id },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(parsed.data.description !== undefined
          ? { description: normalizePlaylistDescription(parsed.data.description) }
          : {}),
      },
      include: PLAYLIST_INCLUDE_ITEMS,
    });

    return NextResponse.json({ playlist: serializePlaylist(updated) });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/:id] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update playlist" },
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

    const existing = await prisma.trackPlaylist.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    await prisma.trackPlaylist.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/playlists/:id] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete playlist" },
      { status: 500 }
    );
  }
}
