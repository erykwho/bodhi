import {
  MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS,
  parsePlaylistUrl,
} from "@/lib/tracks/playlists";
import type {
  ResolvedExternalPlaylist,
  ResolvedExternalPlaylistTrack,
} from "@/lib/tracks/types";

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const SOUNDCLOUD_CLIENT_ID_REGEX = /client_id\s*[:=]\s*["']([a-zA-Z0-9]{20,40})["']/;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

/**
 * Extracts a balanced JSON value (object `{...}` or array `[...]`) starting
 * immediately after `marker` in an HTML document.
 */
function extractBalancedJsonAfterMarker(
  html: string,
  marker: string,
  openChar: "{" | "[",
  closeChar: "}" | "]"
): string | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  const startIndex = html.indexOf(openChar, markerIndex + marker.length);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < html.length; i++) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function readYouTubeText(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as {
    simpleText?: unknown;
    runs?: Array<{ text?: unknown }>;
  };
  if (typeof obj.simpleText === "string" && obj.simpleText.trim()) {
    return obj.simpleText.trim();
  }
  if (Array.isArray(obj.runs)) {
    const joined = obj.runs
      .map((run) => (typeof run?.text === "string" ? run.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  return null;
}

function isUnavailableYouTubeTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized === "[private video]" ||
    normalized === "[deleted video]" ||
    normalized === "private video" ||
    normalized === "deleted video"
  );
}

function parseLeadingCount(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[.,\s\u00a0]/g, "");
  const match = cleaned.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function collectYouTubePlaylistRenderers(
  root: unknown,
  videos: Array<Record<string, unknown>>,
  state: { hasContinuation: boolean }
): void {
  if (!root || typeof root !== "object") return;

  if (Array.isArray(root)) {
    for (const item of root) {
      collectYouTubePlaylistRenderers(item, videos, state);
    }
    return;
  }

  const record = root as Record<string, unknown>;
  if (
    record.playlistVideoRenderer &&
    typeof record.playlistVideoRenderer === "object"
  ) {
    videos.push(record.playlistVideoRenderer as Record<string, unknown>);
    return;
  }

  if (record.continuationItemRenderer) {
    state.hasContinuation = true;
    return;
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectYouTubePlaylistRenderers(value, videos, state);
    }
  }
}

/**
 * Pure parser for YouTube's embedded `ytInitialData` playlist payload.
 * Exported for deterministic unit testing.
 */
