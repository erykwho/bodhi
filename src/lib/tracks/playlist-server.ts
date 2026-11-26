import type { Prisma } from "@prisma/client";
import type { FavoriteTrackItem, TrackPlaylistItem } from "@/lib/tracks/types";

export interface PrismaPlaylistRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{ trackId: string }>;
}

export interface PrismaTrackRow {
  id: string;
  provider: FavoriteTrackItem["provider"];
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  isFavorite: boolean;
  createdAt: Date;
}

export const PLAYLIST_INCLUDE_ITEMS = {
  items: {
    select: { trackId: true as const },
    orderBy: [{ position: "asc" as const }, { addedAt: "asc" as const }],
  },
} satisfies Prisma.TrackPlaylistInclude;

export function serializePlaylist(row: PrismaPlaylistRow): TrackPlaylistItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackIds: row.items.map((item) => item.trackId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeTrack(row: PrismaTrackRow): FavoriteTrackItem {
  return {
    id: row.id,
    provider: row.provider,
    url: row.url,
    externalId: row.externalId,
    title: row.title,
    author: row.author,
    thumbnailUrl: row.thumbnailUrl,
    tags: row.tags,
    isFavorite: row.isFavorite,
    createdAt: row.createdAt.toISOString(),
  };
}
