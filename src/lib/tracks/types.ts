export type TrackProviderType = "YOUTUBE" | "SOUNDCLOUD" | "DIRECT_AUDIO";

export interface FavoriteTrackItem {
  id: string;
  provider: TrackProviderType;
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  createdAt: string;
}

export interface ResolvedTrackMetadata {
  provider: TrackProviderType;
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
}
