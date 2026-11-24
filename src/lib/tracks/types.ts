export type TrackProviderType =
  | "YOUTUBE"
  | "SOUNDCLOUD"
  | "DIRECT_AUDIO"
  | "GOOGLE_DRIVE";

export interface FavoriteTrackItem {
  id: string;
  provider: TrackProviderType;
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  isFavorite: boolean;
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
