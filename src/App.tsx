import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Wifi, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BottomNav } from './components/BottomNav';
import { TrackPhotoBackground } from './components/CoverArtwork';
import { ExploreView } from './components/ExploreView';
import { FullScreenPlayer } from './components/FullScreenPlayer';
import { LibraryView } from './components/LibraryView';
import { MiniPlayer } from './components/MiniPlayer';
import { PlaylistPickerModal } from './components/PlaylistPickerModal';
import { PWAInstallModal } from './components/PWAInstallModal';
import { SettingsView } from './components/SettingsView';
import {
  CATALOG_TRACKS,
  DEFAULT_DRIVE_FOLDER_URL,
  DRIVE_FOLDER_TRACKS,
  LOCAL_BUNDLED_TRACKS,
  YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
} from './data/tracks';
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

// Valid 1-sample silent PCM WAV to synchronously unlock HTMLAudioElement inside mobile tap gestures
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function getDirectAudioSrc(track: Track): string {
  if (track.audioUrl.startsWith('http://') || track.audioUrl.startsWith('https://')) {
    return track.audioUrl.replace(
      /^https:\/\/hearthis\.app\//i,
      'https://hearthis.at/'
    );
  }
  return track.audioUrl;
}

function getProxyAudioSrc(track: Track): string {
  if (track.audioUrl.startsWith('http://') || track.audioUrl.startsWith('https://')) {
    const normalized = getDirectAudioSrc(track);
    if (
      track.id.startsWith('gdrive-') ||
      track.id.startsWith('ytm-') ||
      track.id.startsWith('jamendo-') ||
      track.id.startsWith('audius-')
    ) {
      return `/audio/tracks/${encodeURIComponent(track.id)}.mp3?url=${encodeURIComponent(normalized)}`;
    }
    return `/api/stream-track.mp3?url=${encodeURIComponent(normalized)}&id=${encodeURIComponent(track.id)}`;
  }
  if (track.audioUrl.startsWith('/api/music/ytm-audio')) {
    return track.audioUrl.replace('/api/music/ytm-audio', '/api/ytm-track.mp3');
  }
  return track.audioUrl;
}

function getPlayableAudioSrc(track: Track): string {
  // Continuous live radio streams and hearthis.at CDN streams play directly over HTTPS in <audio>
  if (
    track.source === 'radio' ||
    track.id.startsWith('radio-') ||
    track.audioUrl.includes('hearthis.at/') ||
    track.audioUrl.includes('hearthis.app/')
  ) {
    return getDirectAudioSrc(track);
  }
  return getProxyAudioSrc(track);
}

function configureAudioElementForSrc(audio: HTMLAudioElement, _src: string): void {
  // Never set crossOrigin="anonymous" on <audio> so same-origin /audio/tracks/* and /api/* requests
  // include Partitioned session cookies, and fallback hearthis.at streams play in no-cors media mode.
  audio.removeAttribute('crossorigin');
}

function triggerAuthBridgeHandshakeOnce(): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }
  const now = Date.now();
  const lastTs = Number(sessionStorage.getItem('reytune_auth_refresh_ts') || '0');
  if (now - lastTs < 25000) {
    return false;
  }
  sessionStorage.setItem('reytune_auth_refresh_ts', String(now));
  const url = new URL(window.location.href);
  url.searchParams.set('__storage_access_granted', '1');
  window.location.replace(url.toString());
  return true;
}

function filterClientCatalogByGenre(genre: string): Track[] {
  const g = genre.trim().toLowerCase();
  if (!g || g === 'all') {
    return CATALOG_TRACKS;
  }
  if (g === 'ytmusic') {
    return YOUTUBE_MUSIC_AND_ONLINE_TRACKS;
  }
  if (g === 'drive') {
    return DRIVE_FOLDER_TRACKS;
  }
  if (
    g === 'jamendo' ||
    g === 'openverse' ||
    g === 'audius' ||
    g === 'hearthis' ||
    g === 'archive' ||
    g === 'radio'
  ) {
    return [];
  }
  if (g === 'trending') {
    const featuredDrive = DRIVE_FOLDER_TRACKS.filter(
      (t) =>
        t.featured ||
        /Tulus|Raim Laode|Nadhif|Juicy Luicy|Sal Priadi|Idgitaf|Judika|ROSÉ|Bruno Mars|The 1975|Rex Orange County|Hindia|Pamungkas/i.test(
          t.artist
        )
    );
    return [
      ...featuredDrive.slice(0, 15),
      ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS.slice(0, 25),
      ...featuredDrive.slice(15),
    ];
  }
  if (g === 'indonesia') {
    const indoDrive = DRIVE_FOLDER_TRACKS.filter(
      (t) =>
        t.genre.toLowerCase().includes('indo') ||
        /Tulus|Raim Laode|Nadhif|Juicy Luicy|Sal Priadi|Idgitaf|Judika|Armada|Fiersa|NOAH|Lyla|Bagindas|Ungu|Denny Caknan|Hindia|Pamungkas|Misellia|Keisya|Mahen|Rony Parulian|Samuel Cipta|Anggis Devaki|ILIR7|Hal|HAL|Amigdala|Samsons|Repvblik|Yovie|Tipe-X|Ebiet|Anji|Rizky Febian|Aldy Maldini|Kaleb|Mario G|Angga Candra|Piche Kota|Overnight|eńau|eńau/i.test(
          t.artist
        )
    );
    return [...indoDrive, ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS];
  }
  if (g === 'pop') {
    const popDrive = DRIVE_FOLDER_TRACKS.filter(
      (t) =>
        t.genre === 'Pop Indo' ||
        /Tulus|Juicy Luicy|Nadhif|Mahalini|Judika|Sal Priadi|Idgitaf|Rizky Febian|Keisya|Mahen|Rony Parulian|Armada|NOAH|Samsons|Repvblik|Yovie|Kaleb|Anggis Devaki|Misellia/i.test(
          t.artist
        )
    );
    return [...YOUTUBE_MUSIC_AND_ONLINE_TRACKS.slice(0, 30), ...popDrive];
  }
  if (g === 'barat') {
    return DRIVE_FOLDER_TRACKS.filter((t) => t.genre === 'Barat Hits');
  }
  if (g === 'viral') {
    const viralDrive = DRIVE_FOLDER_TRACKS.filter(
      (t) =>
        t.genre === 'Viral TikTok' ||
        /APT|Sesi Potret|Sailor Song|Kita Lewati Berdua|Jatuh Suka|Sedia Aku Sebelum Hujan|Kota Ini Tak Sama|Negoro Angin|The One That Got Away|Gata Only|Love Nwantiti|Somebody's Pleasure|Mary On A Cross|Angel Baby|Copines|Paro|Dandelions|People/i.test(
          t.title
        )
    );
    return [...viralDrive, ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS.slice(0, 20)];
  }
  if (g === 'chill' || g === 'lofi') {
    return [
      ...LOCAL_BUNDLED_TRACKS,
      ...CATALOG_TRACKS.filter(
        (t) =>
          t.genre === 'Chill' ||
          /Raim Laode|Nadhif|Tulus|Fiersa|Sal Priadi|Amigdala|Pamungkas|Rex Orange County|Lana Del Rey|Radiohead|yaeow|Kina|Payung Teduh|Fourtwnty|Nadin Amizah|Feby Putri|Hindia|Kunto Aji|Barasuara|Mocca|Hal|HAL/i.test(
            t.artist
          )
      ),
    ];
  }
  return CATALOG_TRACKS;
}

