export type TrackProviderType = "YOUTUBE" | "SOUNDCLOUD";

export interface FavoriteTrackItem {
  id: string;
  provider: TrackProviderType;
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
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
