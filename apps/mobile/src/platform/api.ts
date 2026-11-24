import Constants from "expo-constants";
import { createBodhiApiClient } from "@bodhi/core/api";
import {
  clearMobileSession,
  getAccessToken,
  getRefreshToken,
  saveMobileSession,
} from "./secure-tokens";

const extra = Constants.expoConfig?.extra as
  | { apiBaseUrl?: string }
  | undefined;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  extra?.apiBaseUrl ||
  "https://bodhi.vercel.app";

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function subscribeSessionExpired(
  listener: SessionExpiredListener
): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) {
    listener();
  }
}

const rawAuthClient = createBodhiApiClient({
  baseUrl: API_BASE_URL,
});

export const bodhiApi = createBodhiApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken,
  async refreshAccessToken() {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      await clearMobileSession();
      notifySessionExpired();
      return null;
    }

    try {
      const fresh = await rawAuthClient.refreshSession(refreshToken);
      await saveMobileSession(fresh);
      return fresh.accessToken;
    } catch {
      await clearMobileSession();
      notifySessionExpired();
      return null;
    }
  },
});
