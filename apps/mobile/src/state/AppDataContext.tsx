import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import type { BodhiUserSummary } from "@bodhi/core/api";
import type {
  MeditationSessionItem,
  SaveSessionPayload,
} from "@bodhi/core/history/types";
import {
  isPendingSessionId,
  mergeSessionsWithPending,
  pendingSessionToPayload,
} from "@bodhi/core/offline/queue";
import type { TimerPresetItem } from "@bodhi/core/timer/presets";
import type { TimerPreferences } from "@bodhi/core/timer/types";
import type { FavoriteTrackItem } from "@bodhi/core/tracks/types";
import { bodhiApi, subscribeSessionExpired } from "../platform/api";
import { recordMindfulSessionIfEnabled } from "../platform/health";
import { useOnlineStatus } from "../platform/network";
import {
  clearMobileSession,
  getRefreshToken,
  loadStoredSession,
  saveMobileSession,
} from "../platform/secure-tokens";
import {
  mobileOfflineQueue,
  readCachedTracks,
  readLocalPresets,
  writeCachedTracks,
  writeLocalPresets,
} from "../platform/storage";

interface AppDataContextValue {
  user: BodhiUserSummary | null;
  isHydrated: boolean;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  tracks: FavoriteTrackItem[];
  sessions: MeditationSessionItem[];
  presets: TimerPresetItem[];
  setTracks: React.Dispatch<React.SetStateAction<FavoriteTrackItem[]>>;
  refreshAll: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  saveSession: (
    payload: SaveSessionPayload
  ) => Promise<MeditationSessionItem | null>;
  updateSessionNote: (
    sessionId: string,
    note: string | null
  ) => Promise<MeditationSessionItem | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  createPreset: (
    name: string,
    preferences: TimerPreferences
  ) => Promise<TimerPresetItem | null>;
  deletePreset: (presetId: string) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

const extra = Constants.expoConfig?.extra as
  | { googleWebClientId?: string; googleIosClientId?: string }
  | undefined;

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const isOnline = useOnlineStatus();
  const [user, setUser] = useState<BodhiUserSummary | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [tracks, setTracks] = useState<FavoriteTrackItem[]>([]);
  const [sessions, setSessions] = useState<MeditationSessionItem[]>([]);
  const [presets, setPresets] = useState<TimerPresetItem[]>(() =>
    readLocalPresets()
  );