export function extractYouTubeInitialDataPlaylist(
  html: string,
  playlistId: string,
  canonicalUrl: string,
  limit = MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS
): ResolvedExternalPlaylist | null {
  const markers = [
    "var ytInitialData =",
    'window["ytInitialData"] =',
    "ytInitialData =",
  ];

  let jsonStr: string | null = null;
  for (const marker of markers) {
    jsonStr = extractBalancedJsonAfterMarker(html, marker, "{", "}");
    if (jsonStr) break;
  }
  if (!jsonStr) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }

  const metadata = data.metadata as
    | { playlistMetadataRenderer?: { title?: string } }
    | undefined;
  const header = data.header as
    | {
        playlistHeaderRenderer?: {
          title?: unknown;
          ownerText?: unknown;
          numVideosText?: unknown;
          stats?: unknown[];
        };
        pageHeaderRenderer?: {
          pageTitle?: string;
        };
      }
    | undefined;

  const title =
    metadata?.playlistMetadataRenderer?.title?.trim() ||
    readYouTubeText(header?.playlistHeaderRenderer?.title) ||
    header?.pageHeaderRenderer?.pageTitle?.trim() ||
    "YouTube Playlist";

  const author =
    readYouTubeText(header?.playlistHeaderRenderer?.ownerText) ?? null;

  const rawVideos: Array<Record<string, unknown>> = [];
  const walkState = { hasContinuation: false };
  collectYouTubePlaylistRenderers(data, rawVideos, walkState);

  const seenIds = new Set<string>();
  const allPlayableTracks: ResolvedExternalPlaylistTrack[] = [];

  for (const video of rawVideos) {
    const videoId = typeof video.videoId === "string" ? video.videoId.trim() : "";
    if (!YOUTUBE_ID_REGEX.test(videoId) || seenIds.has(videoId)) continue;
    if (video.isPlayable === false) continue;

    const trackTitle = readYouTubeText(video.title) ?? "YouTube Meditation";
    if (isUnavailableYouTubeTitle(trackTitle)) continue;

    const trackAuthor =
      readYouTubeText(video.shortBylineText) ??
      readYouTubeText(video.longBylineText) ??
      author;

    const thumbs = (video.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)
      ?.thumbnails;
    const rawThumb =
      Array.isArray(thumbs) && thumbs.length > 0
        ? thumbs[thumbs.length - 1]?.url
        : undefined;
    const thumbnailUrl =
      typeof rawThumb === "string" && /^https?:\/\//i.test(rawThumb)
        ? rawThumb
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    seenIds.add(videoId);
    allPlayableTracks.push({
      provider: "YOUTUBE",
      externalId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: trackTitle,
      author: trackAuthor,
      thumbnailUrl,
    });
  }

  if (allPlayableTracks.length === 0) return null;

  const headerCount =
    parseLeadingCount(readYouTubeText(header?.playlistHeaderRenderer?.numVideosText)) ??
    (Array.isArray(header?.playlistHeaderRenderer?.stats)
      ? parseLeadingCount(readYouTubeText(header.playlistHeaderRenderer.stats[0]))
      : null);

  const totalCount = Math.max(
    headerCount ?? 0,
    allPlayableTracks.length,
    walkState.hasContinuation ? allPlayableTracks.length + 1 : 0
  );
  const sliced = allPlayableTracks.slice(0, limit);
  const truncated =
    allPlayableTracks.length > limit ||
    totalCount > limit ||
    walkState.hasContinuation;

  return {
    provider: "YOUTUBE",
    externalId: playlistId,
    url: canonicalUrl,
    title,
    author,
    totalCount,
    truncated,
    limit,
    tracks: sliced,
  };
}

/**
 * Pure parser for YouTube's public XML RSS feed (`/feeds/videos.xml?playlist_id=...`).
 * Exported for deterministic unit testing.
 */
export function parseYouTubeRssPlaylist(
  xml: string,
  playlistId: string,
  canonicalUrl: string,
  limit = MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS
): ResolvedExternalPlaylist | null {
  if (!xml.includes("<feed")) return null;

  const feedHeaderEnd = xml.indexOf("<entry>");
  const headerXml = feedHeaderEnd === -1 ? xml : xml.slice(0, feedHeaderEnd);

  const feedTitleMatch = headerXml.match(/<title>([\s\S]*?)<\/title>/i);
  const feedAuthorMatch = headerXml.match(
    /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i
  );

  const title = feedTitleMatch?.[1]
    ? decodeXmlEntities(feedTitleMatch[1].trim())
    : "YouTube Playlist";
  const author = feedAuthorMatch?.[1]
    ? decodeXmlEntities(feedAuthorMatch[1].trim())
    : null;

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  const tracks: ResolvedExternalPlaylistTrack[] = [];
  const seenIds = new Set<string>();
  let totalValid = 0;

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1]?.trim();
    if (!videoId || !YOUTUBE_ID_REGEX.test(videoId) || seenIds.has(videoId)) {
      continue;
    }

    const rawTitle = entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const trackTitle = rawTitle
      ? decodeXmlEntities(rawTitle)
      : "YouTube Meditation";
    if (isUnavailableYouTubeTitle(trackTitle)) continue;

    const rawAuthor = entry.match(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i
    )?.[1]?.trim();
    const thumbMatch = entry.match(/<media:thumbnail[^>]*url="([^"]+)"/i);

    seenIds.add(videoId);
    totalValid += 1;

    if (tracks.length < limit) {
      tracks.push({
        provider: "YOUTUBE",
        externalId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: trackTitle,
        author: rawAuthor ? decodeXmlEntities(rawAuthor) : author,
        thumbnailUrl:
          thumbMatch?.[1] ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }
  }

  if (tracks.length === 0) return null;

  return {
    provider: "YOUTUBE",
    externalId: playlistId,
    url: canonicalUrl,
    title,
    author,
    totalCount: totalValid,
    truncated: totalValid > limit,
    limit,
    tracks,
  };
}

