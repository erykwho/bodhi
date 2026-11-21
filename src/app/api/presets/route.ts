import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTimerPreferences } from "@/lib/timer/preferences";
import {
  MAX_PRESET_NAME_LENGTH,
  MAX_TIMER_PRESETS,
  sanitizePresetName,
} from "@/lib/timer/presets";

const createPresetSchema = z.object({
  name: z.string().trim().min(1, "Preset name is required").max(80),
  preferences: z.unknown(),
});

function serializePreset(row: {
  id: string;
  name: string;
  config: unknown;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    preferences: parseTimerPreferences(row.config),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    const presets = await prisma.timerPreset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      take: MAX_TIMER_PRESETS,
    });

    return NextResponse.json({
      presets: presets.map(serializePreset),
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/presets] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load timer presets" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createPresetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid preset payload" },
        { status: 400 }
      );
    }

    const name = sanitizePresetName(parsed.data.name);
    if (!name || name.length > MAX_PRESET_NAME_LENGTH) {
      return NextResponse.json(
        { error: "Preset name is invalid" },
        { status: 400 }
      );
    }

    const count = await prisma.timerPreset.count({
      where: { userId: user.id },
    });
    if (count >= MAX_TIMER_PRESETS) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_TIMER_PRESETS} saved presets reached` },
        { status: 400 }
      );
    }

    const sanitizedPreferences = parseTimerPreferences(parsed.data.preferences);
    const created = await prisma.timerPreset.create({
      data: {
        userId: user.id,
        name,
        config: sanitizedPreferences as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json(
      { preset: serializePreset(created) },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/presets] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save timer preset" },
      { status: 500 }
    );
  }
}