  const syncingRef = useRef(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    try {
      GoogleSignin.configure({
        webClientId:
          process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
          extra?.googleWebClientId ||
          undefined,
        iosClientId:
          process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
          extra?.googleIosClientId ||
          undefined,
      });
    } catch {
      // Safe when running outside native Google Sign-In module
    }
  }, []);

  const hydrateFromRemote = useCallback(async (uid: string) => {
    try {
      const data = await bodhiApi.bootstrap();
      setUser(data.user);
      setTracks(data.tracks);
      writeCachedTracks(uid, data.tracks);

      const pending = mobileOfflineQueue.readPendingSessions(uid);
      const merged = mergeSessionsWithPending(data.sessions, pending);
      setSessions(merged);
      mobileOfflineQueue.writeCachedHistory(uid, data.sessions);

      setPresets(data.presets);
      writeLocalPresets(data.presets);
    } catch {
      // Offline or transient failure: keep cached local state
    }
  }, []);

  // Initial load from Keychain/Keystore + local offline cache
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const stored = await loadStoredSession();
      if (cancelled) return;

      if (stored.user) {
        setUser(stored.user);
        const cachedTracks = readCachedTracks(stored.user.id);
        const cachedSessions = mobileOfflineQueue.readCachedHistory(
          stored.user.id
        );
        const pending = mobileOfflineQueue.readPendingSessions(stored.user.id);
        setTracks(cachedTracks);
        setSessions(mergeSessionsWithPending(cachedSessions, pending));
        setIsHydrated(true);

        if (isOnline) {
          void hydrateFromRemote(stored.user.id);
        }
      } else {
        setPresets(readLocalPresets());
        setIsHydrated(true);
      }
    };

    void init();

    const unsubscribe = subscribeSessionExpired(() => {
      setUser(null);
      setTracks([]);
      setSessions([]);
      setPresets(readLocalPresets());
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hydrateFromRemote, isOnline]);

  const pendingCount = useMemo(
    () =>
      sessions.filter(
        (item) => item.pendingSync || isPendingSessionId(item.id)
      ).length,
    [sessions]
  );

  // Flush locally queued offline sessions whenever connection returns
  useEffect(() => {
    if (!isOnline || !userId || pendingCount === 0 || syncingRef.current) {
      return;
    }

    const pendingList = mobileOfflineQueue.readPendingSessions(userId);
    if (pendingList.length === 0) return;

    let cancelled = false;
    syncingRef.current = true;

    const flush = async () => {
      setIsSyncing(true);
      try {
        const chronological = [...pendingList].reverse();
        for (const pendingItem of chronological) {
          if (cancelled) break;
          try {
            const { session: synced } = await bodhiApi.createSession(
              pendingSessionToPayload(pendingItem)
            );
            mobileOfflineQueue.removePendingSession(userId, pendingItem.id);
            if (!cancelled) {
              setSessions((prev) => {
                const next = mergeSessionsWithPending(
                  [
                    synced,
                    ...prev.filter(
                      (item) =>
                        item.id !== pendingItem.id &&
                        item.id !== synced.id &&
                        !item.pendingSync &&
                        !isPendingSessionId(item.id)
                    ),
                  ],
                  mobileOfflineQueue.readPendingSessions(userId)
                );
                mobileOfflineQueue.writeCachedHistory(userId, next);
                return next;
              });
            }
          } catch {
            break;
          }
        }
      } finally {
        syncingRef.current = false;
        if (!cancelled) setIsSyncing(false);
      }
    };

    void flush();
    return () => {
      cancelled = true;
    };
  }, [isOnline, pendingCount, userId]);

  const refreshAll = useCallback(async () => {
    if (!userId || !isOnline) return;
    await hydrateFromRemote(userId);
  }, [hydrateFromRemote, isOnline, userId]);

  const signInWithGoogle = useCallback(async () => {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    const idToken = response.data?.idToken;
    if (!idToken) {
      throw new Error("Google sign-in did not return an ID token");
    }

    const tokens = await bodhiApi.signInWithGoogleIdToken(
      idToken,
      `${Platform.OS} device`
    );
    await saveMobileSession(tokens);
    setUser(tokens.user);
    await hydrateFromRemote(tokens.user.id);
  }, [hydrateFromRemote]);

  const signInWithApple = useCallback(async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error("Apple sign-in did not return an identity token");
    }

    const fullName = [
      credential.fullName?.givenName,
      credential.fullName?.familyName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const tokens = await bodhiApi.signInWithAppleIdentityToken({
      identityToken: credential.identityToken,
      fullName: fullName || null,
      email: credential.email,
      deviceName: "iOS device",
    });

    await saveMobileSession(tokens);
    setUser(tokens.user);
    await hydrateFromRemote(tokens.user.id);
  }, [hydrateFromRemote]);

  const signOut = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken && isOnline) {
      await bodhiApi.logoutMobile(refreshToken).catch(() => {});
    }
    await clearMobileSession();
    try {
      await GoogleSignin.signOut();
    } catch {
      // Ignore if signed in via Apple
    }
    setUser(null);
    setTracks([]);
    setSessions([]);
    setPresets(readLocalPresets());
  }, [isOnline]);

  const deleteAccount = useCallback(async () => {
    await bodhiApi.deleteAccount();
    await clearMobileSession();
    setUser(null);
    setTracks([]);
    setSessions([]);
    setPresets(readLocalPresets());
  }, []);

  const saveSession = useCallback(
    async (
      payload: SaveSessionPayload
    ): Promise<MeditationSessionItem | null> => {
      const endedAt = payload.endedAt ?? new Date().toISOString();
      const startedAt =
        payload.startedAt ??
        new Date(
          new Date(endedAt).getTime() - payload.actualDurationSec * 1000
        ).toISOString();

      void recordMindfulSessionIfEnabled({
        startedAt,
        endedAt,
        actualDurationSec: payload.actualDurationSec,
      });

      if (!userId) return null;

      if (!isOnline) {
        const queued = mobileOfflineQueue.enqueuePendingSession(userId, {
          ...payload,
          startedAt,
          endedAt,
        });
        setSessions((prev) => [queued, ...prev]);
        return queued;
      }

      try {
        const { session } = await bodhiApi.createSession({
          ...payload,
          startedAt,
          endedAt,
        });
        setSessions((prev) => {
          const next = [session, ...prev.filter((item) => item.id !== session.id)];
          mobileOfflineQueue.writeCachedHistory(userId, next);
          return next;
        });
        return session;
      } catch {
        const queued = mobileOfflineQueue.enqueuePendingSession(userId, {
          ...payload,
          startedAt,
          endedAt,
        });
        setSessions((prev) => [queued, ...prev]);
        return queued;
      }
    },
    [isOnline, userId]
  );

  const updateSessionNote = useCallback(
    async (
      sessionId: string,
      note: string | null
    ): Promise<MeditationSessionItem | null> => {
      if (!userId) return null;

      if (isPendingSessionId(sessionId)) {
        const updated = mobileOfflineQueue.updatePendingSessionNote(
          userId,
          sessionId,
          note
        );
        if (updated) {
          setSessions((prev) =>
            prev.map((item) => (item.id === sessionId ? updated : item))
          );
        }
        return updated;
      }

      try {
        const { session } = await bodhiApi.updateSessionNote(sessionId, note);
        setSessions((prev) => {
          const next = prev.map((item) =>
            item.id === session.id ? session : item
          );
          mobileOfflineQueue.writeCachedHistory(userId, next);
          return next;
        });
        return session;
      } catch {
        return null;
      }
    },
    [userId]
  );

  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!userId) return false;

      if (isPendingSessionId(sessionId)) {
        mobileOfflineQueue.removePendingSession(userId, sessionId);
        setSessions((prev) => prev.filter((item) => item.id !== sessionId));
        return true;
      }

      try {
        await bodhiApi.deleteSession(sessionId);
        setSessions((prev) => {
          const next = prev.filter((item) => item.id !== sessionId);
          mobileOfflineQueue.writeCachedHistory(userId, next);
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const createPreset = useCallback(
    async (
      name: string,
      preferences: TimerPreferences
    ): Promise<TimerPresetItem | null> => {
      if (userId && isOnline) {
        try {
          const { preset } = await bodhiApi.createPreset(name, preferences);
          setPresets((prev) => {
            const next = [...prev, preset];
            writeLocalPresets(next);
            return next;
          });
          return preset;
        } catch {
          return null;
        }
      }

      const localPreset: TimerPresetItem = {
        id: `local-${Date.now()}`,
        name,
        preferences,
        createdAt: new Date().toISOString(),
      };
      setPresets((prev) => {
        const next = [...prev, localPreset];
        writeLocalPresets(next);
        return next;
      });
      return localPreset;
    },
    [isOnline, userId]
  );

  const deletePreset = useCallback(
    async (presetId: string): Promise<void> => {
      if (userId && isOnline && !presetId.startsWith("local-")) {
        await bodhiApi.deletePreset(presetId).catch(() => {});
      }
      setPresets((prev) => {
        const next = prev.filter((item) => item.id !== presetId);
        writeLocalPresets(next);
        return next;
      });
    },
    [isOnline, userId]
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      user,
      isHydrated,
      isOnline,
      isSyncing,
      pendingCount,
      tracks,
      sessions,
      presets,
      setTracks,
      refreshAll,
      signInWithGoogle,
      signInWithApple,
      signOut,
      deleteAccount,
      saveSession,
      updateSessionNote,
      deleteSession,
      createPreset,
      deletePreset,
    }),
    [
      user,
      isHydrated,
      isOnline,
      isSyncing,
      pendingCount,
      tracks,
      sessions,
      presets,
      refreshAll,
      signInWithGoogle,
      signInWithApple,
      signOut,
      deleteAccount,
      saveSession,
      updateSessionNote,
      deleteSession,
      createPreset,
      deletePreset,
    ]
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useBodhiData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error("useBodhiData must be used within AppDataProvider");
  }
  return ctx;
}