interface YouTubeApiPlaylistResponse {
  items?: Array<{
    snippet?: { title?: string; channelTitle?: string };
    contentDetails?: { itemCount?: number };
  }>;
}

interface YouTubeApiPlaylistItemsResponse {
  pageInfo?: { totalResults?: number };
  nextPageToken?: string;
  items?: Array<{
    snippet?: {
      title?: string;
      videoOwnerChannelTitle?: string;
      channelTitle?: string;
      resourceId?: { videoId?: string };
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
}

async function resolveYouTubePlaylistViaApi(
  playlistId: string,
  canonicalUrl: string,
  apiKey: string,
  limit: number
): Promise<ResolvedExternalPlaylist | null> {
  try {
    const metaUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}`;
    const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${Math.min(50, limit)}&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}`;

    const [metaRes, itemsRes] = await Promise.all([
      fetch(metaUrl, { signal: AbortSignal.timeout(6000) }),
      fetch(itemsUrl, { signal: AbortSignal.timeout(6000) }),
    ]);

    if (!itemsRes.ok) return null;

    const metaJson = metaRes.ok
      ? ((await metaRes.json()) as YouTubeApiPlaylistResponse)
      : null;
    const itemsJson = (await itemsRes.json()) as YouTubeApiPlaylistItemsResponse;

    const metaItem = metaJson?.items?.[0];
    const title = metaItem?.snippet?.title?.trim() || "YouTube Playlist";
    const author = metaItem?.snippet?.channelTitle?.trim() || null;

    const tracks: ResolvedExternalPlaylistTrack[] = [];
    const seenIds = new Set<string>();

    for (const item of itemsJson.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId?.trim() ?? "";
      if (!YOUTUBE_ID_REGEX.test(videoId) || seenIds.has(videoId)) continue;

      const trackTitle = item.snippet?.title?.trim() || "YouTube Meditation";
      if (isUnavailableYouTubeTitle(trackTitle)) continue;

      const trackAuthor =
        item.snippet?.videoOwnerChannelTitle?.trim() ||
        item.snippet?.channelTitle?.trim() ||
        author;
      const thumbnailUrl =
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      seenIds.add(videoId);
      tracks.push({
        provider: "YOUTUBE",
        externalId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: trackTitle,
        author: trackAuthor,
        thumbnailUrl,
      });

      if (tracks.length >= limit) break;
    }

    if (tracks.length === 0) return null;

    const reportedTotal =
      metaItem?.contentDetails?.itemCount ??
      itemsJson.pageInfo?.totalResults ??
      tracks.length;
    const totalCount = Math.max(reportedTotal, tracks.length);

    return {
      provider: "YOUTUBE",
      externalId: playlistId,
      url: canonicalUrl,
      title,
      author,
      totalCount,
      truncated: totalCount > limit || Boolean(itemsJson.nextPageToken),
      limit,
      tracks,
    };
  } catch {
    return null;
  }
}

async function resolveYouTubePlaylist(
  playlistId: string,
  canonicalUrl: string,
  limit: number
): Promise<ResolvedExternalPlaylist | null> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (apiKey) {
    const viaApi = await resolveYouTubePlaylistViaApi(
      playlistId,
      canonicalUrl,
      apiKey,
      limit
    );
    if (viaApi) return viaApi;
  }

  // Zero-config primary: public YouTube playlist page (`ytInitialData`)
  try {
    const htmlRes = await fetch(
      `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`,
      {
        signal: AbortSignal.timeout(7000),
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+667",
        },
      }
    );
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const parsed = extractYouTubeInitialDataPlaylist(
        html,
        playlistId,
        canonicalUrl,
        limit
      );
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to official YouTube XML RSS feed
  }

  // Zero-config secondary: official YouTube XML RSS feed (up to 15 latest items)
  try {
    const rssRes = await fetch(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
      }
    );
    if (rssRes.ok) {
      const xml = await rssRes.text();
      return parseYouTubeRssPlaylist(xml, playlistId, canonicalUrl, limit);
    }
  } catch {
    // Unreachable or private playlist
  }

  return null;
}

