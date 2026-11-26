"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Headphones,
  Link2,
  ListMusic,
  ListPlus,
  Loader2,
  LogIn,
  Music2,
  Pencil,
  Play,
  Plus,
  Star,
  Tag,
  Timer,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { signInWithGoogle } from "@/app/actions";
import { AddToPlaylistSheet } from "@/components/add-to-playlist-sheet";
import {
  GuidedSessionPlayer,
  type GuidedPlaylistPlaybackContext,
} from "@/components/guided-session-player";
import { useI18n } from "@/components/i18n-provider";
import { PlaylistDetailView } from "@/components/playlist-detail-view";
import {
  PlaylistImportPanel,
  type ImportedPlaylistPayloadResult,
} from "@/components/playlist-import-panel";
import type { SessionUserSummary } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  cacheGuidedPlaylists,
  cacheGuidedTrackList,
  formatBytesLabel,
  getGuidedAutoAdvanceServerSnapshot,
  getGuidedAutoAdvanceSnapshot,
  getOfflineGuidedServerSnapshot,
  getOfflineGuidedSnapshot,
  removeTrackAudioOffline,
  saveTrackAudioOffline,
  setGuidedAutoAdvancePreference,
  subscribeGuidedAutoAdvance,
  subscribeOfflineGuided,
} from "@/lib/offline/audio-cache";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  filterOfflinePlayablePlaylistTracks,
  getPlaylistCoverThumbnail,
  parsePlaylistUrl,
  removeTrackFromPlaylists,
  resolvePlaylistTracks,
} from "@/lib/tracks/playlists";
import {
  SUGGESTED_TRACK_TAGS,
  isAudioStreamProvider,
  normalizeTrackTags,
  parseTrackUrl,
} from "@/lib/tracks/providers";
import {
  applyFavoriteToggle,
  computeGroupedTargetIndex,
  getFavoriteGroupRange,
  hasOrderChanged,
  reorderItems,
  sortTracksWithFavoritesFirst,
} from "@/lib/tracks/reorder";
import type {
  FavoriteTrackItem,
  ResolvedTrackMetadata,
  TrackPlaylistItem,
} from "@/lib/tracks/types";
import { cn } from "@/lib/utils";

const LONG_PRESS_DELAY_MS = 250;
const TOUCH_CANCEL_THRESHOLD_PX = 8;
const MOUSE_DRAG_THRESHOLD_PX = 6;

type GuidedSubMode = "tracks" | "playlists";

type TrackFilter =
  | { type: "favorites" }
  | { type: "tag"; tag: string }
  | null;

interface ActivePlayback {
  track: FavoriteTrackItem;
  playlistName?: string;
  queue?: FavoriteTrackItem[];
  index?: number;
  autoStart?: boolean;
}

interface DragSession {
  pointerId: number;
  pointerType: string;
  trackId: string;
  startX: number;
  startY: number;
  anchorY: number;
  currentY: number;
  active: boolean;
  longPressTimer: number | null;
  initialTracks: FavoriteTrackItem[];
}

interface GuidedTracksProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  initialTracks: FavoriteTrackItem[];
  initialPlaylists?: TrackPlaylistItem[];
  isOnline?: boolean;
  onSwitchToTimer?: () => void;
  onSessionActiveChange: (active: boolean) => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
  onReorderingChange?: (reordering: boolean) => void;
}

