import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Wifi, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BottomNav } from './components/BottomNav';
import { ExploreView } from './components/ExploreView';
import { FullScreenPlayer } from './components/FullScreenPlayer';
import { LibraryView } from './components/LibraryView';
import { MiniPlayer } from './components/MiniPlayer';
import { PlaylistPickerModal } from './components/PlaylistPickerModal';
import { PWAInstallModal } from './components/PWAInstallModal';
import { SettingsView } from './components/SettingsView';
import { CATALOG_TRACKS, DEFAULT_DRIVE_FOLDER_URL } from './data/tracks';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  AudioQuality,
  LibraryTab,
  NavTab,
  Playlist,
  RepeatMode,
  Track,
} from './types/music';
import {
  clearOfflineTrackDatabase,
  deleteOfflineTrackRecord,
  getAllOfflineTrackRecords,
  getOfflineTrackRecord,
  saveOfflineTrackBlob,
} from './utils/indexedDb';
import { sanitizeDownloadFilename } from './utils/musicNormalizer';
import {
  cacheTrackAudioOffline,
  clearAllCachedAudio,
  loadPersistedDownloadedIds,
  loadPersistedLikedIds,
  loadPersistedPlaylists,
  loadPersistedQuality,
  removeCachedTrackAudio,
  savePersistedDownloadedIds,
  savePersistedLikedIds,
  savePersistedPlaylists,
  savePersistedQuality,
} from './utils/offlineStorage';
import {
  calculateStorageStats,
  canPlayTrack,
  cycleRepeatMode,
  filterTracks,
  getNextTrackIndex,
} from './utils/playerLogic';

interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'warning';
}

function getPlayableAudioSrc(track: Track): string {
  if (track.audioUrl.startsWith('http://') || track.audioUrl.startsWith('https://')) {
    return `/api/music/audio?url=${encodeURIComponent(track.audioUrl)}`;
  }
  return track.audioUrl;
}

