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

export type ExternalPlaylistProviderType = "YOUTUBE" | "SOUNDCLOUD";

export interface TrackPlaylistItem {
  id: string;
  name: string;
  description: string | null;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedExternalPlaylistTrack {
  provider: ExternalPlaylistProviderType;
  url: string;
  externalId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
}

export interface ResolvedExternalPlaylist {
  provider: ExternalPlaylistProviderType;
  externalId: string;
  url: string;
  title: string;
  author: string | null;
  totalCount: number;
  truncated: boolean;
  limit: number;
  tracks: ResolvedExternalPlaylistTrack[];
}