export function GuidedTracks({
  user,
  authConfigured,
  initialTracks,
  initialPlaylists = [],
  isOnline = true,
  onSwitchToTimer,
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
  onReorderingChange,
}: GuidedTracksProps) {
  const { m } = useI18n();
  const userId = user?.id ?? null;
  const isAuthenticated = Boolean(user);
  const offlineGuided = useSyncExternalStore(
    subscribeOfflineGuided,
    getOfflineGuidedSnapshot,
    getOfflineGuidedServerSnapshot
  );
  const guidedAutoAdvance = useSyncExternalStore(
    subscribeGuidedAutoAdvance,
    getGuidedAutoAdvanceSnapshot,
    getGuidedAutoAdvanceServerSnapshot
  );

  const [subMode, setSubMode] = useState<GuidedSubMode>("tracks");
  const [tracks, setTracks] = useState<FavoriteTrackItem[]>(() =>
    sortTracksWithFavoritesFirst(initialTracks)
  );
  const [playlists, setPlaylists] =
    useState<TrackPlaylistItem[]>(initialPlaylists);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [activePlayback, setActivePlayback] = useState<ActivePlayback | null>(
    null
  );
  const [closingBellEnabled, setClosingBellEnabled] = useState<boolean>(true);
  const [selectedFilter, setSelectedFilter] = useState<TrackFilter>(null);
  const [playlistSheetTrack, setPlaylistSheetTrack] =
    useState<FavoriteTrackItem | null>(null);

  // Playlist creation & import state
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>("");
  const [newPlaylistDescription, setNewPlaylistDescription] =
    useState<string>("");
  const [isSavingPlaylist, setIsSavingPlaylist] = useState<boolean>(false);
  const [isImportingPlaylist, setIsImportingPlaylist] =
    useState<boolean>(false);
  const [importInitialUrl, setImportInitialUrl] = useState<string>("");
  const [importBanner, setImportBanner] = useState<string | null>(null);

  // Add track form state
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>("");
  const [titleInput, setTitleInput] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState<string>("");
  const [resolvedMeta, setResolvedMeta] =
    useState<ResolvedTrackMetadata | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingFavoriteIds, setTogglingFavoriteIds] = useState<string[]>([]);
  const [downloadingTrackId, setDownloadingTrackId] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inline track edit state
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState<string>("");
  const [editTagsDraft, setEditTagsDraft] = useState<string[]>([]);
  const [editCustomTagDraft, setEditCustomTagDraft] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Drag-to-reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);

  const tracksRef = useRef<FavoriteTrackItem[]>(tracks);
  const togglingFavoriteRef = useRef<Set<string>>(new Set());
  const itemElementsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragOffsetYRef = useRef<number>(0);
  const suppressClickRef = useRef<boolean>(false);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Cache track & playlist metadata locally when signed in & online so saved audio stays browsable offline
  useEffect(() => {
    if (!isOnline || !isAuthenticated) return;
    cacheGuidedTrackList(tracks);
  }, [isAuthenticated, isOnline, tracks]);

  useEffect(() => {
    if (!isOnline || !isAuthenticated) return;
    cacheGuidedPlaylists(playlists);
  }, [isAuthenticated, isOnline, playlists]);

  useEffect(() => {
    onSessionActiveChange(activePlayback !== null);
  }, [activePlayback, onSessionActiveChange]);

  useEffect(() => {
    onReorderingChange?.(draggingId !== null);
  }, [draggingId, onReorderingChange]);

  const effectiveSourceTracks = useMemo(
    () => (tracks.length > 0 ? tracks : offlineGuided.tracks),
    [offlineGuided.tracks, tracks]
  );

  const effectiveSourcePlaylists = useMemo(
    () => (playlists.length > 0 ? playlists : offlineGuided.playlists),
    [offlineGuided.playlists, playlists]
  );

  const offlinePlayableTracks = useMemo(() => {
    return sortTracksWithFavoritesFirst(
      effectiveSourceTracks.filter(
        (track) =>
          isAudioStreamProvider(track.provider) &&
          Boolean(offlineGuided.savedAudio[track.id])
      )
    );
  }, [effectiveSourceTracks, offlineGuided.savedAudio]);

  const offlinePlayablePlaylists = useMemo(() => {
    return effectiveSourcePlaylists.filter(
      (playlist) =>
        filterOfflinePlayablePlaylistTracks(
          playlist,
          effectiveSourceTracks,
          offlineGuided.savedAudio
        ).length > 0
    );
  }, [
    effectiveSourcePlaylists,
    effectiveSourceTracks,
    offlineGuided.savedAudio,
  ]);

  const detectedProvider = parseTrackUrl(urlInput)?.provider ?? null;
  const detectedPlaylistUrl = parsePlaylistUrl(urlInput);

  const favoriteCount = useMemo(
    () => tracks.filter((track) => track.isFavorite).length,
    [tracks]
  );
  const otherCount = tracks.length - favoriteCount;
  const hasFavorites = favoriteCount > 0;

  const effectiveFilter = useMemo<TrackFilter>(
    () =>
      selectedFilter?.type === "favorites" && !hasFavorites
        ? null
        : selectedFilter,
    [hasFavorites, selectedFilter]
  );

  const availableTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const track of tracks) {
      for (const tag of track.tags ?? []) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, tag);
        }
      }
    }
    return Array.from(seen.values());
  }, [tracks]);

  const displayedTracks = useMemo(() => {
    if (!effectiveFilter) return tracks;
    if (effectiveFilter.type === "favorites") {
      return tracks.filter((track) => track.isFavorite);
    }
    const target = effectiveFilter.tag.toLowerCase();
    return tracks.filter((track) =>
      (track.tags ?? []).some((tag) => tag.toLowerCase() === target)
    );
  }, [effectiveFilter, tracks]);

  const displayedFavorites = useMemo(
    () => displayedTracks.filter((track) => track.isFavorite),
    [displayedTracks]
  );

  const displayedOthers = useMemo(
    () => displayedTracks.filter((track) => !track.isFavorite),
    [displayedTracks]
  );

  const showSectionDivider =
    effectiveFilter?.type !== "favorites" &&
    displayedFavorites.length > 0 &&
    displayedOthers.length > 0;

  const canDragAnyGroup =
    effectiveFilter === null &&
    editingTrackId === null &&
    (favoriteCount >= 2 || otherCount >= 2);

  const resetForm = useCallback(() => {
    setUrlInput("");
    setTitleInput("");
    setTagsInput([]);
    setCustomTagInput("");
    setResolvedMeta(null);
    setErrorMessage(null);
    setIsAdding(false);
  }, []);

  const handleResolveMetadata = useCallback(async (rawUrl: string) => {
    const parsed = parseTrackUrl(rawUrl);
    if (!parsed) {
      setResolvedMeta(null);
      return;
    }

    setIsResolving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/tracks/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
      });

      const data = (await response.json()) as {
        metadata?: ResolvedTrackMetadata;
        error?: string;
      };

      if (!response.ok || !data.metadata) {
        setErrorMessage(data.error ?? m.guided.errFetchMetadata);
        return;
      }

      setResolvedMeta(data.metadata);
      setTitleInput((prev) => (prev.trim() ? prev : data.metadata!.title));
    } catch {
      setErrorMessage(m.guided.errFetchMetadata);
    } finally {
      setIsResolving(false);
    }
  }, [m.guided.errFetchMetadata]);

  const handleUrlChange = useCallback(
    (nextValue: string) => {
      setUrlInput(nextValue);
      setErrorMessage(null);
      if (!nextValue.trim()) {
        setResolvedMeta(null);
        setTitleInput("");
        return;
      }
      // Auto-resolve when a valid YouTube or SoundCloud link is pasted
      if (parseTrackUrl(nextValue)) {
        void handleResolveMetadata(nextValue);
      } else {
        setResolvedMeta(null);
      }
    },
    [handleResolveMetadata]
  );

  const handleSaveTrack = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setErrorMessage(null);

      if (!parseTrackUrl(urlInput)) {
        setErrorMessage(m.guided.errInvalidUrl);
        return;
      }

      const finalTags = normalizeTrackTags(
        customTagInput.trim() ? [...tagsInput, customTagInput] : tagsInput
      );

      setIsSaving(true);
      try {
        const response = await fetch("/api/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: urlInput,
            title: titleInput.trim() || undefined,
            author: resolvedMeta?.author,
            thumbnailUrl: resolvedMeta?.thumbnailUrl,
            tags: finalTags,
          }),
        });

        const data = (await response.json()) as {
          track?: FavoriteTrackItem;
          error?: string;
        };

        if (!response.ok || !data.track) {
          setErrorMessage(data.error ?? m.guided.errSaveTrack);
          return;
        }

        const savedTrack = data.track;
        setTracks((prev) => {
          const exists = prev.some((item) => item.id === savedTrack.id);
          if (exists) {
            return sortTracksWithFavoritesFirst(
              prev.map((item) => (item.id === savedTrack.id ? savedTrack : item))
            );
          }
          return sortTracksWithFavoritesFirst([...prev, savedTrack]);
        });
        resetForm();
      } catch {
        setErrorMessage(m.guided.errSaveTrack);
      } finally {
        setIsSaving(false);
      }
    },
    [
      customTagInput,
      m.guided.errInvalidUrl,
      m.guided.errSaveTrack,
      resetForm,
      resolvedMeta,
      tagsInput,
      titleInput,
      urlInput,
    ]
  );

  const startEditingTrack = useCallback((track: FavoriteTrackItem) => {
    setEditingTrackId(track.id);
    setEditTitleDraft(track.title);
    setEditTagsDraft(track.tags ?? []);
    setEditCustomTagDraft("");
    setErrorMessage(null);
  }, []);

  const cancelEditingTrack = useCallback(() => {
    setEditingTrackId(null);
    setEditTitleDraft("");
    setEditTagsDraft([]);
    setEditCustomTagDraft("");
  }, []);

  const handleSaveTrackEdit = useCallback(
    async (id: string) => {
      const trimmedTitle = editTitleDraft.trim();
      if (!trimmedTitle) {
        setErrorMessage(m.guided.errEmptyTitle);
        return;
      }

      const nextTags = normalizeTrackTags(
        editCustomTagDraft.trim()
          ? [...editTagsDraft, editCustomTagDraft]
          : editTagsDraft
      );

      setIsSavingEdit(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/tracks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmedTitle,
            tags: nextTags,
          }),
        });

        const data = (await response.json()) as {
          track?: FavoriteTrackItem;
          error?: string;
        };

        if (!response.ok || !data.track) {
          setErrorMessage(data.error ?? m.guided.errUpdateTrack);
          return;
        }

        const updatedTrack = data.track;
        setTracks((prev) =>
          prev.map((item) => (item.id === updatedTrack.id ? updatedTrack : item))
        );
        cancelEditingTrack();
      } catch {
        setErrorMessage(m.guided.errUpdateTrack);
      } finally {
        setIsSavingEdit(false);
      }
    },
    [
      cancelEditingTrack,
      editCustomTagDraft,
      editTagsDraft,
      editTitleDraft,
      m.guided.errEmptyTitle,
      m.guided.errUpdateTrack,
    ]
  );

  const handleToggleFavorite = useCallback(
    async (track: FavoriteTrackItem) => {
      if (togglingFavoriteRef.current.has(track.id)) return;

      const previousTracks = tracksRef.current;
      const nextIsFavorite = !track.isFavorite;
      const optimisticTracks = applyFavoriteToggle(
        previousTracks,
        track.id,
        nextIsFavorite
      );

      togglingFavoriteRef.current.add(track.id);
      setTogglingFavoriteIds((prev) =>
        prev.includes(track.id) ? prev : [...prev, track.id]
      );
      setErrorMessage(null);
      tracksRef.current = optimisticTracks;
      setTracks(optimisticTracks);
      setActivePlayback((prev) =>
        prev && prev.track.id === track.id
          ? { ...prev, track: { ...prev.track, isFavorite: nextIsFavorite } }
          : prev
      );

      try {
        const response = await fetch(`/api/tracks/${track.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFavorite: nextIsFavorite }),
        });

        const data = (await response.json()) as {
          track?: FavoriteTrackItem;
          error?: string;
        };

        if (!response.ok || !data.track) {
          tracksRef.current = previousTracks;
          setTracks(previousTracks);
          setActivePlayback((prev) =>
            prev && prev.track.id === track.id ? { ...prev, track } : prev
          );
          setErrorMessage(data.error ?? m.guided.errFavoriteTrack);
          return;
        }

        const updatedTrack = data.track;
        setTracks((prev) =>
          prev.map((item) => (item.id === updatedTrack.id ? updatedTrack : item))
        );
        setActivePlayback((prev) =>
          prev && prev.track.id === updatedTrack.id
            ? { ...prev, track: updatedTrack }
            : prev
        );
      } catch {
        tracksRef.current = previousTracks;
        setTracks(previousTracks);
        setActivePlayback((prev) =>
          prev && prev.track.id === track.id ? { ...prev, track } : prev
        );
        setErrorMessage(m.guided.errFavoriteTrack);
      } finally {
        togglingFavoriteRef.current.delete(track.id);
        setTogglingFavoriteIds((prev) => prev.filter((id) => id !== track.id));
      }
    },
    [m.guided.errFavoriteTrack]
  );

  const handleDeleteTrack = useCallback(
    async (id: string) => {
      setDeletingId(id);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/tracks/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setErrorMessage(data.error ?? m.guided.errDeleteTrack);
          return;
        }

        setTracks((prev) => prev.filter((item) => item.id !== id));
        setPlaylists((prev) => removeTrackFromPlaylists(prev, id));
        void removeTrackAudioOffline(id);
      } catch {
        setErrorMessage(m.guided.errDeleteTrack);
      } finally {
        setDeletingId(null);
      }
    },
    [m.guided.errDeleteTrack]
  );

  const handleCreatePlaylist = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = newPlaylistName.trim();
      if (!trimmedName) {
        setErrorMessage(m.guided.playlists.errEmptyName);
        return;
      }

      setIsSavingPlaylist(true);
      setErrorMessage(null);
      try {
        const response = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: newPlaylistDescription.trim() || null,
          }),
        });

        const data = (await response.json()) as {
          playlist?: TrackPlaylistItem;
          error?: string;
        };

        if (!response.ok || !data.playlist) {
          setErrorMessage(data.error ?? m.guided.playlists.errCreatePlaylist);
          return;
        }

        const created = data.playlist;
        setPlaylists((prev) => [...prev, created]);
        setNewPlaylistName("");
        setNewPlaylistDescription("");
        setIsCreatingPlaylist(false);
        setOpenPlaylistId(created.id);
      } catch {
        setErrorMessage(m.guided.playlists.errCreatePlaylist);
      } finally {
        setIsSavingPlaylist(false);
      }
    },
    [
      m.guided.playlists.errCreatePlaylist,
      m.guided.playlists.errEmptyName,
      newPlaylistDescription,
      newPlaylistName,
    ]
  );

  const handlePlaylistUpdated = useCallback((updated: TrackPlaylistItem) => {
    setPlaylists((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  }, []);

  const handlePlaylistCreated = useCallback((created: TrackPlaylistItem) => {
    setPlaylists((prev) =>
      prev.some((item) => item.id === created.id) ? prev : [...prev, created]
    );
  }, []);

  const handlePlaylistDeleted = useCallback((playlistId: string) => {
    setPlaylists((prev) => prev.filter((item) => item.id !== playlistId));
    setOpenPlaylistId((prev) => (prev === playlistId ? null : prev));
  }, []);

  const handleImportResult = useCallback(
    (result: ImportedPlaylistPayloadResult) => {
      setTracks((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        for (const importedTrack of result.tracks) {
          if (!byId.has(importedTrack.id)) {
            byId.set(importedTrack.id, importedTrack);
          }
        }
        return sortTracksWithFavoritesFirst(Array.from(byId.values()));
      });

      setPlaylists((prev) => {
        const exists = prev.some((item) => item.id === result.playlist.id);
        if (exists) {
          return prev.map((item) =>
            item.id === result.playlist.id ? result.playlist : item
          );
        }
        return [...prev, result.playlist];
      });

      setIsImportingPlaylist(false);
      setImportInitialUrl("");
      setSubMode("playlists");
      setOpenPlaylistId(result.playlist.id);
      setImportBanner(
        m.guided.playlists.importSuccess(
          result.addedCount,
          result.skippedDuplicateCount,
          result.skippedCapCount
        )
      );
    },
    [m.guided.playlists]
  );

  const handleOpenImportWithUrl = useCallback(
    (rawUrl: string) => {
      resetForm();
      setSubMode("playlists");
      setOpenPlaylistId(null);
      setIsCreatingPlaylist(false);
      setImportInitialUrl(rawUrl);
      setIsImportingPlaylist(true);
      setImportBanner(null);
    },
    [resetForm]
  );

  const handleToggleOfflineTrack = useCallback(
    async (track: FavoriteTrackItem) => {
      if (!isAudioStreamProvider(track.provider)) return;
      setErrorMessage(null);

      if (offlineGuided.savedAudio[track.id]) {
        await removeTrackAudioOffline(track.id);
        return;
      }

      setDownloadingTrackId(track.id);
      try {
        await saveTrackAudioOffline(track, isAuthenticated);
      } catch {
        setErrorMessage(m.guided.errOfflineDownload);
      } finally {
        setDownloadingTrackId((prev) => (prev === track.id ? null : prev));
      }
    },
    [isAuthenticated, m.guided.errOfflineDownload, offlineGuided.savedAudio]
  );

  const persistTrackOrder = useCallback(
    async (
      nextTracks: FavoriteTrackItem[],
      previousTracks: FavoriteTrackItem[]
    ) => {
      try {
        const response = await fetch("/api/tracks/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderedIds: nextTracks.map((item) => item.id),
          }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setTracks(previousTracks);
          setErrorMessage(data.error ?? m.guided.errReorderTracks);
        }
      } catch {
        setTracks(previousTracks);
        setErrorMessage(m.guided.errReorderTracks);
      }
    },
    [m.guided.errReorderTracks]
  );

  const activateDrag = useCallback((session: DragSession) => {
    if (session.active) return;
    session.active = true;
    session.anchorY = session.currentY;
    dragOffsetYRef.current = 0;
    setDraggingId(session.trackId);
    setDragOffsetY(0);
    setErrorMessage(null);

    if (
      session.pointerType === "touch" &&
      typeof navigator !== "undefined" &&
      "vibrate" in navigator
    ) {
      navigator.vibrate(15);
    }
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      const session = dragSessionRef.current;
      if (!session) return;

      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
      }

      const wasActive = session.active;
      const initialTracksSnapshot = session.initialTracks;
      dragSessionRef.current = null;
      dragOffsetYRef.current = 0;
      setDraggingId(null);
      setDragOffsetY(0);

      if (!wasActive) return;

      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (!commit) {
        setTracks(initialTracksSnapshot);
        return;
      }

      const currentTracks = tracksRef.current;
      const previousIds = initialTracksSnapshot.map((item) => item.id);
      const nextIds = currentTracks.map((item) => item.id);
      if (hasOrderChanged(previousIds, nextIds)) {
        void persistTrackOrder(currentTracks, initialTracksSnapshot);
      }
    },
    [persistTrackOrder]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      session.currentY = event.clientY;
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      const movedDistance = Math.hypot(deltaX, deltaY);

      if (!session.active) {
        if (session.pointerType === "touch") {
          if (movedDistance > TOUCH_CANCEL_THRESHOLD_PX) {
            endDrag(false);
          }
          return;
        }

        // Mouse/pen: start dragging once pointer moves past a small threshold
        if (movedDistance >= MOUSE_DRAG_THRESHOLD_PX) {
          activateDrag(session);
        } else {
          return;
        }
      }

      const currentList = tracksRef.current;
      const currentIndex = currentList.findIndex(
        (item) => item.id === session.trackId
      );
      if (currentIndex === -1) {
        endDrag(false);
        return;
      }

      // Measure resting slot rects (compensating for the dragged card's current translateY)
      const currentOffset = dragOffsetYRef.current;
      const itemRects = currentList.map((item) => {
        const el = itemElementsRef.current.get(item.id);
        if (!el) return { top: 0, height: 0 };
        const rect = el.getBoundingClientRect();
        const isDragged = item.id === session.trackId;
        return {
          top: isDragged ? rect.top - currentOffset : rect.top,
          height: rect.height,
        };
      });

      const targetIndex = computeGroupedTargetIndex(
        event.clientY,
        itemRects,
        currentList,
        currentIndex
      );

      if (targetIndex !== currentIndex) {
        const slotDelta =
          itemRects[targetIndex].top - itemRects[currentIndex].top;
        session.anchorY += slotDelta;

        const reordered = reorderItems(currentList, currentIndex, targetIndex);
        tracksRef.current = reordered;
        setTracks(reordered);

        if (
          session.pointerType === "touch" &&
          typeof navigator !== "undefined" &&
          "vibrate" in navigator
        ) {
          navigator.vibrate(5);
        }
      }

      const nextOffset = event.clientY - session.anchorY;
      dragOffsetYRef.current = nextOffset;
      setDragOffsetY(nextOffset);

      // Gentle edge auto-scroll when dragging near top or bottom of viewport
      const edgeThreshold = 72;
      if (event.clientY < edgeThreshold) {
        window.scrollBy(0, -8);
      } else if (event.clientY > window.innerHeight - edgeThreshold) {
        window.scrollBy(0, 8);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      endDrag(true);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      endDrag(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activateDrag, endDrag]);

  // Lock touch scrolling and text selection only while a drag is actively in progress
  useEffect(() => {
    if (draggingId === null) return;

    const preventTouchScroll = (event: TouchEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const preventSelect = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("touchmove", preventTouchScroll, {
      passive: false,
    });
    window.addEventListener("selectstart", preventSelect);

    return () => {
      window.removeEventListener("touchmove", preventTouchScroll);
      window.removeEventListener("selectstart", preventSelect);
    };
  }, [draggingId]);

  useEffect(() => {
    return () => {
      const session = dragSessionRef.current;
      if (session?.longPressTimer !== null && session?.longPressTimer !== undefined) {
        window.clearTimeout(session.longPressTimer);
      }
      dragSessionRef.current = null;
      onReorderingChange?.(false);
    };
  }, [onReorderingChange]);

  const handleTrackPointerDown = useCallback(
    (trackId: string, event: React.PointerEvent<HTMLLIElement>) => {
      const currentList = tracksRef.current;
      const trackIndex = currentList.findIndex((item) => item.id === trackId);
      if (trackIndex === -1) return;
      const { start, end } = getFavoriteGroupRange(currentList, trackIndex);
      if (end - start + 1 < 2) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-no-drag='true']")
      ) {
        return;
      }

      if (dragSessionRef.current?.longPressTimer != null) {
        window.clearTimeout(dragSessionRef.current.longPressTimer);
      }

      const session: DragSession = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        trackId,
        startX: event.clientX,
        startY: event.clientY,
        anchorY: event.clientY,
        currentY: event.clientY,
        active: false,
        longPressTimer: null,
        initialTracks: [...tracksRef.current],
      };

      if (event.pointerType === "touch") {
        session.longPressTimer = window.setTimeout(() => {
          if (dragSessionRef.current === session) {
            activateDrag(session);
          }
        }, LONG_PRESS_DELAY_MS);
      }

      dragSessionRef.current = session;
    },
    [activateDrag]
  );

  const setTrackItemRef = useCallback(
    (trackId: string, node: HTMLLIElement | null) => {
      if (node) {
        itemElementsRef.current.set(trackId, node);
      } else {
        itemElementsRef.current.delete(trackId);
      }
    },
    []
  );

  if (activePlayback) {
    const queue = activePlayback.queue;
    const queueIndex = activePlayback.index ?? 0;
    const playlistContext: GuidedPlaylistPlaybackContext | null =
      queue && activePlayback.playlistName
        ? {
            playlistName: activePlayback.playlistName,
            currentIndex: queueIndex,
            totalTracks: queue.length,
            nextTrackTitle:
              queueIndex + 1 < queue.length
                ? queue[queueIndex + 1].title
                : null,
            hasPrevious: queueIndex > 0,
            hasNext: queueIndex + 1 < queue.length,
            autoAdvance: guidedAutoAdvance,
            onToggleAutoAdvance: () =>
              setGuidedAutoAdvancePreference(!guidedAutoAdvance),
            onPreviousTrack: () => {
              if (queueIndex <= 0) return;
              const prevIdx = queueIndex - 1;
              setActivePlayback({
                ...activePlayback,
                track: queue[prevIdx],
                index: prevIdx,
                autoStart: true,
              });
            },
            onNextTrack: (autoStart) => {
              if (queueIndex + 1 >= queue.length) return;
              const nextIdx = queueIndex + 1;
              setActivePlayback({
                ...activePlayback,
                track: queue[nextIdx],
                index: nextIdx,
                autoStart,
              });
            },
          }
        : null;

    return (
      <GuidedSessionPlayer
        key={`${activePlayback.track.id}-${activePlayback.index ?? "single"}`}
        track={activePlayback.track}
        closingBellEnabled={closingBellEnabled}
        isAuthenticated={isAuthenticated}
        userId={userId}
        isOnline={isOnline}
        isTogglingFavorite={togglingFavoriteIds.includes(
          activePlayback.track.id
        )}
        autoStart={Boolean(activePlayback.autoStart)}
        playlistContext={playlistContext}
        onToggleFavorite={(track) => void handleToggleFavorite(track)}
        onToggleClosingBell={() => setClosingBellEnabled((prev) => !prev)}
        onExit={() => setActivePlayback(null)}
        onSessionSaved={onSessionSaved}
        onSessionUpdated={onSessionUpdated}
      />
    );
  }

  const renderSubModeSelector = () => (
    <div className="flex justify-center">
      <div
        role="tablist"
        aria-label={m.guided.subModeAria}
        className="inline-flex items-center gap-0.5 rounded-full border border-black/6 bg-[var(--surface-muted)]/85 p-0.5 dark:border-white/10"
      >
        {(
          [
            { id: "tracks", label: m.guided.subModeTracks },
            { id: "playlists", label: m.guided.subModePlaylists },
          ] as const
        ).map((option) => {
          const isSelected = subMode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => {
                setSubMode(option.id);
                setOpenPlaylistId(null);
                setErrorMessage(null);
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                isSelected
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-2xs"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (!isOnline) {
    if (openPlaylistId) {
      const offlineTarget = offlinePlayablePlaylists.find(
        (item) => item.id === openPlaylistId
      );
      if (offlineTarget) {
        return (
          <PlaylistDetailView
            playlist={offlineTarget}
            allTracks={effectiveSourceTracks}
            playlists={offlinePlayablePlaylists}
            savedAudio={offlineGuided.savedAudio}
            isOnline={false}
            isAuthenticated={isAuthenticated}
            onBack={() => setOpenPlaylistId(null)}
            onPlayQueue={(queue, startIndex) => {
              if (queue.length === 0) return;
              setActivePlayback({
                track: queue[startIndex] ?? queue[0],
                playlistName: offlineTarget.name,
                queue,
                index: startIndex,
                autoStart: false,
              });
            }}
            onPlaylistUpdated={handlePlaylistUpdated}
            onPlaylistDeleted={handlePlaylistDeleted}
            onImportResult={handleImportResult}
            onReorderingChange={onReorderingChange}
          />
        );
      }
    }

    if (offlinePlayableTracks.length > 0) {
      return (
        <section className="flex flex-1 flex-col gap-3.5 py-1">
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-black/6 bg-[var(--surface)] px-3.5 py-2.5 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--foreground-muted)]">
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-[var(--warm-amber)]" />
              <span className="truncate">{m.guided.offlineShowingSaved}</span>
            </div>
            {onSwitchToTimer && (
              <button
                type="button"
                onClick={onSwitchToTimer}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)]"
              >
                <Timer className="h-3 w-3" />
                {m.nav.timer}
              </button>
            )}
          </div>

          {offlinePlayablePlaylists.length > 0 && renderSubModeSelector()}

          {subMode === "playlists" && offlinePlayablePlaylists.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {offlinePlayablePlaylists.map((playlist) => {
                const offlineTracks = filterOfflinePlayablePlaylistTracks(
                  playlist,
                  effectiveSourceTracks,
                  offlineGuided.savedAudio
                );
                const cover = getPlaylistCoverThumbnail(
                  playlist,
                  effectiveSourceTracks
                );
                return (
                  <li
                    key={playlist.id}
                    className="flex items-center gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-3 shadow-xs transition-colors hover:border-[var(--accent)]/35 dark:border-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenPlaylistId(playlist.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cover}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ListMusic className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {playlist.name}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                          {m.guided.playlists.offlineTrackCount(
                            offlineTracks.length,
                            playlist.trackIds.length
                          )}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePlayback({
                          track: offlineTracks[0],
                          playlistName: playlist.name,
                          queue: offlineTracks,
                          index: 0,
                          autoStart: false,
                        })
                      }
                      aria-label={`${m.guided.playlists.playPlaylist} ${playlist.name}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[#fcfaf6] dark:hover:text-[#151917]"
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {offlinePlayableTracks.map((track) => {
                const meta = offlineGuided.savedAudio[track.id];
                return (
                  <li
                    key={track.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-2xl border p-3 shadow-xs transition-colors",
                      track.isFavorite
                        ? "border-[var(--warm-amber)]/40 bg-[color-mix(in_srgb,var(--surface)_94%,var(--warm-amber)_6%)] hover:border-[var(--warm-amber)]/55 dark:border-[var(--warm-amber)]/35 dark:bg-[color-mix(in_srgb,var(--surface)_92%,var(--warm-amber)_8%)]"
                        : "border-black/6 bg-[var(--surface)] hover:border-[var(--accent)]/35 dark:border-white/10"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActivePlayback({ track })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Music2 className="h-5 w-5" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                          <Play className="h-4 w-4 fill-current" />
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {track.title}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                          {meta && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              {m.guided.savedOfflineBadge(
                                formatBytesLabel(meta.bytes)
                              )}
                            </span>
                          )}
                          {track.author && (
                            <span className="truncate">{track.author}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {track.isFavorite && (
                      <span
                        aria-label={m.guided.favoritesSection}
                        className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--warm-amber)]"
                      >
                        <Star className="h-3.5 w-3.5 fill-current" />
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => void removeTrackAudioOffline(track.id)}
                      aria-label={m.guided.removeOfflineAria(track.title)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      );
    }

    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--warm-amber)]">
            <WifiOff className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            {m.guided.offlineTitle}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            {m.guided.offlineBody}
          </p>

          {onSwitchToTimer && (
            <button
              type="button"
              onClick={onSwitchToTimer}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
            >
              <Timer className="h-4 w-4" />
              {m.guided.openTimer}
            </button>
          )}
        </div>
      </section>
    );
  }

  // Signed-out state
  if (!user) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Headphones className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            {m.guided.signedOutTitle}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            {m.guided.signedOutBody}
          </p>

          {authConfigured ? (
            <form action={signInWithGoogle} className="mt-5">
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                <LogIn className="h-4 w-4" />
                {m.common.continueWithGoogle}
              </button>
            </form>
          ) : (
            <p className="mt-4 rounded-xl bg-[var(--surface-muted)] px-3.5 py-2.5 text-xs text-[var(--foreground-muted)]">
              {m.guided.authNotConfigured}
            </p>
          )}
        </div>
      </section>
    );
  }

  // Open Playlist Detail View
  if (subMode === "playlists" && openPlaylistId) {
    const activePlaylist = playlists.find((item) => item.id === openPlaylistId);
    if (activePlaylist) {
      return (
        <div className="flex flex-1 flex-col gap-2">
          {importBanner && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3.5 py-2 text-xs text-[var(--accent)]">
              <span>{importBanner}</span>
              <button
                type="button"
                onClick={() => setImportBanner(null)}
                aria-label={m.common.dismissMessage}
                className="shrink-0 opacity-75 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <PlaylistDetailView
            playlist={activePlaylist}
            allTracks={tracks}
            playlists={playlists}
            savedAudio={offlineGuided.savedAudio}
            isOnline={isOnline}
            isAuthenticated={isAuthenticated}
            onBack={() => {
              setOpenPlaylistId(null);
              setImportBanner(null);
            }}
            onPlayQueue={(queue, startIndex) => {
              if (queue.length === 0) return;
              setActivePlayback({
                track: queue[startIndex] ?? queue[0],
                playlistName: activePlaylist.name,
                queue,
                index: startIndex,
                autoStart: false,
              });
            }}
            onPlaylistUpdated={handlePlaylistUpdated}
            onPlaylistDeleted={handlePlaylistDeleted}
            onImportResult={handleImportResult}
            onReorderingChange={onReorderingChange}
          />
        </div>
      );
    }
  }

  if (subMode === "playlists") {
    return (
      <section className="flex flex-1 flex-col gap-3.5 py-1">
        {renderSubModeSelector()}

        {/* Playlists Top Action Row */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setClosingBellEnabled((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
          >
            {closingBellEnabled ? (
              <Bell className="h-3.5 w-3.5 text-[var(--accent)]" />
            ) : (
              <BellOff className="h-3.5 w-3.5" />
            )}
            {m.guided.closingBell}:{" "}
            {closingBellEnabled ? m.common.on : m.common.off}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setImportInitialUrl("");
                setIsImportingPlaylist((prev) => !prev);
                setIsCreatingPlaylist(false);
                setErrorMessage(null);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-black/8 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
            >
              <Download className="h-3.5 w-3.5" />
              {m.guided.playlists.importPlaylist}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreatingPlaylist((prev) => !prev);
                setIsImportingPlaylist(false);
                setErrorMessage(null);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
            >
              {isCreatingPlaylist ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  {m.common.cancel}
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  {m.guided.playlists.newPlaylist}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Create New Playlist Form */}
        {isCreatingPlaylist && (
          <form
            onSubmit={handleCreatePlaylist}
            className="flex flex-col gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10"
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="playlist-name-input"
                className="text-xs font-medium text-[var(--foreground)]"
              >
                {m.guided.playlists.nameLabel}
              </label>
              <input
                id="playlist-name-input"
                type="text"
                required
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                placeholder={m.guided.playlists.namePlaceholder}
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="playlist-desc-input"
                className="text-xs font-medium text-[var(--foreground)]"
              >
                {m.guided.playlists.descriptionLabel}
              </label>
              <input
                id="playlist-desc-input"
                type="text"
                maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                placeholder={m.guided.playlists.descriptionPlaceholder}
                value={newPlaylistDescription}
                onChange={(event) =>
                  setNewPlaylistDescription(event.target.value)
                }
                className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingPlaylist || !newPlaylistName.trim()}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
            >
              {isSavingPlaylist ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {m.guided.playlists.creating}
                </>
              ) : (
                m.guided.playlists.createPlaylist
              )}
            </button>
          </form>
        )}

        {/* External Playlist Import Panel */}
        {isImportingPlaylist && (
          <PlaylistImportPanel
            key={importInitialUrl || "manual-import"}
            initialUrl={importInitialUrl}
            playlists={playlists}
            onCancel={() => {
              setIsImportingPlaylist(false);
              setImportInitialUrl("");
            }}
            onImported={handleImportResult}
          />
        )}

        {errorMessage && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}

        {/* Playlists List */}
        {playlists.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-12 text-center dark:border-white/12">
            <ListMusic className="h-7 w-7 text-[var(--foreground-muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {m.guided.playlists.noPlaylistsTitle}
            </p>
            <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
              {m.guided.playlists.noPlaylistsBody}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {playlists.map((playlist) => {
              const resolvedTracks = resolvePlaylistTracks(playlist, tracks);
              const offlineCount = filterOfflinePlayablePlaylistTracks(
                playlist,
                tracks,
                offlineGuided.savedAudio
              ).length;
              const cover = getPlaylistCoverThumbnail(playlist, tracks);

              return (
                <li
                  key={playlist.id}
                  className="flex items-center gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-3 shadow-xs transition-colors hover:border-[var(--accent)]/35 dark:border-white/10"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setImportBanner(null);
                      setOpenPlaylistId(playlist.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ListMusic className="h-5 w-5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {playlist.name}
                      </p>
                      {playlist.description && (
                        <p className="mt-0.5 truncate text-xs text-[var(--foreground-muted)]">
                          {playlist.description}
                        </p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--foreground-muted)]">
                        <span>
                          {m.guided.playlists.trackCount(resolvedTracks.length)}
                        </span>
                        {offlineCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            {m.guided.playlists.offlineTrackCount(
                              offlineCount,
                              resolvedTracks.length
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {resolvedTracks.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setActivePlayback({
                          track: resolvedTracks[0],
                          playlistName: playlist.name,
                          queue: resolvedTracks,
                          index: 0,
                          autoStart: false,
                        })
                      }
                      aria-label={`${m.guided.playlists.playPlaylist} ${playlist.name}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[#fcfaf6] dark:hover:text-[#151917]"
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </button>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-3.5 py-1">
      {renderSubModeSelector()}

      {/* Top Action Row */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setClosingBellEnabled((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
        >
          {closingBellEnabled ? (
            <Bell className="h-3.5 w-3.5 text-[var(--accent)]" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
          {m.guided.closingBell}: {closingBellEnabled ? m.common.on : m.common.off}
        </button>

        <button
          type="button"
          onClick={() => (isAdding ? resetForm() : setIsAdding(true))}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
        >
          {isAdding ? (
            <>
              <X className="h-3.5 w-3.5" />
              {m.common.cancel}
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              {m.guided.addTrack}
            </>
          )}
        </button>
      </div>

      {/* Add Favorite Track Form */}
      {isAdding && (
        <form
          onSubmit={handleSaveTrack}
          className="flex flex-col gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10"
        >
          <div className="flex items-center justify-between">
            <label
              htmlFor="track-url-input"
              className="text-xs font-medium text-[var(--foreground)]"
            >
              {m.guided.urlLabel}
            </label>
            {detectedProvider && (
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                {m.guided.providers[detectedProvider]}
              </span>
            )}
          </div>

          <div className="relative flex items-center">
            <Link2 className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--foreground-muted)]" />
            <input
              id="track-url-input"
              type="url"
              required
              placeholder={m.guided.urlPlaceholder}
              value={urlInput}
              onChange={(event) => handleUrlChange(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-[var(--background)] pr-9 pl-9 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
            {isResolving && (
              <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-[var(--accent)]" />
            )}
          </div>

          {detectedPlaylistUrl && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)]/70 px-3 py-2 text-xs">
              <span className="text-[var(--foreground)]">
                {detectedPlaylistUrl.isDirectPlaylistUrl
                  ? m.guided.playlistUrlDetectedHint
                  : m.guided.videoInPlaylistHint}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleOpenImportWithUrl(detectedPlaylistUrl.canonicalUrl)
                }
                className="shrink-0 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                {m.guided.importDetectedPlaylist}
              </button>
            </div>
          )}

          {detectedProvider === "GOOGLE_DRIVE" && (
            <p className="text-[11px] leading-relaxed text-[var(--foreground-muted)]">
              {m.guided.googleDriveShareHint}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="track-title-input"
              className="text-xs font-medium text-[var(--foreground)]"
            >
              {m.guided.titleLabel}
            </label>
            <input
              id="track-title-input"
              type="text"
              placeholder={m.guided.titlePlaceholder}
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
          </div>

          {/* Optional Tags Picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--foreground)]">
              {m.guided.tagsLabel}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_TRACK_TAGS.map((tag) => {
                const isSelected = tagsInput.some(
                  (t) => t.toLowerCase() === tag.toLowerCase()
                );
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setTagsInput((prev) =>
                        isSelected
                          ? prev.filter(
                              (t) => t.toLowerCase() !== tag.toLowerCase()
                            )
                          : normalizeTrackTags([...prev, tag])
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                        : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              maxLength={24}
              placeholder={m.guided.customTagPlaceholder}
              value={customTagInput}
              onChange={(event) => setCustomTagInput(event.target.value)}
              className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving || !urlInput.trim()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {m.guided.saving}
              </>
            ) : (
              m.guided.saveTrack
            )}
          </button>
        </form>
      )}

      {errorMessage && !isAdding && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      {/* Single-row Filter Bar (Favorites chip + Tags) */}
      {(hasFavorites || availableTags.length > 0) && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setSelectedFilter(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              effectiveFilter === null
                ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                : "border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] dark:border-white/10"
            }`}
          >
            {m.common.all}
          </button>
          {hasFavorites && (
            <button
              type="button"
              onClick={() =>
                setSelectedFilter(
                  effectiveFilter?.type === "favorites"
                    ? null
                    : { type: "favorites" }
                )
              }
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                effectiveFilter?.type === "favorites"
                  ? "bg-[var(--warm-amber)] text-[#fcfaf6] dark:text-[#151917]"
                  : "border border-[var(--warm-amber)]/30 bg-[var(--surface)] text-[var(--warm-amber)] hover:bg-[var(--warm-amber)]/10"
              }`}
            >
              <Star className="h-2.5 w-2.5 fill-current" />
              {m.guided.favoritesFilter}
            </button>
          )}
          {availableTags.map((tag) => {
            const isSelected =
              effectiveFilter?.type === "tag" &&
              effectiveFilter.tag.toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setSelectedFilter(isSelected ? null : { type: "tag", tag })
                }
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                    : "border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] dark:border-white/10"
                }`}
              >
                <Tag className="h-2.5 w-2.5 opacity-75" />
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Guided Tracks List */}
      {displayedTracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-12 text-center dark:border-white/12">
          <Music2 className="h-7 w-7 text-[var(--foreground-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            {tracks.length === 0
              ? m.guided.noTracksTitle
              : m.guided.noTagMatchTitle}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            {tracks.length === 0
              ? m.guided.noTracksBody
              : m.guided.noTagMatchBody}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {showSectionDivider && (
            <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[11px] font-medium tracking-wide text-[var(--warm-amber)] uppercase">
              <Star className="h-3 w-3 fill-current" />
              <span>{m.guided.favoritesSection}</span>
            </div>
          )}

          {(() => {
            const renderTrackCard = (track: FavoriteTrackItem) => {
              const isDragged = draggingId === track.id;
              const isEditing = editingTrackId === track.id;
              const isTogglingFavorite = togglingFavoriteIds.includes(track.id);
              const groupSize = track.isFavorite ? favoriteCount : otherCount;
              const canDrag =
                effectiveFilter === null &&
                editingTrackId === null &&
                groupSize >= 2;

              return (
                <li
                  key={track.id}
                  ref={(node) => setTrackItemRef(track.id, node)}
                  onPointerDown={(event) => {
                    if (!canDrag) return;
                    handleTrackPointerDown(track.id, event);
                  }}
                  onContextMenu={(event) => {
                    if (canDrag) {
                      event.preventDefault();
                    }
                  }}
                  style={
                    isDragged
                      ? {
                          transform: `translate3d(0, ${dragOffsetY}px, 0) scale(1.02)`,
                        }
                      : undefined
                  }
                  className={cn(
                    "relative flex flex-col gap-2.5 rounded-2xl border p-3 shadow-xs transition-colors",
                    track.isFavorite
                      ? "border-[var(--warm-amber)]/40 bg-[color-mix(in_srgb,var(--surface)_94%,var(--warm-amber)_6%)] dark:border-[var(--warm-amber)]/35 dark:bg-[color-mix(in_srgb,var(--surface)_92%,var(--warm-amber)_8%)]"
                      : "border-black/6 bg-[var(--surface)] dark:border-white/10",
                    !isEditing && "select-none",
                    isDragged
                      ? "z-20 cursor-grabbing border-[var(--accent)]/50 shadow-lg ring-2 ring-[var(--accent)]/30"
                      : track.isFavorite
                        ? "hover:border-[var(--warm-amber)]/60"
                        : "hover:border-[var(--accent)]/35",
                    draggingId !== null && !isDragged && "opacity-85"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClickRef.current || isEditing) return;
                        setActivePlayback({ track });
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3 text-left",
                        isDragged && "cursor-grabbing"
                      )}
                    >
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        {track.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={track.thumbnailUrl}
                            alt=""
                            draggable={false}
                            referrerPolicy="no-referrer"
                            className="pointer-events-none h-full w-full object-cover"
                          />
                        ) : (
                          <Music2 className="h-5 w-5" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                          <Play className="h-4 w-4 fill-current" />
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {track.title}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                          <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">
                            {m.guided.providers[track.provider]}
                          </span>
                          {isAudioStreamProvider(track.provider) &&
                            offlineGuided.savedAudio[track.id] && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                {m.guided.savedOfflineBadge(
                                  formatBytesLabel(
                                    offlineGuided.savedAudio[track.id].bytes
                                  )
                                )}
                              </span>
                            )}
                          {track.author && (
                            <span className="truncate">{track.author}</span>
                          )}
                        </div>
                        {track.tags && track.tags.length > 0 && !isEditing && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {track.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>

                    <div
                      data-no-drag="true"
                      className="flex shrink-0 items-center gap-0.5"
                    >
                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => void handleToggleFavorite(track)}
                        disabled={isTogglingFavorite}
                        aria-pressed={track.isFavorite}
                        aria-label={
                          track.isFavorite
                            ? m.guided.removeFavoriteAria(track.title)
                            : m.guided.addFavoriteAria(track.title)
                        }
                        title={
                          track.isFavorite
                            ? m.guided.removeFavoriteAria(track.title)
                            : m.guided.addFavoriteAria(track.title)
                        }
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-xl transition-colors disabled:opacity-50 sm:h-8 sm:w-8",
                          track.isFavorite
                            ? "text-[var(--warm-amber)] hover:bg-[var(--warm-amber)]/12"
                            : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--warm-amber)]"
                        )}
                      >
                        <Star
                          className={cn(
                            "h-3.5 w-3.5",
                            track.isFavorite && "fill-current"
                          )}
                        />
                      </button>

                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => setPlaylistSheetTrack(track)}
                        aria-label={m.guided.playlists.addToPlaylistAria(
                          track.title
                        )}
                        title={m.guided.playlists.addToPlaylistAria(
                          track.title
                        )}
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] sm:h-8 sm:w-8"
                      >
                        <ListPlus className="h-3.5 w-3.5" />
                      </button>

                      {isAudioStreamProvider(track.provider) && (
                        <button
                          type="button"
                          data-no-drag="true"
                          onClick={() => void handleToggleOfflineTrack(track)}
                          disabled={downloadingTrackId === track.id}
                          aria-label={
                            offlineGuided.savedAudio[track.id]
                              ? m.guided.removeOfflineAria(track.title)
                              : m.guided.saveOfflineAria(track.title)
                          }
                          title={
                            downloadingTrackId === track.id
                              ? m.guided.downloadingOffline
                              : offlineGuided.savedAudio[track.id]
                                ? m.guided.removeOfflineAria(track.title)
                                : m.guided.saveOfflineAria(track.title)
                          }
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-xl transition-colors disabled:opacity-50 sm:h-8 sm:w-8",
                            offlineGuided.savedAudio[track.id]
                              ? "text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                              : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                          )}
                        >
                          {downloadingTrackId === track.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : offlineGuided.savedAudio[track.id] ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() =>
                          isEditing
                            ? cancelEditingTrack()
                            : startEditingTrack(track)
                        }
                        aria-label={`${m.common.edit} ${track.title}`}
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] sm:h-8 sm:w-8"
                      >
                        {isEditing ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <Pencil className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => void handleDeleteTrack(track.id)}
                        disabled={deletingId === track.id}
                        aria-label={`Remove ${track.title}`}
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400 sm:h-8 sm:w-8"
                      >
                        {deletingId === track.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Inline Title & Tags Editor */}
                  {isEditing && (
                    <div
                      data-no-drag="true"
                      className="flex flex-col gap-2.5 border-t border-black/6 pt-2.5 dark:border-white/10"
                    >
                      <input
                        type="text"
                        maxLength={160}
                        value={editTitleDraft}
                        onChange={(event) =>
                          setEditTitleDraft(event.target.value)
                        }
                        placeholder={m.guided.editTrackTitlePlaceholder}
                        className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
                      />

                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(
                          new Set([...SUGGESTED_TRACK_TAGS, ...editTagsDraft])
                        ).map((tag) => {
                          const isSelected = editTagsDraft.some(
                            (t) => t.toLowerCase() === tag.toLowerCase()
                          );
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setEditTagsDraft((prev) =>
                                  isSelected
                                    ? prev.filter(
                                        (t) =>
                                          t.toLowerCase() !== tag.toLowerCase()
                                      )
                                    : normalizeTrackTags([...prev, tag])
                                )
                              }
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                                isSelected
                                  ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={24}
                          placeholder={m.guided.customTagPlaceholder}
                          value={editCustomTagDraft}
                          onChange={(event) =>
                            setEditCustomTagDraft(event.target.value)
                          }
                          className="h-8 min-w-0 flex-1 rounded-xl border border-black/10 bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
                        />
                        <button
                          type="button"
                          onClick={cancelEditingTrack}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        >
                          {m.common.cancel}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveTrackEdit(track.id)}
                          disabled={isSavingEdit || !editTitleDraft.trim()}
                          className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#fcfaf6] disabled:opacity-50 dark:text-[#151917]"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          {m.common.save}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            };

            if (showSectionDivider) {
              return (
                <>
                  <ul className="flex flex-col gap-2.5">
                    {displayedFavorites.map(renderTrackCard)}
                  </ul>
                  <div
                    role="separator"
                    className="my-1 border-t border-black/8 dark:border-white/10"
                  />
                  <ul className="flex flex-col gap-2.5">
                    {displayedOthers.map(renderTrackCard)}
                  </ul>
                </>
              );
            }

            return (
              <ul className="flex flex-col gap-2.5">
                {displayedTracks.map(renderTrackCard)}
              </ul>
            );
          })()}

          {canDragAnyGroup && (
            <p className="pt-1 text-center text-[11px] text-[var(--foreground-muted)]/75">
              {m.guided.holdAndDrag}
            </p>
          )}
        </div>
      )}

      {playlistSheetTrack && (
        <AddToPlaylistSheet
          track={playlistSheetTrack}
          playlists={playlists}
          onClose={() => setPlaylistSheetTrack(null)}
          onPlaylistUpdated={handlePlaylistUpdated}
          onPlaylistCreated={handlePlaylistCreated}
        />
      )}
    </section>
  );
}