export default function App() {
  // Navigation & UI state
  const [activeNav, setActiveNav] = useState<NavTab>('explore');
  const [librarySubTab, setLibrarySubTab] = useState<LibraryTab>('downloads');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState('all');
  const [driveFolderUrl, setDriveFolderUrl] = useState(DEFAULT_DRIVE_FOLDER_URL);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [keepScreenAwake, setKeepScreenAwake] = useState<boolean>(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Online API & IndexedDB track catalogs
  const [onlineFeedTracks, setOnlineFeedTracks] = useState<Track[]>([]);
  const [searchResultTracks, setSearchResultTracks] = useState<Track[] | null>(null);
  const [savedTrackMap, setSavedTrackMap] = useState<Record<string, Track>>({});
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [isLiveApi, setIsLiveApi] = useState(false);

  // Persisted user data
  const [downloadedIdList, setDownloadedIdList] = useState<string[]>(() =>
    loadPersistedDownloadedIds()
  );
  const [likedIdList, setLikedIdList] = useState<string[]>(() =>
    loadPersistedLikedIds()
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    loadPersistedPlaylists()
  );
  const [audioQuality, setAudioQuality] = useState<AudioQuality>(() =>
    loadPersistedQuality()
  );

  // Active download percentages keyed by track ID
  const [downloadProgressMap, setDownloadProgressMap] = useState<
    Record<string, number>
  >({});

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const [queue, setQueue] = useState<Track[]>(CATALOG_TRACKS);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(
    CATALOG_TRACKS[0]?.id ?? null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(
    CATALOG_TRACKS[0]?.durationSec ?? 0
  );
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');

  const downloadedIds = useMemo(
    () => new Set(downloadedIdList),
    [downloadedIdList]
  );
  const likedIds = useMemo(() => new Set(likedIdList), [likedIdList]);

  // Unified known track registry (offline IndexedDB tracks + online feed + search + local fallback)
  const knownTracks = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of CATALOG_TRACKS) map.set(t.id, t);
    for (const t of Object.values(savedTrackMap)) map.set(t.id, t);
    for (const t of onlineFeedTracks) map.set(t.id, t);
    if (searchResultTracks) {
      for (const t of searchResultTracks) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [onlineFeedTracks, savedTrackMap, searchResultTracks]);

  const currentTrack = useMemo(
    () => knownTracks.find((t) => t.id === currentTrackId) ?? null,
    [knownTracks, currentTrackId]
  );

  const storageStats = useMemo(
    () => calculateStorageStats(knownTracks, downloadedIds, audioQuality),
    [knownTracks, downloadedIds, audioQuality]
  );

  const exploreTracks = useMemo(() => {
    if (isOfflineMode) {
      return filterTracks(knownTracks, searchQuery, {
        offlineOnly: true,
        downloadedIds,
      });
    }
    if (searchQuery.trim()) {
      if (searchResultTracks !== null) {
        return searchResultTracks;
      }
      return filterTracks(knownTracks, searchQuery);
    }
    return onlineFeedTracks.length > 0 ? onlineFeedTracks : CATALOG_TRACKS;
  }, [
    downloadedIds,
    isOfflineMode,
    knownTracks,
    onlineFeedTracks,
    searchQuery,
    searchResultTracks,
  ]);

  const featuredTrack = useMemo(() => {
    if (onlineFeedTracks.length > 0) {
      return onlineFeedTracks[0];
    }
    return CATALOG_TRACKS.find((t) => t.featured) ?? CATALOG_TRACKS[0];
  }, [onlineFeedTracks]);

  const showToast = useCallback(
    (message: string, tone: ToastState['tone'] = 'info') => {
      setToast({ id: Date.now(), message, tone });
    },
    []
  );

  // Hydrate downloaded tracks metadata from IndexedDB on startup
  useEffect(() => {
    let active = true;
    getAllOfflineTrackRecords().then((records) => {
      if (!active || records.length === 0) return;
      const map: Record<string, Track> = {};
      const ids: string[] = [];
      for (const rec of records) {
        map[rec.id] = rec.track;
        ids.push(rec.id);
      }
      setSavedTrackMap((prev) => ({ ...prev, ...map }));
      setDownloadedIdList((prev) => Array.from(new Set([...prev, ...ids])));
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch complete music feed (Google Drive folder + online streams)
  const fetchDiscoverFeed = useCallback(
    async (genre: string, folderOverride?: string, forceRefresh = false) => {
      if (isOfflineMode) return;
      setIsLoadingApi(true);
      const targetFolder = folderOverride ?? driveFolderUrl;
      try {
        const res = await fetch(
          `/api/music/discover?genre=${encodeURIComponent(genre)}&folder=${encodeURIComponent(targetFolder)}${forceRefresh ? '&refresh=1' : ''}`,
          { signal: AbortSignal.timeout(8500) }
        );
        if (!res.ok) throw new Error('Discover request failed');
        const data = (await res.json()) as { tracks?: Track[]; live?: boolean };
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          setOnlineFeedTracks(data.tracks);
          setIsLiveApi(Boolean(data.live));
          if (forceRefresh) {
            showToast(
              `Disinkronkan ${data.tracks.length} lagu dari Google Drive`,
              'success'
            );
          }
        } else {
          setIsLiveApi(false);
        }
      } catch {
        setIsLiveApi(false);
      } finally {
        setIsLoadingApi(false);
      }
    },
    [driveFolderUrl, isOfflineMode, showToast]
  );

  const handleSyncDriveFolder = useCallback(
    (folderUrl: string) => {
      setDriveFolderUrl(folderUrl);
      void fetchDiscoverFeed(activeGenre, folderUrl, true);
    },
    [activeGenre, fetchDiscoverFeed]
  );

  useEffect(() => {
    if (!isOfflineMode) {
      void fetchDiscoverFeed(activeGenre);
    }
  }, [activeGenre, fetchDiscoverFeed, isOfflineMode]);

  // Debounced live search against /api/music/search (Drive + Audius)
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isOfflineMode) {
      setSearchResultTracks(null);
      return;
    }

    let cancelled = false;
    setIsLoadingApi(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/music/search?q=${encodeURIComponent(trimmed)}&folder=${encodeURIComponent(driveFolderUrl)}`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) throw new Error('Search request failed');
        const data = (await res.json()) as { tracks?: Track[] };
        if (cancelled) return;
        const apiTracks = Array.isArray(data.tracks) ? data.tracks : [];
        if (apiTracks.length > 0) {
          setSearchResultTracks(apiTracks);
        } else {
          setSearchResultTracks(filterTracks(CATALOG_TRACKS, trimmed));
        }
      } catch {
        if (!cancelled) {
          setSearchResultTracks(filterTracks(CATALOG_TRACKS, trimmed));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingApi(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [driveFolderUrl, isOfflineMode, searchQuery]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((prev) => (prev?.id === toast.id ? null : prev));
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Persist user collections
  useEffect(() => {
    savePersistedDownloadedIds(downloadedIdList);
  }, [downloadedIdList]);

  useEffect(() => {
    savePersistedLikedIds(likedIdList);
  }, [likedIdList]);

  useEffect(() => {
    savePersistedPlaylists(playlists);
  }, [playlists]);

  useEffect(() => {
    savePersistedQuality(audioQuality);
  }, [audioQuality]);

  // Real browser online/offline listeners
  useEffect(() => {
    const handleOnline = () => setIsOfflineMode(false);
    const handleOffline = () => setIsOfflineMode(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Revoke ObjectURL on unmount
  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
    };
  }, []);

  // Load audio source (prefers local IndexedDB blob when available)
  const loadAudioSourceForTrack = useCallback(async (track: Track): Promise<string> => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
    const offlineRec = await getOfflineTrackRecord(track.id);
    if (offlineRec?.audioBlob) {
      const objUrl = URL.createObjectURL(offlineRec.audioBlob);
      activeObjectUrlRef.current = objUrl;
      return objUrl;
    }
    return getPlayableAudioSrc(track);
  }, []);

  // Offline auto-fallback when switching to offline mode
  useEffect(() => {
    if (!isOfflineMode || !currentTrackId) return;
    if (!downloadedIds.has(currentTrackId)) {
      const firstOffline = knownTracks.find((t) => downloadedIds.has(t.id));
      if (firstOffline) {
        setCurrentTrackId(firstOffline.id);
        setCurrentTime(0);
        setDuration(firstOffline.durationSec);
        void loadAudioSourceForTrack(firstOffline).then((src) => {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = src;
            audioRef.current.load();
          }
        });
        setIsPlaying(false);
        showToast(`Switched to offline track: ${firstOffline.title}`, 'info');
      } else {
        if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
      }
    }
  }, [
    currentTrackId,
    downloadedIds,
    isOfflineMode,
    knownTracks,
    loadAudioSourceForTrack,
    showToast,
  ]);

  // Ensure initial audio src is set on mount
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || audio.src) return;
    void loadAudioSourceForTrack(currentTrack).then((src) => {
      if (audioRef.current && !audioRef.current.src) {
        audioRef.current.src = src;
      }
    });
  }, [currentTrack, loadAudioSourceForTrack]);

  const handlePlayTrack = useCallback(
    async (track: Track, queueOverride?: Track[]) => {
      const check = canPlayTrack(track.id, isOfflineMode, downloadedIds);
      if (!check.allowed) {
        showToast(check.reason ?? 'Track unavailable offline', 'warning');
        return;
      }

      if (queueOverride && queueOverride.length > 0) {
        setQueue(queueOverride);
      } else {
        setQueue(exploreTracks.length > 0 ? exploreTracks : knownTracks);
      }

      const audio = audioRef.current;
      if (!audio) return;

      if (currentTrackId === track.id) {
        if (isPlaying) {
          audio.pause();
          setIsPlaying(false);
        } else {
          try {
            await audio.play();
            setIsPlaying(true);
          } catch {
            setIsPlaying(false);
          }
        }
        return;
      }

      setCurrentTrackId(track.id);
      setCurrentTime(0);
      setDuration(track.durationSec);
      const src = await loadAudioSourceForTrack(track);
      audio.src = src;
      audio.load();
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    },
    [
      currentTrackId,
      downloadedIds,
      exploreTracks,
      isOfflineMode,
      isPlaying,
      knownTracks,
      loadAudioSourceForTrack,
      showToast,
    ]
  );

  const handleTogglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const check = canPlayTrack(currentTrack.id, isOfflineMode, downloadedIds);
    if (!check.allowed) {
      showToast(check.reason ?? 'Track unavailable offline', 'warning');
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        if (!audio.src) {
          audio.src = await loadAudioSourceForTrack(currentTrack);
        }
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  }, [
    currentTrack,
    downloadedIds,
    isOfflineMode,
    isPlaying,
    loadAudioSourceForTrack,
    showToast,
  ]);

  const handleStepTrack = useCallback(
    async (direction: 'next' | 'prev') => {
      const effectiveQueue = isOfflineMode
        ? queue.filter((t) => downloadedIds.has(t.id))
        : queue;

      if (effectiveQueue.length === 0) {
        showToast('No playable tracks in queue', 'warning');
        return;
      }

      const currentIdx = effectiveQueue.findIndex((t) => t.id === currentTrackId);
      const nextIdx = getNextTrackIndex({
        currentIndex: currentIdx >= 0 ? currentIdx : 0,
        queueLength: effectiveQueue.length,
        repeatMode,
        shuffle,
        direction,
      });

      if (nextIdx === null) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        setIsPlaying(false);
        setCurrentTime(0);
        return;
      }

      const nextTrack = effectiveQueue[nextIdx];
      if (!nextTrack) return;

      const audio = audioRef.current;
      if (!audio) return;

      setCurrentTrackId(nextTrack.id);
      setCurrentTime(0);
      setDuration(nextTrack.durationSec);
      const src = await loadAudioSourceForTrack(nextTrack);
      audio.src = src;
      audio.load();
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    },
    [
      currentTrackId,
      downloadedIds,
      isOfflineMode,
      loadAudioSourceForTrack,
      queue,
      repeatMode,
      shuffle,
      showToast,
    ]
  );

  const updateMediaSessionPosition = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;

    const totalDuration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : duration > 0
        ? duration
        : 0;
    if (totalDuration <= 0) return;

    const safePosition = Math.max(
      0,
      Math.min(Number.isFinite(audio.currentTime) ? audio.currentTime : 0, totalDuration)
    );

    try {
      navigator.mediaSession.setPositionState({
        duration: totalDuration,
        playbackRate: audio.playbackRate || 1,
        position: safePosition,
      });
    } catch {
      // Ignore transient browser position errors
    }
  }, [duration]);

  const handleSeek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      const clampedTime = Math.max(0, time);
      setCurrentTime(clampedTime);
      if (audio && Number.isFinite(clampedTime)) {
        audio.currentTime = clampedTime;
        updateMediaSessionPosition();
      }
    },
    [updateMediaSessionPosition]
  );

  // Wire HTML5 audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      updateMediaSessionPosition();
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        updateMediaSessionPosition();
      }
    };
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        updateMediaSessionPosition();
      }
    };
    const onPlay = () => {
      setIsPlaying(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      updateMediaSessionPosition();
    };
    const onPause = () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      updateMediaSessionPosition();
    };
    const onEnded = () => {
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        void audio.play();
      } else {
        void handleStepTrack('next');
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [handleStepTrack, repeatMode, updateMediaSessionPosition]);

  // Wire Lock Screen & Background Media Session API (Android / iOS / Desktop)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const artworkList: MediaImage[] = [];
    if (currentTrack.coverUrl) {
      artworkList.push(
        { src: currentTrack.coverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: currentTrack.coverUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: currentTrack.coverUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: currentTrack.coverUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: currentTrack.coverUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }
      );
    }
    artworkList.push(
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
    );

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album || 'ReyTune Full Music',
      artwork: artworkList,
    });

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    updateMediaSessionPosition();

    const safeSetActionHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported media session action on this OS
      }
    };

    safeSetActionHandler('play', () => {
      const audio = audioRef.current;
      if (audio && audio.paused) {
        void handleTogglePlay();
      }
    });
    safeSetActionHandler('pause', () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
      }
    });
    safeSetActionHandler('nexttrack', () => void handleStepTrack('next'));
    safeSetActionHandler('previoustrack', () => void handleStepTrack('prev'));
    safeSetActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        handleSeek(details.seekTime);
      }
    });
    safeSetActionHandler('seekbackward', (details) => {
      const audio = audioRef.current;
      const offset = details.seekOffset || 10;
      if (audio) {
        handleSeek(Math.max(0, audio.currentTime - offset));
      }
    });
    safeSetActionHandler('seekforward', (details) => {
      const audio = audioRef.current;
      const offset = details.seekOffset || 10;
      if (audio) {
        const maxDur =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : duration;
        handleSeek(Math.min(maxDur || Infinity, audio.currentTime + offset));
      }
    });
  }, [
    currentTrack,
    duration,
    handleSeek,
    handleStepTrack,
    handleTogglePlay,
    isPlaying,
    updateMediaSessionPosition,
  ]);

  // Optional Screen Wake Lock when requested in Settings
  useEffect(() => {
    if (!keepScreenAwake || !isPlaying) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let wakeLockSentinel: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Ignore if battery saver or background tab blocks Wake Lock
      }
    };

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && keepScreenAwake && isPlaying) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockSentinel) {
        void wakeLockSentinel.release().catch(() => undefined);
      }
    };
  }, [keepScreenAwake, isPlaying]);

  // Real byte-streaming download into IndexedDB + Cache API
  const handleDownloadTrack = useCallback(
    async (track: Track) => {
      if (isOfflineMode) {
        showToast('Switch to Online Mode to download tracks', 'warning');
        return;
      }
      if (downloadedIds.has(track.id) || downloadProgressMap[track.id] !== undefined) {
        return;
      }

      setDownloadProgressMap((prev) => ({ ...prev, [track.id]: 5 }));

      try {
        const fetchUrl = getPlayableAudioSrc(track);
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentLength = Number(res.headers.get('content-length') || '0');
        let blob: Blob;

        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          let fallbackPct = 10;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.byteLength;
              if (contentLength > 0) {
                const pct = Math.min(98, Math.max(5, Math.round((received / contentLength) * 100)));
                setDownloadProgressMap((prev) => ({ ...prev, [track.id]: pct }));
              } else {
                fallbackPct = Math.min(95, fallbackPct + 8);
                setDownloadProgressMap((prev) => ({ ...prev, [track.id]: fallbackPct }));
              }
            }
          }
          const mime = res.headers.get('content-type') || 'audio/mpeg';
          const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
          const merged = new Uint8Array(totalBytes);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
          }
          blob = new Blob([merged.buffer], { type: mime });
        } else {
          blob = await res.blob();
        }

        setDownloadProgressMap((prev) => ({ ...prev, [track.id]: 100 }));

        const record = await saveOfflineTrackBlob(track, blob);
        await cacheTrackAudioOffline(fetchUrl);

        setSavedTrackMap((prev) => ({ ...prev, [track.id]: record.track }));
        setDownloadedIdList((prev) =>
          prev.includes(track.id) ? prev : [...prev, track.id]
        );
        showToast(`Saved "${track.title}" for offline playback`, 'success');
      } catch {
        showToast(`Failed to download "${track.title}"`, 'warning');
      } finally {
        setDownloadProgressMap((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      }
    },
    [downloadProgressMap, downloadedIds, isOfflineMode, showToast]
  );

  // Direct device file download (.mp3)
  const handleSaveFileToDevice = useCallback(
    async (track: Track) => {
      try {
        const filename = sanitizeDownloadFilename(track.title, track.artist);
        const offlineRec = await getOfflineTrackRecord(track.id);
        if (offlineRec?.audioBlob) {
          const blobUrl = URL.createObjectURL(offlineRec.audioBlob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
          showToast(`Exported "${filename}"`, 'success');
          return;
        }

        const downloadUrl =
          track.audioUrl.startsWith('http://') || track.audioUrl.startsWith('https://')
            ? `/api/music/audio?url=${encodeURIComponent(track.audioUrl)}&download=1&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`
            : track.audioUrl.startsWith('/api/music/ytm-audio')
            ? `${track.audioUrl}&download=1`
            : track.audioUrl;

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(`Downloading "${filename}"`, 'success');
      } catch {
        showToast('Could not save file to device', 'warning');
      }
    },
    [showToast]
  );

  const handleDeleteDownload = useCallback(
    (track: Track) => {
      setDownloadedIdList((prev) => prev.filter((id) => id !== track.id));
      void deleteOfflineTrackRecord(track.id);
      void removeCachedTrackAudio(getPlayableAudioSrc(track));
      showToast(`Removed "${track.title}" from offline storage`, 'info');
    },
    [showToast]
  );

  const handleClearAllDownloads = useCallback(() => {
    setDownloadedIdList([]);
    setSavedTrackMap({});
    void clearOfflineTrackDatabase();
    void clearAllCachedAudio();
    showToast('Cleared all offline downloads', 'info');
  }, [showToast]);

  const handleToggleLike = useCallback(
    (trackId: string) => {
      const targetTrack = knownTracks.find((t) => t.id === trackId);
      if (targetTrack) {
        setSavedTrackMap((prev) => ({ ...prev, [trackId]: targetTrack }));
      }
      setLikedIdList((prev) => {
        const exists = prev.includes(trackId);
        if (exists) {
          if (targetTrack) showToast(`Removed "${targetTrack.title}" from Liked`, 'info');
          return prev.filter((id) => id !== trackId);
        }
        if (targetTrack) showToast(`Added "${targetTrack.title}" to Liked`, 'success');
        return [...prev, trackId];
      });
    },
    [knownTracks, showToast]
  );

  const handleToggleTrackInPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      const targetTrack = knownTracks.find((t) => t.id === trackId);
      if (targetTrack) {
        setSavedTrackMap((prev) => ({ ...prev, [trackId]: targetTrack }));
      }
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          const exists = pl.trackIds.includes(trackId);
          return {
            ...pl,
            trackIds: exists
              ? pl.trackIds.filter((id) => id !== trackId)
              : [...pl.trackIds, trackId],
          };
        })
      );
    },
    [knownTracks]
  );

  const handleCreatePlaylist = useCallback(
    (name: string, initialTrackId?: string) => {
      if (initialTrackId) {
        const targetTrack = knownTracks.find((t) => t.id === initialTrackId);
        if (targetTrack) {
          setSavedTrackMap((prev) => ({ ...prev, [initialTrackId]: targetTrack }));
        }
      }
      const newPlaylist: Playlist = {
        id: `pl-${Date.now()}`,
        name,
        trackIds: initialTrackId ? [initialTrackId] : [],
        createdAt: Date.now(),
      };
      setPlaylists((prev) => [newPlaylist, ...prev]);
      showToast(`Created playlist "${name}"`, 'success');
    },
    [knownTracks, showToast]
  );

  const handleDeletePlaylist = useCallback(
    (playlistId: string) => {
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
      showToast('Playlist deleted', 'info');
    },
    [showToast]
  );

  const handleRemoveTrackFromPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setPlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId
            ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) }
            : pl
        )
      );
    },
    []
  );

  const pageHeading =
    activeNav === 'explore'
      ? 'Explore'
      : activeNav === 'library'
      ? 'Library'
      : 'Settings';

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F8FAFC]">
      {/* Hidden HTML5 Audio Element configured for background & lock-screen playback */}
      <audio ref={audioRef} preload="auto" playsInline />

      {/* Centered Mobile-First Shell */}
      <div className="max-w-md mx-auto min-h-screen relative flex flex-col bg-[#0B0F17] sm:border-x sm:border-[#1E293B]/60">
        {/* Top Bar with ReyTune Branding, Install PWA Trigger & Online/Offline Switch */}
        <header className="sticky top-0 z-30 bg-[#0B0F17]/95 backdrop-blur-md border-b border-[#1E293B]/80 px-4 pt-[max(0.35rem,env(safe-area-inset-top,0px))] pb-1.5 min-h-[60px] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/icon.svg"
              alt="ReyTune logo"
              className="w-7 h-7 rounded-lg shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-[18px] font-bold tracking-tight text-[#F8FAFC] leading-none truncate">
                ReyTune
              </h1>
              <p className="text-[11px] text-[#94A3B8] mt-0.5 leading-none">
                {pageHeading}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isInstalled && (
              <button
                type="button"
                onClick={() => setIsInstallModalOpen(true)}
                aria-label="Install ReyTune PWA"
                title="Install ReyTune PWA"
                data-testid="header-install-pwa"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#131A26] hover:bg-[#1E293B] border border-[#1E293B] text-[#10B981] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <Download size={16} />
              </button>
            )}

            {/* Online / Offline Mode Simulation Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={isOfflineMode}
              aria-label={
                isOfflineMode
                  ? 'Offline Mode active. Switch to Online Mode'
                  : 'Online Mode active. Switch to Offline Mode'
              }
              data-testid="offline-mode-switch"
              onClick={() => setIsOfflineMode((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                isOfflineMode
                  ? 'bg-[#1E293B] border-[#10B981]/50 text-[#10B981]'
                  : 'bg-[#131A26] border-[#1E293B] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {isOfflineMode ? (
                <WifiOff size={14} className="text-[#10B981]" />
              ) : (
                <Wifi size={14} className="text-[#10B981]" />
              )}
              <span>{isOfflineMode ? 'Offline' : 'Online'}</span>
              <span
                aria-hidden="true"
                className={`w-6 h-3.5 rounded-full p-0.5 transition-colors flex items-center ${
                  isOfflineMode ? 'bg-[#10B981]' : 'bg-[#334155]'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full bg-[#0B0F17] transition-transform ${
                    isOfflineMode ? 'translate-x-2.5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>
          </div>
        </header>

        {/* Main Scrollable Content Area */}
        <main className="flex-1 px-4 pt-4 pb-56">
          <AnimatePresence>
            {isOfflineMode && (
              <motion.div
                key="offline-banner"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                role="status"
                data-testid="offline-banner"
                className="mb-4 flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-[#1E293B] text-[#10B981] text-xs font-medium border border-[#10B981]/25"
              >
                <WifiOff size={14} className="shrink-0" />
                <span>Mode Offline Aktif • Menampilkan lagu tersimpan</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {activeNav === 'explore' && (
              <motion.div
                key="tab-explore"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                <ExploreView
                  tracks={exploreTracks}
                  featuredTrack={featuredTrack}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  activeGenre={activeGenre}
                  onSelectGenre={setActiveGenre}
                  driveFolderUrl={driveFolderUrl}
                  onSyncDriveFolder={handleSyncDriveFolder}
                  isLoadingApi={isLoadingApi}
                  isLiveApi={isLiveApi}
                  onRefreshFeed={() =>
                    void fetchDiscoverFeed(activeGenre, driveFolderUrl, true)
                  }
                  isOfflineMode={isOfflineMode}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  downloadedIds={downloadedIds}
                  likedIds={likedIds}
                  downloadProgressMap={downloadProgressMap}
                  audioQuality={audioQuality}
                  onPlayTrack={(track) => void handlePlayTrack(track)}
                  onDownloadTrack={(track) => void handleDownloadTrack(track)}
                  onSaveFileToDevice={(track) => void handleSaveFileToDevice(track)}
                  onDeleteDownload={handleDeleteDownload}
                  onToggleLike={handleToggleLike}
                  onAddToPlaylist={(track) => setPlaylistPickerTrack(track)}
                  onSwitchToOnline={() => setIsOfflineMode(false)}
                />
              </motion.div>
            )}

            {activeNav === 'library' && (
              <motion.div
                key="tab-library"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                <LibraryView
                  allTracks={knownTracks}
                  downloadedIds={downloadedIds}
                  likedIds={likedIds}
                  playlists={playlists}
                  storageStats={storageStats}
                  activeSubTab={librarySubTab}
                  onSelectSubTab={setLibrarySubTab}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  downloadProgressMap={downloadProgressMap}
                  isOfflineMode={isOfflineMode}
                  audioQuality={audioQuality}
                  onPlayTrack={(track, queueOverride) =>
                    void handlePlayTrack(track, queueOverride)
                  }
                  onDownloadTrack={(track) => void handleDownloadTrack(track)}
                  onSaveFileToDevice={(track) => void handleSaveFileToDevice(track)}
                  onDeleteDownload={handleDeleteDownload}
                  onToggleLike={handleToggleLike}
                  onAddToPlaylist={(track) => setPlaylistPickerTrack(track)}
                  onCreatePlaylist={(name) => handleCreatePlaylist(name)}
                  onDeletePlaylist={handleDeletePlaylist}
                  onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
                />
              </motion.div>
            )}

            {activeNav === 'settings' && (
              <motion.div
                key="tab-settings"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                <SettingsView
                  audioQuality={audioQuality}
                  onChangeQuality={(q) => {
                    setAudioQuality(q);
                    showToast(`Download quality set to ${q} kbps`, 'info');
                  }}
                  storageStats={storageStats}
                  onClearAllDownloads={handleClearAllDownloads}
                  isInstallable={isInstallable}
                  isInstalled={isInstalled}
                  onOpenInstallModal={() => setIsInstallModalOpen(true)}
                  keepScreenAwake={keepScreenAwake}
                  onToggleKeepScreenAwake={() => {
                    setKeepScreenAwake((prev) => {
                      const next = !prev;
                      showToast(
                        next
                          ? 'Mode Jaga Layar Tetap Menyala aktif'
                          : 'Mode Layar Mati normal (Musik tetap jalan di Layar Kunci)',
                        'info'
                      );
                      return next;
                    });
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Floating Toast Feedback anchored above MiniPlayer */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              role="status"
              aria-live="polite"
              className={`fixed left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[424px] pointer-events-none ${
                currentTrack
                  ? 'bottom-[calc(166px+env(safe-area-inset-bottom,0px))] sm:bottom-[154px]'
                  : 'bottom-[calc(102px+env(safe-area-inset-bottom,0px))] sm:bottom-[90px]'
              }`}
            >
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#1E293B]/95 backdrop-blur-md border border-[#334155]/80 shadow-xl text-xs font-medium text-[#F8FAFC]">
                <CheckCircle2
                  size={15}
                  className={
                    toast.tone === 'warning'
                      ? 'text-[#EF4444] shrink-0'
                      : 'text-[#10B981] shrink-0'
                  }
                />
                <span className="truncate">{toast.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Persistent Mini Player floating directly above Bottom Nav */}
        {currentTrack && (
          <MiniPlayer
            track={currentTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            onTogglePlay={() => void handleTogglePlay()}
            onNext={() => void handleStepTrack('next')}
            onExpand={() => setIsFullPlayerOpen(true)}
          />
        )}

        {/* Fixed Bottom Navigation Bar */}
        <BottomNav activeTab={activeNav} onSelectTab={setActiveNav} />

        {/* Full-Screen Now Playing Drawer */}
        <FullScreenPlayer
          isOpen={isFullPlayerOpen}
          track={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          isLiked={currentTrack ? likedIds.has(currentTrack.id) : false}
          isDownloaded={currentTrack ? downloadedIds.has(currentTrack.id) : false}
          downloadProgress={
            currentTrack ? downloadProgressMap[currentTrack.id] : undefined
          }
          isOfflineMode={isOfflineMode}
          shuffle={shuffle}
          repeatMode={repeatMode}
          onClose={() => setIsFullPlayerOpen(false)}
          onTogglePlay={() => void handleTogglePlay()}
          onNext={() => void handleStepTrack('next')}
          onPrevious={() => void handleStepTrack('prev')}
          onSeek={handleSeek}
          onToggleLike={handleToggleLike}
          onToggleShuffle={() => setShuffle((prev) => !prev)}
          onCycleRepeat={() => setRepeatMode((prev) => cycleRepeatMode(prev))}
          onDownload={(track) => void handleDownloadTrack(track)}
          onSaveFileToDevice={(track) => void handleSaveFileToDevice(track)}
          onAddToPlaylist={(track) => setPlaylistPickerTrack(track)}
        />

        {/* Playlist Picker Modal */}
        <PlaylistPickerModal
          track={playlistPickerTrack}
          playlists={playlists}
          onClose={() => setPlaylistPickerTrack(null)}
          onToggleTrackInPlaylist={handleToggleTrackInPlaylist}
          onCreatePlaylist={handleCreatePlaylist}
        />

        {/* PWA Install Modal */}
        <PWAInstallModal
          isOpen={isInstallModalOpen}
          isInstallable={isInstallable}
          isInstalled={isInstalled}
          isIOS={isIOS}
          onClose={() => setIsInstallModalOpen(false)}
          onNativeInstall={install}
        />
      </div>
    </div>
  );
}
