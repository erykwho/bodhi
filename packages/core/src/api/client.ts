import type {
  MeditationSessionItem,
  SaveSessionPayload,
} from "../history/types";
import type { TimerPreferences } from "../timer/types";
import type { TimerPresetItem } from "../timer/presets";
import type {
  FavoriteTrackItem,
  ResolvedTrackMetadata,
  TrackProviderType,
} from "../tracks/types";

export interface BodhiUserSummary {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface MobileAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: BodhiUserSummary;
}

export interface BootstrapPayload {
  user: BodhiUserSummary;
  tracks: FavoriteTrackItem[];
  sessions: MeditationSessionItem[];
  presets: TimerPresetItem[];
}

export interface CreateTrackPayload {
  url: string;
  title?: string;
  author?: string | null;
  thumbnailUrl?: string | null;
  tags?: string[];
  provider?: TrackProviderType;
}

export interface UpdateTrackPayload {
  title?: string;
  tags?: string[];
  isFavorite?: boolean;
}

export interface BodhiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type BodhiFetchFn = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<BodhiFetchResponse>;

export interface BodhiApiClientConfig {
  /** Base origin (e.g. "https://bodhi.app" on mobile, or "" on web). */
  baseUrl: string;
  /** Optional bearer access token provider for native clients. */
  getAccessToken?: () => Promise<string | null> | string | null;
  /** Optional single-flight refresh callback invoked on 401 responses. */
  refreshAccessToken?: () => Promise<string | null>;
  /** Custom fetch implementation (defaults to global fetch). */
  fetchFn?: BodhiFetchFn;
}

export class BodhiApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BodhiApiError";
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export function createBodhiApiClient(config: BodhiApiClientConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchImpl: BodhiFetchFn =
    config.fetchFn ??
    ((input, init) =>
      globalThis.fetch(input, init) as Promise<BodhiFetchResponse>);

  let inflightRefresh: Promise<string | null> | null = null;

  async function runRefresh(): Promise<string | null> {
    if (!config.refreshAccessToken) return null;
    if (!inflightRefresh) {
      inflightRefresh = Promise.resolve(config.refreshAccessToken()).finally(
        () => {
          inflightRefresh = null;
        }
      );
    }
    return inflightRefresh;
  }

  async function request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
    } = {}
  ): Promise<T> {
    const { method = "GET", body, auth = true } = options;
    const url = `${baseUrl}${path}`;

    const execute = async (tokenOverride?: string | null) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (auth) {
        const token =
          tokenOverride !== undefined
            ? tokenOverride
            : config.getAccessToken
              ? await config.getAccessToken()
              : null;
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
      return fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    let response = await execute();

    if (response.status === 401 && auth && config.refreshAccessToken) {
      const freshToken = await runRefresh();
      if (freshToken) {
        response = await execute(freshToken);
      }
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new BodhiApiError(
        response.status,
        extractErrorMessage(payload, `Request failed with status ${response.status}`)
      );
    }

    return payload as T;
  }

  return {
    getAudioStreamUrl(trackId: string): string {
      return `${baseUrl}/api/tracks/${encodeURIComponent(trackId)}/audio`;
    },

    // Mobile Auth
    signInWithGoogleIdToken(idToken: string, deviceName?: string) {
      return request<MobileAuthTokens>("/api/mobile/auth/google", {
        method: "POST",
        body: { idToken, deviceName },
        auth: false,
      });
    },

    signInWithAppleIdentityToken(params: {
      identityToken: string;
      fullName?: string | null;
      email?: string | null;
      deviceName?: string;
    }) {
      return request<MobileAuthTokens>("/api/mobile/auth/apple", {
        method: "POST",
        body: params,
        auth: false,
      });
    },

    refreshSession(refreshToken: string) {
      return request<MobileAuthTokens>("/api/mobile/auth/refresh", {
        method: "POST",
        body: { refreshToken },
        auth: false,
      });
    },

    logoutMobile(refreshToken: string) {
      return request<{ ok: true }>("/api/mobile/auth/logout", {
        method: "POST",
        body: { refreshToken },
        auth: false,
      });
    },

    // Bootstrap & Account
    bootstrap() {
      return request<BootstrapPayload>("/api/mobile/bootstrap");
    },

    deleteAccount() {
      return request<{ deleted: true }>("/api/account", {
        method: "DELETE",
      });
    },

    // Sessions
    listSessions() {
      return request<{ sessions: MeditationSessionItem[] }>("/api/sessions");
    },

    createSession(payload: SaveSessionPayload) {
      return request<{ session: MeditationSessionItem }>("/api/sessions", {
        method: "POST",
        body: payload,
      });
    },

    updateSessionNote(sessionId: string, note: string | null) {
      return request<{ session: MeditationSessionItem }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          body: { note },
        }
      );
    },

    deleteSession(sessionId: string) {
      return request<{ deleted: true }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "DELETE",
        }
      );
    },

    // Tracks
    listTracks() {
      return request<{ tracks: FavoriteTrackItem[] }>("/api/tracks");
    },

    resolveTrack(url: string) {
      return request<{ track: ResolvedTrackMetadata }>("/api/tracks/resolve", {
        method: "POST",
        body: { url },
      });
    },

    createTrack(payload: CreateTrackPayload) {
      return request<{ track: FavoriteTrackItem }>("/api/tracks", {
        method: "POST",
        body: payload,
      });
    },

    updateTrack(trackId: string, payload: UpdateTrackPayload) {
      return request<{ track: FavoriteTrackItem }>(
        `/api/tracks/${encodeURIComponent(trackId)}`,
        {
          method: "PATCH",
          body: payload,
        }
      );
    },

    reorderTracks(orderedIds: string[]) {
      return request<{ orderedIds: string[] }>("/api/tracks/reorder", {
        method: "PATCH",
        body: { orderedIds },
      });
    },

    deleteTrack(trackId: string) {
      return request<{ deleted: true }>(
        `/api/tracks/${encodeURIComponent(trackId)}`,
        {
          method: "DELETE",
        }
      );
    },

    // Presets
    listPresets() {
      return request<{ presets: TimerPresetItem[] }>("/api/presets");
    },

    createPreset(name: string, preferences: TimerPreferences) {
      return request<{ preset: TimerPresetItem }>("/api/presets", {
        method: "POST",
        body: { name, preferences },
      });
    },

    deletePreset(presetId: string) {
      return request<{ deleted: true }>(
        `/api/presets/${encodeURIComponent(presetId)}`,
        {
          method: "DELETE",
        }
      );
    },
  };
}

export type BodhiApiClient = ReturnType<typeof createBodhiApiClient>;
