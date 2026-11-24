import * as SecureStore from "expo-secure-store";
import type { BodhiUserSummary, MobileAuthTokens } from "@bodhi/core/api";

const ACCESS_TOKEN_KEY = "bodhi_mobile_access_token";
const REFRESH_TOKEN_KEY = "bodhi_mobile_refresh_token";
const USER_SUMMARY_KEY = "bodhi_mobile_user_summary";

export interface StoredMobileSession {
  accessToken: string | null;
  refreshToken: string | null;
  user: BodhiUserSummary | null;
}

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function loadStoredSession(): Promise<StoredMobileSession> {
  try {
    const [accessToken, refreshToken, rawUser] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(USER_SUMMARY_KEY),
    ]);

    let user: BodhiUserSummary | null = null;
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser) as Partial<BodhiUserSummary>;
        if (typeof parsed.id === "string" && typeof parsed.email === "string") {
          user = {
            id: parsed.id,
            email: parsed.email,
            name: typeof parsed.name === "string" ? parsed.name : null,
            image: typeof parsed.image === "string" ? parsed.image : null,
          };
        }
      } catch {
        user = null;
      }
    }

    return { accessToken, refreshToken, user };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

export async function saveMobileSession(
  tokens: MobileAuthTokens
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    SecureStore.setItemAsync(USER_SUMMARY_KEY, JSON.stringify(tokens.user)),
  ]);
}

export async function clearMobileSession(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_SUMMARY_KEY),
  ]);
}