export default function App() {
  // Navigation & UI state
  const [activeNav, setActiveNav] = useState<NavTab>('explore');
  const [librarySubTab, setLibrarySubTab] = useState<LibraryTab>('downloads');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState('all');
  const [audiusGenre, setAudiusGenre] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState(DEFAULT_DRIVE_FOLDER_URL);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [fullPlayerTab, setFullPlayerTab] = useState<'player' | 'lyrics'>('player');
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
  const [iframeAuthBlocked, setIframeAuthBlocked] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [jamendoConfigured, setJamendoConfigured] = useState(true);
  const [jamendoError, setJamendoError] = useState<string | null>(null);

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
  const audioUnlockedRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const offlineBlobUrlsRef = useRef<Record<string, string>>({});
  const starterBlobInfoRef = useRef<{ trackId: string; blobUrl: string } | null>(null);
  const sessionStreamBlobOrderRef = useRef<string[]>([]);
  const inFlightPrefetchesRef = useRef<Record<string, Promise<string | null>>>({});
  const playRequestIdRef = useRef<number>(0);
  const activeRecoveryReqIdRef = useRef<number>(0);
  const activeTrackRef = useRef<Track | null>(CATALOG_TRACKS[0] ?? null);
  const isSwitchingTrackRef = useRef<boolean>(false);
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
    if (
      activeGenre === 'jamendo' ||
      activeGenre === 'openverse' ||
      activeGenre === 'audius' ||
      activeGenre === 'hearthis' ||
      activeGenre === 'archive' ||
      activeGenre === 'radio'
    ) {
      return onlineFeedTracks;
    }
    return onlineFeedTracks.length > 0
      ? onlineFeedTracks
      : filterClientCatalogByGenre(activeGenre);
  }, [
    activeGenre,
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

  // Hydrate downloaded tracks metadata & Blob URLs from IndexedDB on startup
  useEffect(() => {
    let active = true;
    getAllOfflineTrackRecords().then((records) => {
      if (!active || records.length === 0) return;
      const map: Record<string, Track> = {};
      const ids: string[] = [];
      for (const rec of records) {
        map[rec.id] = rec.track;
        ids.push(rec.id);
        if (rec.audioBlob && !offlineBlobUrlsRef.current[rec.id]) {
          offlineBlobUrlsRef.current[rec.id] = URL.createObjectURL(rec.audioBlob);
        }
      }
      setSavedTrackMap((prev) => ({ ...prev, ...map }));
      setDownloadedIdList((prev) => Array.from(new Set([...prev, ...ids])));
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch complete music feed (Audius + Jamendo/Openverse CC + Hearthis + Archive + Google Drive + YT Music + Radio)
  const fetchDiscoverFeed = useCallback(
    async (
      genre: string,
      folderOverride?: string,
      forceRefresh = false,
      audiusGenreOverride?: string
    ) => {
      if (isOfflineMode) return;
      setIsLoadingApi(true);
      const targetFolder = folderOverride ?? driveFolderUrl;
      const targetAudiusGenre = audiusGenreOverride ?? audiusGenre;
      try {
        const params = new URLSearchParams({
          genre,
          folder: targetFolder,
        });
        if (forceRefresh) params.set('refresh', '1');
        if (genre === 'audius' && targetAudiusGenre) {
          params.set('audiusGenre', targetAudiusGenre);
        }

        const res = await fetch(`/api/music/discover?${params.toString()}`, {
          credentials: 'include',
          signal: AbortSignal.timeout(12000),
        });
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (res.url.includes('__cookie_check') || contentType.includes('text/html')) {
          setIframeAuthBlocked(true);
          triggerAuthBridgeHandshakeOnce();
          throw new Error('Auth handshake required');
        }
        setIframeAuthBlocked(false);
        if (!res.ok) throw new Error('Discover request failed');
        const data = (await res.json()) as {
          tracks?: Track[];
          totalDriveTracks?: number;
          live?: boolean;
          driveError?: string;
          jamendoConfigured?: boolean;
          jamendoError?: string;
        };
        if (typeof data.jamendoConfigured === 'boolean') {
          setJamendoConfigured(data.jamendoConfigured);
        }
        setJamendoError(data.jamendoError || null);
        setDriveError(data.driveError || null);
        if (forceRefresh && data.driveError) {
          showToast(data.driveError, 'warning');
        }
        if (
          genre === 'jamendo' ||
          genre === 'openverse' ||
          genre === 'audius' ||
          genre === 'hearthis' ||
          genre === 'archive' ||
          genre === 'radio' ||
          genre === 'drive'
        ) {
          setOnlineFeedTracks(Array.isArray(data.tracks) ? data.tracks : []);
          setIsLiveApi(Boolean(data.live));
          if (forceRefresh && !data.driveError && genre === 'drive') {
            showToast(
              `Berhasil memuat ${data.tracks?.length ?? 0} lagu Google Drive`,
              'success'
            );
          }
        } else if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          setOnlineFeedTracks(data.tracks);
          setIsLiveApi(Boolean(data.live));
          if (forceRefresh && !data.driveError) {
            const driveCount = data.totalDriveTracks ?? data.tracks.length;
            showToast(
              `Disinkronkan ${driveCount} lagu berhasil`,
              'success'
            );
          }
        } else {
          setIsLiveApi(false);
        }
      } catch {
        setIsLiveApi(false);
        if (forceRefresh) {
          showToast('Gagal memuat feed musik. Coba lagi.', 'warning');
        }
      } finally {
        setIsLoadingApi(false);
      }
    },
    [audiusGenre, driveFolderUrl, isOfflineMode, showToast]
  );

  const handleSyncDriveFolder = useCallback(
    (folderUrl: string) => {
      setDriveFolderUrl(folderUrl);
      setActiveGenre('drive');
      setDriveError(null);
      void fetchDiscoverFeed('drive', folderUrl, true);
    },
    [fetchDiscoverFeed]
  );

  useEffect(() => {
    if (!isOfflineMode) {
      void fetchDiscoverFeed(activeGenre);
    }
  }, [activeGenre, audiusGenre, fetchDiscoverFeed, isOfflineMode]);

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
          { credentials: 'include', signal: AbortSignal.timeout(7000) }
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

  // Revoke ObjectURLs on unmount
  useEffect(() => {
    const blobMap = offlineBlobUrlsRef.current;
    return () => {
      for (const url of Object.values(blobMap)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // Synchronously unlock mobile Web Audio & HTMLAudioElement inside user gesture
  const unlockAudioPlaybackSync = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume().catch(() => undefined);
        }
      }
    } catch {
      // Ignore AudioContext init issues on restricted browsers
    }

    const audio = audioRef.current;
    if (!audio || audioUnlockedRef.current) return;
    if (!audio.src || audio.paused) {
      isSwitchingTrackRef.current = true;
      audio.muted = false;
      audio.volume = 1;
      audio.src = SILENT_WAV_DATA_URI;
      const unlockPromise = audio.play();
      if (unlockPromise !== undefined) {
        unlockPromise
          .then(() => {
            audioUnlockedRef.current = true;
            if (audio.src === SILENT_WAV_DATA_URI) {
              isSwitchingTrackRef.current = false;
            }
          })
          .catch(() => {
            if (audio.src === SILENT_WAV_DATA_URI) {
              isSwitchingTrackRef.current = false;
            }
          });
      } else {
        audioUnlockedRef.current = true;
        isSwitchingTrackRef.current = false;
      }
    }
  }, []);

  // Unlock <audio> on the user's very first touch/tap anywhere so async Drive blob URLs always play cleanly
  useEffect(() => {
    const handleFirstGesture = () => {
      const audio = audioRef.current;
      if (!audioUnlockedRef.current && audio && !audio.src) {
        unlockAudioPlaybackSync();
      }
    };
    window.addEventListener('touchstart', handleFirstGesture, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleFirstGesture, { capture: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', handleFirstGesture, true);
      window.removeEventListener('pointerdown', handleFirstGesture, true);
    };
  }, [unlockAudioPlaybackSync]);

  // Store ephemeral streamed Blob URL with bounded LRU eviction (preserves offline-saved tracks)
  const storeSessionBlobUrl = useCallback(
    (trackId: string, blobUrl: string) => {
      const prev = offlineBlobUrlsRef.current[trackId];
      if (prev && prev !== blobUrl) {
        URL.revokeObjectURL(prev);
      }
      offlineBlobUrlsRef.current[trackId] = blobUrl;

      if (!downloadedIds.has(trackId)) {
        const order = sessionStreamBlobOrderRef.current.filter((id) => id !== trackId);
        order.push(trackId);
        while (order.length > 12) {
          const oldestId = order.shift();
          if (
            oldestId &&
            !downloadedIds.has(oldestId) &&
            activeTrackRef.current?.id !== oldestId &&
            offlineBlobUrlsRef.current[oldestId]
          ) {
            URL.revokeObjectURL(offlineBlobUrlsRef.current[oldestId]);
            delete offlineBlobUrlsRef.current[oldestId];
          }
        }
        sessionStreamBlobOrderRef.current = order;
      }
    },
    [downloadedIds]
  );

  // Synchronous audio source resolver so mobile browsers never lose user-gesture activation
  const getAudioSourceSync = useCallback((track: Track): string => {
    const cachedBlobUrl = offlineBlobUrlsRef.current[track.id];
    if (cachedBlobUrl) {
      return cachedBlobUrl;
    }
    return getPlayableAudioSrc(track);
  }, []);

  // Background pre-fetcher: warms full Drive/YTM audio into Blob URLs on startup & pointerdown
  const prefetchTrackAudio = useCallback(
    async (track: Track): Promise<string | null> => {
      if (isOfflineMode) return offlineBlobUrlsRef.current[track.id] ?? null;
      if (offlineBlobUrlsRef.current[track.id]) {
        return offlineBlobUrlsRef.current[track.id];
      }
      const existingPromise = inFlightPrefetchesRef.current[track.id];
      if (existingPromise) {
        return existingPromise;
      }
      if (
        track.drivePreviewOnly ||
        track.source === 'radio' ||
        track.id.startsWith('radio-')
      ) {
        return null;
      }
      if (
        !track.id.startsWith('gdrive-') &&
        !track.id.startsWith('ytm-') &&
        !track.id.startsWith('jamendo-') &&
        !track.id.startsWith('openverse-') &&
        !track.id.startsWith('hearthis-') &&
        !track.id.startsWith('archive-') &&
        !track.id.startsWith('github-') &&
        !track.id.startsWith('audius-') &&
        !track.id.startsWith('itunes-') &&
        !track.audioUrl.startsWith('/audio/')
      ) {
        return null;
      }

      const task = (async (): Promise<string | null> => {
        try {
          const proxyUrl = getProxyAudioSrc(track);
          const res = await fetch(proxyUrl, { credentials: 'include' });
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (res.url.includes('__cookie_check') || ct.includes('text/html')) {
            setIframeAuthBlocked(true);
            return null;
          }
          if (!res.ok) return null;
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 4096) return null;
          const mime = ct.startsWith('audio/') ? ct.split(';')[0] : 'audio/mpeg';
          if (!offlineBlobUrlsRef.current[track.id]) {
            const url = URL.createObjectURL(new Blob([buf], { type: mime }));
            storeSessionBlobUrl(track.id, url);
          }
          setIframeAuthBlocked(false);
          return offlineBlobUrlsRef.current[track.id];
        } catch {
          return null;
        } finally {
          delete inFlightPrefetchesRef.current[track.id];
        }
      })();

      inFlightPrefetchesRef.current[track.id] = task;
      return task;
    },
    [isOfflineMode, storeSessionBlobUrl]
  );

  // Sequentially prefetch the top 3 Google Drive tracks so the first tap plays in 0ms
  useEffect(() => {
    if (isOfflineMode || onlineFeedTracks.length === 0) return;
    let cancelled = false;
    const topDrive = onlineFeedTracks
      .filter((t) => t.id.startsWith('gdrive-') && !offlineBlobUrlsRef.current[t.id])
      .slice(0, 3);
    if (topDrive.length === 0) return;

    void (async () => {
      for (const track of topDrive) {
        if (cancelled) break;
        await prefetchTrackAudio(track);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOfflineMode, onlineFeedTracks, prefetchTrackAudio]);

  // Fast recovery via progressive 1MB Range starter -> Blob URL (for cookie-restricted mobile iframes)
  const recoverPlaybackViaFetch = useCallback(
    async (track: Track, reqId: number) => {
      const audio = audioRef.current;
      if (!audio || playRequestIdRef.current !== reqId) return;
      if (activeRecoveryReqIdRef.current === reqId) return;
      activeRecoveryReqIdRef.current = reqId;

      const directUrl = getDirectAudioSrc(track);
      const proxyUrl = getProxyAudioSrc(track);
      const fallbackApiUrl =
        track.audioUrl.startsWith('http://') || track.audioUrl.startsWith('https://')
          ? `/api/stream-track.mp3?url=${encodeURIComponent(directUrl)}&id=${encodeURIComponent(track.id)}`
          : proxyUrl;

      // Infinite live radio streams cannot be downloaded into an ArrayBuffer
      if (track.source === 'radio' || track.id.startsWith('radio-')) {
        try {
          isSwitchingTrackRef.current = true;
          configureAudioElementForSrc(audio, fallbackApiUrl);
          audio.src = fallbackApiUrl;
          await audio.play();
          if (playRequestIdRef.current === reqId) {
            audioUnlockedRef.current = true;
            isSwitchingTrackRef.current = false;
            setIsPlaying(true);
          }
        } catch {
          if (playRequestIdRef.current === reqId) {
            isSwitchingTrackRef.current = false;
            setIsPlaying(false);
            showToast(`Gagal memutar stasiun radio "${track.title}".`, 'warning');
          }
        }
        return;
      }

      try {
        // 1. If full track is already cached or currently prefetching, use it directly
        if (offlineBlobUrlsRef.current[track.id]) {
          const cachedUrl = offlineBlobUrlsRef.current[track.id];
          isSwitchingTrackRef.current = true;
          audio.muted = false;
          audio.volume = 1;
          configureAudioElementForSrc(audio, cachedUrl);
          audio.src = cachedUrl;
          await audio.play();
          if (playRequestIdRef.current === reqId) {
            audioUnlockedRef.current = true;
            isSwitchingTrackRef.current = false;
            setIsPlaying(true);
          }
          return;
        }

        const inFlight = inFlightPrefetchesRef.current[track.id];
        if (inFlight) {
          const prefetchedUrl = await inFlight;
          if (playRequestIdRef.current !== reqId) return;
          if (prefetchedUrl) {
            isSwitchingTrackRef.current = true;
            audio.muted = false;
            audio.volume = 1;
            configureAudioElementForSrc(audio, prefetchedUrl);
            audio.src = prefetchedUrl;
            const p = audio.play();
            if (p !== undefined) {
              await p;
            }
            if (playRequestIdRef.current === reqId) {
              audioUnlockedRef.current = true;
              isSwitchingTrackRef.current = false;
              setIsPlaying(true);
            }
            return;
          }
        }

        // 2. Fetch fast initial 1MB Range slice so audio starts in <0.5s instead of waiting for full MP3
        const rangeHeaders = { Range: 'bytes=0-1048575' };
        let res = await fetch(proxyUrl, {
          credentials: 'include',
          headers: rangeHeaders,
        }).catch(() => null);

        const firstCt = (res?.headers.get('content-type') || '').toLowerCase();
        if (
          fallbackApiUrl !== proxyUrl &&
          (!res || !res.ok || res.url.includes('__cookie_check') || firstCt.includes('text/html'))
        ) {
          res = await fetch(fallbackApiUrl, {
            credentials: 'include',
            headers: rangeHeaders,
          }).catch(() => null);
        }

        const ct = (res?.headers.get('content-type') || '').toLowerCase();
        if (
          !res ||
          (!res.ok && res.status !== 206) ||
          res.url.includes('__cookie_check') ||
          ct.includes('text/html')
        ) {
          if (directUrl.includes('hearthis.at/')) {
            if (playRequestIdRef.current !== reqId) return;
            isSwitchingTrackRef.current = true;
            configureAudioElementForSrc(audio, directUrl);
            audio.src = directUrl;
            await audio.play();
            if (playRequestIdRef.current === reqId) {
              audioUnlockedRef.current = true;
              isSwitchingTrackRef.current = false;
              setIsPlaying(true);
            }
            return;
          }
          if (res?.url.includes('__cookie_check') || ct.includes('text/html')) {
            setIframeAuthBlocked(true);
            triggerAuthBridgeHandshakeOnce();
          }
          throw new Error(`HTTP ${res?.status ?? 0}`);
        }

        const buf = await res.arrayBuffer();
        if (playRequestIdRef.current !== reqId || buf.byteLength < 1024) {
          return;
        }

        const mime = ct.startsWith('audio/') ? ct.split(';')[0] : 'audio/mpeg';
        const blob = new Blob([buf], { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        const contentRange = res.headers.get('content-range') || '';
        const rangeTotalMatch = /bytes \d+-\d+\/(\d+)/i.exec(contentRange);
        const totalExpectedBytes = rangeTotalMatch ? Number(rangeTotalMatch[1]) : 0;
        const isPartialStarter =
          res.status === 206 &&
          totalExpectedBytes > 0 &&
          buf.byteLength < totalExpectedBytes;

        if (isPartialStarter) {
          if (
            starterBlobInfoRef.current &&
            starterBlobInfoRef.current.blobUrl !== blobUrl
          ) {
            URL.revokeObjectURL(starterBlobInfoRef.current.blobUrl);
          }
          starterBlobInfoRef.current = { trackId: track.id, blobUrl };
          // Download complete MP3 in background while starter plays
          void prefetchTrackAudio(track);
        } else {
          if (starterBlobInfoRef.current?.trackId === track.id) {
            URL.revokeObjectURL(starterBlobInfoRef.current.blobUrl);
            starterBlobInfoRef.current = null;
          }
          storeSessionBlobUrl(track.id, blobUrl);
        }

        setIframeAuthBlocked(false);

        if (playRequestIdRef.current !== reqId) return;
        isSwitchingTrackRef.current = true;
        audio.muted = false;
        audio.volume = 1;
        configureAudioElementForSrc(audio, blobUrl);
        audio.src = blobUrl;

        try {
          const p = audio.play();
          if (p !== undefined) {
            await p;
          }
          if (playRequestIdRef.current === reqId) {
            audioUnlockedRef.current = true;
            isSwitchingTrackRef.current = false;
            setIsPlaying(true);
          }
        } catch (playErr: unknown) {
          if (playRequestIdRef.current !== reqId) return;
          const errName = playErr instanceof Error ? playErr.name : '';
          if (errName === 'AbortError') return;
          isSwitchingTrackRef.current = false;
          setIsPlaying(false);
          if (errName === 'NotAllowedError') {
            showToast(
              `Lagu "${track.title}" siap. Ketuk sekali lagi untuk memutar.`,
              'info'
            );
          } else {
            showToast(`Gagal memutar "${track.title}". Coba ketuk lagi.`, 'warning');
          }
          return;
        }
      } catch {
        if (playRequestIdRef.current !== reqId) return;
        isSwitchingTrackRef.current = false;
        setIsPlaying(false);
        showToast(
          `Gagal memuat stream "${track.title}". Jika di HP, coba tombol "Buka Tab" di atas.`,
          'warning'
        );
      }
    },
    [prefetchTrackAudio, showToast, storeSessionBlobUrl]
  );

  // Start playback synchronously within the user tap event so progressive HTTP 206 streaming starts immediately
  const triggerSyncPlayback = useCallback(
    (track: Track) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (track.drivePreviewOnly && track.driveFileId) {
        playRequestIdRef.current += 1;
        isSwitchingTrackRef.current = false;
        audio.pause();
        setIsPlaying(false);
        setFullPlayerTab('player');
        setIsFullPlayerOpen(true);
        showToast(
          'Membuka pemutar sesi browser Google Drive untuk file Private ini.',
          'info'
        );
        return;
      }

      activeTrackRef.current = track;
      const reqId = ++playRequestIdRef.current;
      const cachedBlobUrl = offlineBlobUrlsRef.current[track.id];

      if (cachedBlobUrl) {
        isSwitchingTrackRef.current = true;
        audio.muted = false;
        audio.volume = 1;
        configureAudioElementForSrc(audio, cachedBlobUrl);
        audio.src = cachedBlobUrl;
        audio.load();
        setIsPlaying(true);

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (playRequestIdRef.current === reqId) {
                audioUnlockedRef.current = true;
                isSwitchingTrackRef.current = false;
                setIsPlaying(true);
              }
            })
            .catch((err: unknown) => {
              if (playRequestIdRef.current !== reqId) return;
              const errName = err instanceof Error ? err.name : '';
              if (errName === 'AbortError') return;
              isSwitchingTrackRef.current = false;
              setIsPlaying(false);
              showToast(`Ketuk Play lagi untuk "${track.title}".`, 'info');
            });
        } else {
          audioUnlockedRef.current = true;
          isSwitchingTrackRef.current = false;
        }
        return;
      }

      const targetSrc = getAudioSourceSync(track);
      isSwitchingTrackRef.current = true;
      audio.muted = false;
      audio.volume = 1;
      configureAudioElementForSrc(audio, targetSrc);
      audio.src = targetSrc;
      audio.load();
      setIsPlaying(true);

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (playRequestIdRef.current === reqId) {
              audioUnlockedRef.current = true;
              isSwitchingTrackRef.current = false;
              setIsPlaying(true);
            }
          })
          .catch((err: unknown) => {
            if (playRequestIdRef.current !== reqId) return;
            const errName = err instanceof Error ? err.name : '';
            if (errName === 'AbortError') return;
            // Fallback to progressive Range-starter fetch -> Blob (handles mobile iframe cookie blocks)
            if (!audioUnlockedRef.current) {
              unlockAudioPlaybackSync();
            }
            void recoverPlaybackViaFetch(track, reqId);
          });
      } else {
        audioUnlockedRef.current = true;
        isSwitchingTrackRef.current = false;
      }
    },
    [getAudioSourceSync, recoverPlaybackViaFetch, showToast, unlockAudioPlaybackSync]
  );

  // Offline auto-fallback when switching to offline mode
  useEffect(() => {
    if (!isOfflineMode || !currentTrackId) return;
    if (!downloadedIds.has(currentTrackId)) {
      const firstOffline = knownTracks.find((t) => downloadedIds.has(t.id));
      if (firstOffline) {
        setCurrentTrackId(firstOffline.id);
        setCurrentTime(0);
        setDuration(firstOffline.durationSec);
        if (audioRef.current) {
          isSwitchingTrackRef.current = false;
          audioRef.current.pause();
          const offlineSrc = getAudioSourceSync(firstOffline);
          configureAudioElementForSrc(audioRef.current, offlineSrc);
          audioRef.current.src = offlineSrc;
        }
        setIsPlaying(false);
        showToast(`Switched to offline track: ${firstOffline.title}`, 'info');
      } else {
        if (audioRef.current) {
          isSwitchingTrackRef.current = false;
          audioRef.current.pause();
        }
        setIsPlaying(false);
      }
    }
  }, [
    currentTrackId,
    downloadedIds,
    getAudioSourceSync,
    isOfflineMode,
    knownTracks,
    showToast,
  ]);

  const handlePlayTrack = useCallback(
    (track: Track, queueOverride?: Track[]) => {
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

      if (track.drivePreviewOnly && track.driveFileId) {
        setCurrentTrackId(track.id);
        setCurrentTime(0);
        setDuration(track.durationSec);
        triggerSyncPlayback(track);
        return;
      }

      if (currentTrackId === track.id) {
        if (isPlaying) {
          playRequestIdRef.current += 1;
          isSwitchingTrackRef.current = false;
          audio.pause();
          setIsPlaying(false);
        } else {
          if (!audio.src || audio.src === SILENT_WAV_DATA_URI || audio.error) {
            triggerSyncPlayback(track);
          } else {
            const reqId = ++playRequestIdRef.current;
            isSwitchingTrackRef.current = true;
            setIsPlaying(true);
            const p = audio.play();
            if (p !== undefined) {
              p.then(() => {
                if (playRequestIdRef.current === reqId) {
                  isSwitchingTrackRef.current = false;
                }
              }).catch((err: unknown) => {
                if (playRequestIdRef.current !== reqId) return;
                const errName = err instanceof Error ? err.name : '';
                if (errName === 'AbortError') return;
                triggerSyncPlayback(track);
              });
            }
          }
        }
        return;
      }

      setCurrentTrackId(track.id);
      setCurrentTime(0);
      setDuration(track.durationSec);
      triggerSyncPlayback(track);
    },
    [
      currentTrackId,
      downloadedIds,
      exploreTracks,
      isOfflineMode,
      isPlaying,
      knownTracks,
      showToast,
      triggerSyncPlayback,
    ]
  );

  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const check = canPlayTrack(currentTrack.id, isOfflineMode, downloadedIds);
    if (!check.allowed) {
      showToast(check.reason ?? 'Track unavailable offline', 'warning');
      return;
    }

    if (isPlaying) {
      playRequestIdRef.current += 1;
      isSwitchingTrackRef.current = false;
      audio.pause();
      setIsPlaying(false);
    } else {
      if (!audio.src || audio.src === SILENT_WAV_DATA_URI || audio.error) {
        triggerSyncPlayback(currentTrack);
      } else {
        const reqId = ++playRequestIdRef.current;
        isSwitchingTrackRef.current = true;
        setIsPlaying(true);
        const p = audio.play();
        if (p !== undefined) {
          p.then(() => {
            if (playRequestIdRef.current === reqId) {
              isSwitchingTrackRef.current = false;
            }
          }).catch((err: unknown) => {
            if (playRequestIdRef.current !== reqId) return;
            const errName = err instanceof Error ? err.name : '';
            if (errName === 'AbortError') return;
            triggerSyncPlayback(currentTrack);
          });
        }
      }
    }
  }, [
    currentTrack,
    downloadedIds,
    isOfflineMode,
    isPlaying,
    showToast,
    triggerSyncPlayback,
  ]);

  const handleStepTrack = useCallback(
    (direction: 'next' | 'prev') => {
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
        playRequestIdRef.current += 1;
        isSwitchingTrackRef.current = false;
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

      setCurrentTrackId(nextTrack.id);
      setCurrentTime(0);
      setDuration(nextTrack.durationSec);
      triggerSyncPlayback(nextTrack);
    },
    [
      currentTrackId,
      downloadedIds,
      isOfflineMode,
      queue,
      repeatMode,
      shuffle,
      showToast,
      triggerSyncPlayback,
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
        // If currently playing a starter partial blob and the full track blob is ready, swap seamlessly on seek
        if (
          currentTrack &&
          offlineBlobUrlsRef.current[currentTrack.id] &&
          audio.src !== offlineBlobUrlsRef.current[currentTrack.id]
        ) {
          isSwitchingTrackRef.current = true;
          if (starterBlobInfoRef.current?.trackId === currentTrack.id) {
            URL.revokeObjectURL(starterBlobInfoRef.current.blobUrl);
            starterBlobInfoRef.current = null;
          }
          configureAudioElementForSrc(audio, offlineBlobUrlsRef.current[currentTrack.id]);
          audio.src = offlineBlobUrlsRef.current[currentTrack.id];
          audio.currentTime = clampedTime;
          void audio.play().finally(() => {
            isSwitchingTrackRef.current = false;
          });
          updateMediaSessionPosition();
          return;
        }
        audio.currentTime = clampedTime;
        updateMediaSessionPosition();
      }
    },
    [currentTrack, updateMediaSessionPosition]
  );

  // Wire HTML5 audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const upgradeStarterToFullBlob = async (resumeAt: number): Promise<boolean> => {
      const starter = starterBlobInfoRef.current;
      if (!starter || starter.trackId !== currentTrack?.id) return false;
      if (audio.src !== starter.blobUrl) return false;
      let fullUrl: string | undefined = offlineBlobUrlsRef.current[starter.trackId];
      const pendingFetch: Promise<string | null> | undefined =
        inFlightPrefetchesRef.current[starter.trackId];
      if (!fullUrl && pendingFetch) {
        fullUrl = (await pendingFetch) ?? '';
      }
      if (!fullUrl || activeTrackRef.current?.id !== starter.trackId) return false;

      isSwitchingTrackRef.current = true;
      configureAudioElementForSrc(audio, fullUrl);
      audio.src = fullUrl;
      audio.currentTime = Math.max(0, resumeAt);
      URL.revokeObjectURL(starter.blobUrl);
      starterBlobInfoRef.current = null;
      try {
        await audio.play();
        isSwitchingTrackRef.current = false;
        return true;
      } catch {
        isSwitchingTrackRef.current = false;
        return false;
      }
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      updateMediaSessionPosition();
      const starter = starterBlobInfoRef.current;
      if (
        starter &&
        starter.trackId === currentTrack?.id &&
        audio.src === starter.blobUrl &&
        offlineBlobUrlsRef.current[starter.trackId] &&
        audio.buffered.length > 0
      ) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        if (bufferedEnd > 5 && audio.currentTime >= bufferedEnd - 2) {
          void upgradeStarterToFullBlob(audio.currentTime);
        }
      }
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
      // Do not mark playing during the 1-sample silent gesture unlock
      if (audio.src === SILENT_WAV_DATA_URI) return;
      setIsPlaying(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      updateMediaSessionPosition();
    };
    const onPlaying = () => {
      if (audio.src === SILENT_WAV_DATA_URI) return;
      isSwitchingTrackRef.current = false;
      setIsPlaying(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      updateMediaSessionPosition();
    };
    const onPause = () => {
      // Ignore transient pause events emitted when switching audio.src or unlocking audio
      if (isSwitchingTrackRef.current || audio.src === SILENT_WAV_DATA_URI) return;
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      updateMediaSessionPosition();
    };
    const onError = () => {
      if (audio.src === SILENT_WAV_DATA_URI) return;
      const targetTrack = activeTrackRef.current || currentTrack;
      if (targetTrack && playRequestIdRef.current > 0) {
        void recoverPlaybackViaFetch(targetTrack, playRequestIdRef.current);
      }
    };
    const onEnded = () => {
      // Ignore silent gesture unlock completion
      if (audio.src === SILENT_WAV_DATA_URI) return;

      const starter = starterBlobInfoRef.current;
      if (
        starter &&
        starter.trackId === currentTrack?.id &&
        audio.src === starter.blobUrl
      ) {
        const resumeAt = audio.currentTime;
        void upgradeStarterToFullBlob(resumeAt).then((upgraded) => {
          if (!upgraded) {
            isSwitchingTrackRef.current = false;
            void handleStepTrack('next');
          }
        });
        return;
      }

      isSwitchingTrackRef.current = false;
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
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
    };
  }, [
    currentTrack,
    handleStepTrack,
    isPlaying,
    recoverPlaybackViaFetch,
    repeatMode,
    updateMediaSessionPosition,
  ]);

  // Pre-warm the next track in queue while current song plays for gapless continuous Drive streaming
  useEffect(() => {
    if (isOfflineMode || !isPlaying || !currentTrackId || queue.length <= 1) return;
    const currentIdx = queue.findIndex((t) => t.id === currentTrackId);
    const nextIdx = getNextTrackIndex({
      currentIndex: currentIdx >= 0 ? currentIdx : 0,
      queueLength: queue.length,
      repeatMode: repeatMode === 'one' ? 'all' : repeatMode,
      shuffle,
      direction: 'next',
    });
    if (nextIdx === null) return;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || offlineBlobUrlsRef.current[nextTrack.id]) return;

    const timer = window.setTimeout(() => {
      void prefetchTrackAudio(nextTrack);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [currentTrackId, isOfflineMode, isPlaying, prefetchTrackAudio, queue, repeatMode, shuffle]);

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

  // Helper: stream audio bytes with real-time progress and persist into IndexedDB offline storage
  const fetchAndCacheTrackBlob = useCallback(
    async (track: Track): Promise<Blob> => {
      setDownloadProgressMap((prev) => ({ ...prev, [track.id]: 5 }));

      try {
        const proxyUrl = getProxyAudioSrc(track);
        const res = await fetch(proxyUrl, { credentials: 'include' });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || ct.includes('text/html')) {
          throw new Error(`HTTP ${res.status}`);
        }

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
                const pct = Math.min(
                  98,
                  Math.max(5, Math.round((received / contentLength) * 100))
                );
                setDownloadProgressMap((prev) => ({ ...prev, [track.id]: pct }));
              } else {
                fallbackPct = Math.min(95, fallbackPct + 7);
                setDownloadProgressMap((prev) => ({ ...prev, [track.id]: fallbackPct }));
              }
            }
          }
          const mime = ct.startsWith('audio/') ? ct.split(';')[0] : 'audio/mpeg';
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

        if (blob.size < 4096) {
          throw new Error('Audio payload too small');
        }

        setDownloadProgressMap((prev) => ({ ...prev, [track.id]: 100 }));

        const record = await saveOfflineTrackBlob(track, blob);
        await cacheTrackAudioOffline(proxyUrl);
        if (offlineBlobUrlsRef.current[track.id]) {
          URL.revokeObjectURL(offlineBlobUrlsRef.current[track.id]);
        }
        offlineBlobUrlsRef.current[track.id] = URL.createObjectURL(blob);

        setSavedTrackMap((prev) => ({ ...prev, [track.id]: record.track }));
        setDownloadedIdList((prev) =>
          prev.includes(track.id) ? prev : [...prev, track.id]
        );
        return blob;
      } finally {
        setDownloadProgressMap((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      }
    },
    []
  );

  // Real byte-streaming download into IndexedDB + Cache API (offline library)
  const handleDownloadTrack = useCallback(
    async (track: Track) => {
      if (isOfflineMode) {
        showToast('Aktifkan Mode Online untuk mengunduh lagu', 'warning');
        return;
      }
      if (track.source === 'radio' || track.id.startsWith('radio-')) {
        showToast('Siaran radio live tidak bisa diunduh sebagai file MP3.', 'info');
        return;
      }
      if (track.drivePreviewOnly) {
        showToast(
          'File Drive ini masih Private. Ubah berbagi ke "Siapa saja yang memiliki link" agar bisa disimpan offline.',
          'warning'
        );
        return;
      }
      if (downloadedIds.has(track.id) || downloadProgressMap[track.id] !== undefined) {
        return;
      }

      try {
        await fetchAndCacheTrackBlob(track);
        showToast(`"${track.title}" tersimpan untuk putar offline`, 'success');
      } catch {
        showToast(`Gagal mengunduh "${track.title}". Coba lagi.`, 'warning');
      }
    },
    [downloadProgressMap, downloadedIds, fetchAndCacheTrackBlob, isOfflineMode, showToast]
  );

  // Direct device MP3 file download (.mp3) with live progress + automatic offline caching
  const handleSaveFileToDevice = useCallback(
    async (track: Track) => {
      if (track.source === 'radio' || track.id.startsWith('radio-')) {
        showToast('Siaran radio live tidak bisa diunduh sebagai file MP3.', 'info');
        return;
      }
      if (track.drivePreviewOnly) {
        showToast(
          'File Drive ini masih Private. Ubah izin berbagi Drive ke publik untuk mengunduh MP3.',
          'warning'
        );
        return;
      }
      if (downloadProgressMap[track.id] !== undefined) {
        return;
      }

      const filename = sanitizeDownloadFilename(track.title, track.artist);
      const triggerBlobDownload = (blob: Blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      };

      try {
        // 1. Instant export if already saved offline in IndexedDB
        const offlineRec = await getOfflineTrackRecord(track.id);
        if (offlineRec?.audioBlob && offlineRec.audioBlob.size >= 4096) {
          triggerBlobDownload(offlineRec.audioBlob);
          showToast(`Mengunduh "${filename}"`, 'success');
          return;
        }

        if (isOfflineMode) {
          showToast('Aktifkan Mode Online untuk mengunduh lagu ini', 'warning');
          return;
        }

        // 2. Stream via same-origin proxy with progress, save offline AND export .mp3 to device
        showToast(`Mengunduh "${track.title}"...`, 'info');
        const blob = await fetchAndCacheTrackBlob(track);
        triggerBlobDownload(blob);
        showToast(`Berhasil download "${filename}"`, 'success');
      } catch {
        // 3. Fallback to same-origin attachment route (never raw cross-origin URLs)
        try {
          const proxyBase = getProxyAudioSrc(track);
          const sep = proxyBase.includes('?') ? '&' : '?';
          const fallbackDownloadUrl = `${proxyBase}${sep}download=1&title=${encodeURIComponent(
            track.title
          )}&artist=${encodeURIComponent(track.artist)}`;
          const a = document.createElement('a');
          a.href = fallbackDownloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast(`Memulai download "${filename}"`, 'info');
        } catch {
          showToast(`Gagal mengunduh "${track.title}"`, 'warning');
        }
      }
    },
    [downloadProgressMap, fetchAndCacheTrackBlob, isOfflineMode, showToast]
  );

  // Import local MP3 / audio files directly from user's mobile phone or laptop
  const handleImportLocalFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const importedTracks: Track[] = [];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const rawName = file.name.replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i, '').trim();
        let artist = 'File Musik HP';
        let title = rawName || `Lagu Lokal ${i + 1}`;
        if (rawName.includes(' - ')) {
          const parts = rawName.split(' - ');
          artist = parts[0].trim() || 'File Musik HP';
          title = parts.slice(1).join(' - ').trim() || rawName;
        }
        const trackId = `local-device-${Date.now()}-${i}`;
        const blobUrl = URL.createObjectURL(file);
        offlineBlobUrlsRef.current[trackId] = blobUrl;

        const sizeMb = Math.max(0.5, Math.round((file.size / (1024 * 1024)) * 10) / 10);
        const estimatedDuration = Math.max(120, Math.round((file.size * 8) / 128000));

        const newTrack: Track = {
          id: trackId,
          title,
          artist,
          album: 'Memori Perangkat (Offline)',
          genre: 'Lagu Indo',
          durationSec: estimatedDuration,
          fileSizeMb: sizeMb,
          coverUrl:
            'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
          audioUrl: blobUrl,
          source: 'local',
          isPreview: false,
          featured: true,
        };

        await saveOfflineTrackBlob(newTrack, file);
        importedTracks.push(newTrack);
      }

      if (importedTracks.length > 0) {
        const newMap: Record<string, Track> = {};
        const newIds: string[] = [];
        for (const t of importedTracks) {
          newMap[t.id] = t;
          newIds.push(t.id);
        }
        setSavedTrackMap((prev) => ({ ...newMap, ...prev }));
        setDownloadedIdList((prev) => Array.from(new Set([...newIds, ...prev])));
        setOnlineFeedTracks((prev) => [...importedTracks, ...prev]);

        const first = importedTracks[0];
        setCurrentTrackId(first.id);
        setCurrentTime(0);
        setDuration(first.durationSec);
        triggerSyncPlayback(first);
        showToast(
          `Berhasil memuat & memutar "${first.title}" dari perangkat`,
          'success'
        );
      }
    },
    [showToast, triggerSyncPlayback]
  );

  const handleDeleteDownload = useCallback(
    (track: Track) => {
      if (offlineBlobUrlsRef.current[track.id]) {
        URL.revokeObjectURL(offlineBlobUrlsRef.current[track.id]);
        delete offlineBlobUrlsRef.current[track.id];
      }
      setDownloadedIdList((prev) => prev.filter((id) => id !== track.id));
      void deleteOfflineTrackRecord(track.id);
      void removeCachedTrackAudio(getPlayableAudioSrc(track));
      showToast(`Removed "${track.title}" from offline storage`, 'info');
    },
    [showToast]
  );

  const handleClearAllDownloads = useCallback(() => {
    for (const url of Object.values(offlineBlobUrlsRef.current)) {
      URL.revokeObjectURL(url);
    }
    offlineBlobUrlsRef.current = {};
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

      {/* Centered Mobile-First Shell with Live Playing Song Photo Background & Dynamic Glass */}
      <div className="max-w-md mx-auto min-h-screen relative flex flex-col bg-[#0B0F17] sm:border-x sm:border-white/[0.1] overflow-x-clip">
        {/* Live Song Cover Photo as the App Background behind Dynamic Glass Surfaces */}
        <TrackPhotoBackground
          coverUrl={currentTrack?.coverUrl ?? featuredTrack?.coverUrl}
          trackId={currentTrack?.id ?? featuredTrack?.id}
          title={currentTrack?.title ?? featuredTrack?.title}
          isPlaying={isPlaying}
          variant="shell"
        />

        {/* Top Bar with ReyTune Branding, Install PWA Trigger & Online/Offline Switch (Dynamic Glass Header) */}
        <header className="sticky top-0 z-30 dynamic-glass-header px-4 pt-[max(0.35rem,env(safe-area-inset-top,0px))] pb-1.5 min-h-[60px] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/icon.svg"
              alt="ReyTune logo"
              className="w-7 h-7 rounded-lg shrink-0 ring-1 ring-white/15 shadow-sm"
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
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl dynamic-glass-button text-[#10B981] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
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
              className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                isOfflineMode
                  ? 'bg-[#10B981]/15 border border-[#10B981]/45 text-[#10B981] backdrop-blur-md'
                  : 'dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC]'
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
                  isOfflineMode ? 'bg-[#10B981]' : 'bg-white/20'
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
        <main className="relative z-10 flex-1 px-4 pt-4 pb-56">
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
                className="mb-4 flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl dynamic-glass-card text-[#10B981] text-xs font-medium border-[#10B981]/30"
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
                  audiusGenre={audiusGenre}
                  onSelectAudiusGenre={setAudiusGenre}
                  driveFolderUrl={driveFolderUrl}
                  onSyncDriveFolder={handleSyncDriveFolder}
                  isLoadingApi={isLoadingApi}
                  isLiveApi={isLiveApi}
                  onRefreshFeed={() =>
                    void fetchDiscoverFeed(activeGenre, driveFolderUrl, true, audiusGenre)
                  }
                  isOfflineMode={isOfflineMode}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  downloadedIds={downloadedIds}
                  likedIds={likedIds}
                  downloadProgressMap={downloadProgressMap}
                  audioQuality={audioQuality}
                  onPlayTrack={(track) => void handlePlayTrack(track)}
                  onPlayAll={() => {
                    if (exploreTracks.length > 0) {
                      void handlePlayTrack(exploreTracks[0], exploreTracks);
                    }
                  }}
                  onDownloadTrack={(track) => void handleDownloadTrack(track)}
                  onSaveFileToDevice={(track) => void handleSaveFileToDevice(track)}
                  onDeleteDownload={handleDeleteDownload}
                  onToggleLike={handleToggleLike}
                  onAddToPlaylist={(track) => setPlaylistPickerTrack(track)}
                  onSwitchToOnline={() => setIsOfflineMode(false)}
                  onImportLocalFiles={(files) => void handleImportLocalFiles(files)}
                  onPrefetchTrack={(track) => void prefetchTrackAudio(track)}
                  iframeAuthBlocked={iframeAuthBlocked}
                  driveError={driveError}
                  onResetDriveFolder={() =>
                    handleSyncDriveFolder(DEFAULT_DRIVE_FOLDER_URL)
                  }
                  jamendoConfigured={jamendoConfigured}
                  jamendoError={jamendoError}
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

        {/* Floating Toast Feedback anchored above MiniPlayer (Dynamic Glass Capsule) */}
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
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl dynamic-glass-elevated text-xs font-medium text-[#F8FAFC]">
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
            onExpand={() => {
              setFullPlayerTab('player');
              setIsFullPlayerOpen(true);
            }}
            onOpenLyrics={() => {
              setFullPlayerTab('lyrics');
              setIsFullPlayerOpen(true);
            }}
          />
        )}

        {/* Fixed Bottom Navigation Bar */}
        <BottomNav activeTab={activeNav} onSelectTab={setActiveNav} />

        {/* Full-Screen Now Playing Drawer */}
        <FullScreenPlayer
          isOpen={isFullPlayerOpen}
          initialTab={fullPlayerTab}
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