interface SoundCloudTrackObject {
  id?: number;
  permalink_url?: string;
  secret_token?: string | null;
  title?: string;
  artwork_url?: string | null;
  user?: {
    username?: string;
    full_name?: string;
    avatar_url?: string | null;
  };
}

interface SoundCloudPlaylistData {
  title?: string;
  track_count?: number;
  user?: {
    username?: string;
    full_name?: string;
  };
  tracks?: SoundCloudTrackObject[];
}

function normalizeSoundCloudTrackObject(
  track: SoundCloudTrackObject,
  fallbackAuthor: string | null
): ResolvedExternalPlaylistTrack | null {
  if (!track.permalink_url || typeof track.permalink_url !== "string") {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(track.permalink_url);
  } catch {
    return null;
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[1].toLowerCase() === "sets") {
    return null;
  }

  const secretToken =
    typeof track.secret_token === "string" &&
    /^s-[A-Za-z0-9_-]{4,64}$/.test(track.secret_token)
      ? track.secret_token
      : segments.length >= 3 && /^s-[A-Za-z0-9_-]{4,64}$/.test(segments[2])
        ? segments[2]
        : null;

  const externalId = secretToken
    ? `${segments[0]}/${segments[1]}/${secretToken}`
    : `${segments[0]}/${segments[1]}`;

  const rawArtwork = track.artwork_url || track.user?.avatar_url || null;
  const thumbnailUrl =
    typeof rawArtwork === "string" && /^https?:\/\//i.test(rawArtwork)
      ? rawArtwork.replace("-large.", "-t500x500.")
      : null;

  return {
    provider: "SOUNDCLOUD",
    externalId,
    url: `https://soundcloud.com/${externalId}`,
    title: track.title?.trim() || "SoundCloud Meditation",
    author:
      track.user?.username?.trim() ||
      track.user?.full_name?.trim() ||
      fallbackAuthor,
    thumbnailUrl,
  };
}

/**
 * Pure parser for SoundCloud's embedded `window.__sc_hydration` playlist payload.
 * Returns both resolved tracks and any unhydrated track IDs within the import limit.
 */
export function extractSoundCloudHydrationPlaylist(
  html: string,
  playlistExternalId: string,
  canonicalUrl: string,
  limit = MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS
): {
  playlist: ResolvedExternalPlaylist;
  missingTrackIds: number[];
  orderedSlots: Array<
    | { kind: "track"; track: ResolvedExternalPlaylistTrack }
    | { kind: "stub"; id: number }
  >;
} | null {
  const jsonStr = extractBalancedJsonAfterMarker(
    html,
    "window.__sc_hydration =",
    "[",
    "]"
  );
  if (!jsonStr) return null;

  let hydration: Array<{ hydratable?: string; data?: unknown }>;
  try {
    hydration = JSON.parse(jsonStr) as Array<{
      hydratable?: string;
      data?: unknown;
    }>;
  } catch {
    return null;
  }

  const playlistEntry = hydration.find(
    (entry) => entry?.hydratable === "playlist" && entry.data
  );
  if (!playlistEntry) return null;

  const data = playlistEntry.data as SoundCloudPlaylistData;
  const rawTracks = Array.isArray(data.tracks) ? data.tracks : [];
  if (rawTracks.length === 0) return null;

  const title = data.title?.trim() || "SoundCloud Playlist";
  const author =
    data.user?.username?.trim() || data.user?.full_name?.trim() || null;

  const limitedRaw = rawTracks.slice(0, limit);
  const tracks: ResolvedExternalPlaylistTrack[] = [];
  const missingTrackIds: number[] = [];
  const orderedSlots: Array<
    | { kind: "track"; track: ResolvedExternalPlaylistTrack }
    | { kind: "stub"; id: number }
  > = [];
  const seenExternalIds = new Set<string>();

  for (const rawTrack of limitedRaw) {
    const normalized = normalizeSoundCloudTrackObject(rawTrack, author);
    if (normalized) {
      if (!seenExternalIds.has(normalized.externalId)) {
        seenExternalIds.add(normalized.externalId);
        tracks.push(normalized);
        orderedSlots.push({ kind: "track", track: normalized });
      }
    } else if (typeof rawTrack?.id === "number" && Number.isFinite(rawTrack.id)) {
      missingTrackIds.push(rawTrack.id);
      orderedSlots.push({ kind: "stub", id: rawTrack.id });
    }
  }

  if (tracks.length === 0 && missingTrackIds.length === 0) return null;

  const totalCount = Math.max(
    typeof data.track_count === "number" ? data.track_count : 0,
    rawTracks.length,
    tracks.length
  );

  return {
    playlist: {
      provider: "SOUNDCLOUD",
      externalId: playlistExternalId,
      url: canonicalUrl,
      title,
      author,
      totalCount,
      truncated: totalCount > limit || rawTracks.length > limit,
      limit,
      tracks,
    },
    missingTrackIds,
    orderedSlots,
  };
}

async function discoverSoundCloudClientId(html: string): Promise<string | null> {
  const scriptUrls = Array.from(
    html.matchAll(
      /<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/gi
    )
  )
    .map((m) => m[1])
    .slice(-4)
    .reverse();

  for (const scriptUrl of scriptUrls) {
    try {
      const res = await fetch(scriptUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const match = text.match(SOUNDCLOUD_CLIENT_ID_REGEX);
      if (match?.[1]) return match[1];
    } catch {
      // Try next asset bundle
    }
  }

  return null;
}

async function resolveSoundCloudPlaylist(
  externalId: string,
  canonicalUrl: string,
  limit: number
): Promise<ResolvedExternalPlaylist | null> {
  try {
    const pageRes = await fetch(canonicalUrl, {
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!pageRes.ok) return null;

    const html = await pageRes.text();
    const extracted = extractSoundCloudHydrationPlaylist(
      html,
      externalId,
      canonicalUrl,
      limit
    );
    if (!extracted) return null;

    // Hydrate any stub track IDs (SoundCloud typically hydrates the first ~5 tracks inline)
    if (extracted.missingTrackIds.length > 0) {
      const clientId = await discoverSoundCloudClientId(html);
      if (clientId) {
        try {
          const idsParam = extracted.missingTrackIds.slice(0, limit).join(",");
          const apiRes = await fetch(
            `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(idsParam)}&client_id=${encodeURIComponent(clientId)}`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (apiRes.ok) {
            const hydratedList = (await apiRes.json()) as SoundCloudTrackObject[];
            const byId = new Map<number, ResolvedExternalPlaylistTrack>();
            for (const item of hydratedList) {
              if (typeof item.id !== "number") continue;
              const normalized = normalizeSoundCloudTrackObject(
                item,
                extracted.playlist.author
              );
              if (normalized) {
                byId.set(item.id, normalized);
              }
            }

            const orderedTracks: ResolvedExternalPlaylistTrack[] = [];
            const seen = new Set<string>();
            for (const slot of extracted.orderedSlots) {
              const track =
                slot.kind === "track" ? slot.track : byId.get(slot.id);
              if (!track || seen.has(track.externalId)) continue;
              seen.add(track.externalId);
              orderedTracks.push(track);
              if (orderedTracks.length >= limit) break;
            }

            if (orderedTracks.length > 0) {
              return {
                ...extracted.playlist,
                tracks: orderedTracks,
              };
            }
          }
        } catch {
          // Keep already-hydrated tracks gracefully
        }
      }
    }

    return extracted.playlist.tracks.length > 0 ? extracted.playlist : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a public YouTube playlist or SoundCloud set URL into a bounded preview
 * of up to `MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS` (50) playable tracks.
 */
export async function resolveExternalPlaylist(
  rawUrl: string,
  limit = MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS
): Promise<ResolvedExternalPlaylist | null> {
  const parsed = parsePlaylistUrl(rawUrl);
  if (!parsed) return null;

  const clampedLimit = Math.max(
    1,
    Math.min(limit, MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS)
  );

  if (parsed.provider === "YOUTUBE") {
    return resolveYouTubePlaylist(
      parsed.externalId,
      parsed.canonicalUrl,
      clampedLimit
    );
  }

  return resolveSoundCloudPlaylist(
    parsed.externalId,
    parsed.canonicalUrl,
    clampedLimit
  );
}
