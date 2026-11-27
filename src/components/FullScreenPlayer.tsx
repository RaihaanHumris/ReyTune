import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Disc3,
  ExternalLink,
  FileDown,
  FolderSync,
  Heart,
  ListPlus,
  Mic2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { RepeatMode, Track } from '../types/music';
import { parseId3FromBytes } from '../utils/id3LyricsParser';
import type { SyncedLyricLine } from '../utils/musicNormalizer';
import { getOfflineTrackRecord } from '../utils/indexedDb';
import { formatTime } from '../utils/playerLogic';
import { CircularDownloadButton } from './CircularDownloadButton';
import { CoverArtwork, TrackPhotoBackground } from './CoverArtwork';
import { EqualizerIcon } from './EqualizerIcon';

interface LyricsResponse {
  found: boolean;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  syncedLines: SyncedLyricLine[];
  plainLyrics: string;
  instrumental: boolean;
  source?: string;
  transcribeConfigured?: boolean;
  transcribeError?: string;
}

const clientLyricsCache = new Map<string, LyricsResponse>();

interface FullScreenPlayerProps {
  isOpen: boolean;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLiked: boolean;
  isDownloaded: boolean;
  downloadProgress: number | undefined;
  isOfflineMode: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  initialTab?: 'player' | 'lyrics';
  onClose: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  onToggleLike: (trackId: string) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onDownload: (track: Track) => void;
  onSaveFileToDevice: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
}

export const FullScreenPlayer: React.FC<FullScreenPlayerProps> = ({
  isOpen,
  track,
  isPlaying,
  currentTime,
  duration,
  isLiked,
  isDownloaded,
  downloadProgress,
  isOfflineMode,
  shuffle,
  repeatMode,
  initialTab = 'player',
  onClose,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onToggleLike,
  onToggleShuffle,
  onCycleRepeat,
  onDownload,
  onSaveFileToDevice,
  onAddToPlaylist,
}) => {
  const [activeTab, setActiveTab] = useState<'player' | 'lyrics'>('player');
  const [showYtPlayer, setShowYtPlayer] = useState(false);
  const [showDrivePlayer, setShowDrivePlayer] = useState(false);
  const [lyricsData, setLyricsData] = useState<LyricsResponse | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [autoScrollLyrics, setAutoScrollLyrics] = useState(true);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : '');
      };
      reader.onerror = () => reject(new Error('Failed to read audio blob'));
      reader.readAsDataURL(blob);
    });

  const loadLyrics = useCallback(
    async (targetTrack: Track, force = false) => {
      const cacheKey = targetTrack.id;
      if (!force && clientLyricsCache.has(cacheKey)) {
        setLyricsData(clientLyricsCache.get(cacheKey)!);
        return;
      }

      setIsLoadingLyrics(true);
      try {
        // 1. Check offline IndexedDB / local audio Blob directly for embedded ID3 USLT/SYLT lyrics
        let localAudioBlob: Blob | undefined;
        let id3TitleHint = targetTrack.title;
        let id3ArtistHint = targetTrack.artist;

        const offlineRec = await getOfflineTrackRecord(targetTrack.id).catch(() => undefined);
        if (offlineRec?.audioBlob) {
          localAudioBlob = offlineRec.audioBlob;
        } else if (targetTrack.audioUrl.startsWith('blob:')) {
          const blobRes = await fetch(targetTrack.audioUrl).catch(() => null);
          if (blobRes && blobRes.ok) {
            localAudioBlob = await blobRes.blob();
          }
        }

        if (localAudioBlob) {
          const sliceBuf = await localAudioBlob.slice(0, 262144).arrayBuffer();
          const id3 = parseId3FromBytes(new Uint8Array(sliceBuf));
          if (id3.title) id3TitleHint = id3.title;
          if (id3.artist) id3ArtistHint = id3.artist;
          if (id3.syncedLines.length > 0 || id3.plainLyrics) {
            const id3Result: LyricsResponse = {
              found: true,
              trackName: id3TitleHint,
              artistName: id3ArtistHint,
              albumName: id3.album || targetTrack.album,
              syncedLines: id3.syncedLines,
              plainLyrics: id3.plainLyrics,
              instrumental: false,
              source: 'id3',
            };
            clientLyricsCache.set(cacheKey, id3Result);
            setLyricsData(id3Result);
            return;
          }
        }

        if (isOfflineMode) {
          setLyricsData({
            found: false,
            syncedLines: [],
            plainLyrics: '',
            instrumental: false,
          });
          return;
        }

        // 2. Ask server to automatically extract ID3 -> LRCLIB -> Gemini 3.5 Transcribe directly from song audio
        const params = new URLSearchParams({
          id: targetTrack.id,
          title: id3TitleHint,
          artist: id3ArtistHint,
          album: targetTrack.album,
          duration: String(Math.round(targetTrack.durationSec || 0)),
          autoFromAudio: '1',
        });
        if (targetTrack.audioUrl.startsWith('https://')) {
          params.set('audioUrl', targetTrack.audioUrl);
        }
        if (force) {
          params.set('refresh', '1');
        }

        const res = await fetch(`/api/music/lyrics?${params.toString()}`, {
          credentials: 'include',
          signal: AbortSignal.timeout(45000),
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || ct.includes('text/html')) {
          throw new Error('Failed to load lyrics');
        }
        let json = (await res.json()) as LyricsResponse;

        // 3. If it's a local phone/desktop MP3 (blob:) and still not found, transcribe directly from uploaded local audio
        if (
          !json.found &&
          !json.instrumental &&
          localAudioBlob &&
          localAudioBlob.size <= 18 * 1024 * 1024 &&
          json.transcribeConfigured
        ) {
          const base64Audio = await blobToBase64(localAudioBlob);
          if (base64Audio) {
            const uploadRes = await fetch('/api/music/lyrics-from-audio', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trackId: targetTrack.id,
                base64Audio,
                mimeType: localAudioBlob.type || 'audio/mp3',
                title: id3TitleHint,
                artist: id3ArtistHint,
              }),
              signal: AbortSignal.timeout(45000),
            }).catch(() => null);
            if (uploadRes && uploadRes.ok) {
              json = (await uploadRes.json()) as LyricsResponse;
            }
          }
        }

        clientLyricsCache.set(cacheKey, json);
        setLyricsData(json);
      } catch {
        setLyricsData({
          found: false,
          syncedLines: [],
          plainLyrics: '',
          instrumental: false,
        });
      } finally {
        setIsLoadingLyrics(false);
      }
    },
    [isOfflineMode]
  );

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Automatically extract/load lyrics whenever the playing song changes (so Lyrics page & dot badge are ready immediately)
  useEffect(() => {
    setShowYtPlayer(false);
    setShowDrivePlayer(Boolean(track?.drivePreviewOnly && track?.driveFileId));
    setAutoScrollLyrics(true);
    if (!track) {
      setLyricsData(null);
      return;
    }
    const cached = clientLyricsCache.get(track.id);
    if (cached) {
      setLyricsData(cached);
      return;
    }
    setLyricsData(null);
    if (track.source === 'radio') return;

    const timer = window.setTimeout(() => {
      void loadLyrics(track);
    }, isOpen ? 50 : 500);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadLyrics, track]);

  const effectiveDuration = track
    ? duration > 0
      ? duration
      : track.durationSec
    : 0;
  const clampedTime = Math.min(currentTime, effectiveDuration);
  const progressPercent =
    effectiveDuration > 0 ? (clampedTime / effectiveDuration) * 100 : 0;

  const syncedLines = useMemo(
    () => lyricsData?.syncedLines ?? [],
    [lyricsData]
  );

  const activeLineIndex = useMemo(() => {
    if (syncedLines.length === 0) return -1;
    let activeIdx = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (clampedTime + 0.25 >= syncedLines[i].timeSec) {
        activeIdx = i;
      } else {
        break;
      }
    }
    return activeIdx;
  }, [clampedTime, syncedLines]);

  useEffect(() => {
    if (activeTab !== 'lyrics' || !autoScrollLyrics || activeLineIndex < 0) {
      return;
    }
    activeLineRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeLineIndex, activeTab, autoScrollLyrics]);

  if (!track) return null;

  const repeatLabel =
    repeatMode === 'off'
      ? 'Repeat off'
      : repeatMode === 'all'
      ? 'Repeat all'
      : 'Repeat one';

  const sourceBadge =
    track.source === 'gdrive'
      ? 'Google Drive Full MP3'
      : track.source === 'ytmusic'
      ? 'YouTube Music'
      : track.source === 'github'
      ? 'GitHub Repository Audio'
      : track.source === 'audius'
      ? 'Audius Free MP3'
      : track.source === 'hearthis'
      ? 'Hearthis Free MP3'
      : track.source === 'archive'
      ? 'Internet Archive MP3'
      : track.source === 'openverse'
      ? 'Openverse CC MP3'
      : track.source === 'radio'
      ? 'Radio Live Indonesia'
      : track.source === 'jamendo'
      ? 'Jamendo Free CC MP3'
      : track.source === 'itunes'
      ? 'iTunes 30s Preview'
      : 'ReyTune Online';

  const hasLyricsAvailable = Boolean(
    lyricsData?.found &&
      (syncedLines.length > 0 || lyricsData.plainLyrics.trim().length > 0)
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Now Playing: ${track.title}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex justify-center bg-black/75 backdrop-blur-md"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md h-full bg-[#0B0F17] flex flex-col justify-between px-6 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(2.75rem,calc(env(safe-area-inset-bottom,0px)+2.25rem))] overflow-y-auto overflow-x-hidden"
          >
            {/* Live Song Photo Background with Dynamic Glass Scrim */}
            <TrackPhotoBackground
              coverUrl={track.coverUrl}
              trackId={track.id}
              title={track.title}
              isPlaying={isPlaying}
              variant="fullscreen"
            />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                aria-label="Minimize player"
                className="flex items-center justify-center min-h-[44px] min-w-[44px] -ml-1 rounded-full dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <ChevronDown size={22} />
              </button>

              <div className="text-center min-w-0 px-3 py-1 rounded-2xl dynamic-glass-card">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#10B981]">
                  {isPlaying && (
                    <EqualizerIcon isPlaying={true} className="h-3 w-3" />
                  )}
                  <span className="truncate">
                    {isOfflineMode
                      ? 'Memutar dari Koleksi Offline'
                      : `Sumber: ${sourceBadge}`}
                  </span>
                </div>
                <p className="text-[12px] text-[#E2E8F0] truncate">
                  {track.album}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onAddToPlaylist(track)}
                aria-label={`Add ${track.title} to playlist`}
                className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-1 rounded-full dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <ListPlus size={19} />
              </button>
            </header>

            {/* View Switcher: Pemutar vs Lirik Lagu (Dynamic Glass Segmented Pill) */}
            <div className="relative z-10 flex items-center justify-center gap-1.5 mt-2 shrink-0">
              <div className="inline-flex p-1 rounded-2xl dynamic-glass-card">
                <button
                  type="button"
                  onClick={() => setActiveTab('player')}
                  className={`relative inline-flex items-center gap-1.5 h-8 px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                    activeTab === 'player'
                      ? 'bg-[#10B981] text-[#0B0F17] shadow-sm shadow-[#10B981]/30'
                      : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
                  }`}
                >
                  <Disc3 size={14} />
                  <span>Pemutar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('lyrics');
                    if (!lyricsData && !isOfflineMode && track.source !== 'radio') {
                      void loadLyrics(track);
                    }
                  }}
                  data-testid="toggle-lyrics-page"
                  className={`relative inline-flex items-center gap-1.5 h-8 px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                    activeTab === 'lyrics'
                      ? 'bg-[#10B981] text-[#0B0F17] shadow-sm shadow-[#10B981]/30'
                      : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
                  }`}
                >
                  <Mic2 size={14} />
                  <span>Lirik Lagu</span>
                  {hasLyricsAvailable && activeTab !== 'lyrics' && (
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full bg-[#10B981]"
                    />
                  )}
                </button>
              </div>
            </div>

            {activeTab === 'lyrics' ? (
              /* Dedicated Interactive Synced & Plain Lyrics Page (Dynamic Glass Card) */
              <div
                className="relative z-10 flex-1 min-h-0 flex flex-col my-3 rounded-2xl dynamic-glass-elevated overflow-hidden"
                data-testid="lyrics-page-view"
              >
                {/* Mini Track Context Bar inside Lyrics Page */}
                <div className="flex items-center justify-between gap-2.5 px-4 py-2.5 border-b border-white/[0.1] bg-white/[0.04] shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CoverArtwork
                      src={track.coverUrl}
                      alt={track.title}
                      className="w-9 h-9 rounded-lg shrink-0 ring-1 ring-white/15"
                      iconSize={16}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-[#CBD5E1]/80 truncate">
                        {track.artist}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {syncedLines.length > 0 && !autoScrollLyrics && (
                      <button
                        type="button"
                        onClick={() => setAutoScrollLyrics(true)}
                        className="h-7 px-2.5 rounded-lg bg-[#10B981]/20 border border-[#10B981]/30 text-[#10B981] text-[11px] font-semibold"
                      >
                        Ikuti Lirik
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadLyrics(track, true)}
                      disabled={isLoadingLyrics || isOfflineMode}
                      aria-label="Muat ulang lirik"
                      className="flex items-center justify-center w-8 h-8 rounded-lg dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC] disabled:opacity-40"
                    >
                      <RefreshCw
                        size={14}
                        className={isLoadingLyrics ? 'animate-spin text-[#10B981]' : ''}
                      />
                    </button>
                  </div>
                </div>

                {/* Scrollable Lyrics Content */}
                <div
                  onWheel={() => {
                    if (syncedLines.length > 0) setAutoScrollLyrics(false);
                  }}
                  onTouchMove={() => {
                    if (syncedLines.length > 0) setAutoScrollLyrics(false);
                  }}
                  className="flex-1 overflow-y-auto px-5 py-5 space-y-2.5"
                >
                  {isOfflineMode && !hasLyricsAvailable && !isLoadingLyrics ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <Mic2 size={28} className="text-[#94A3B8]/60" />
                      <p className="text-sm font-medium text-[#F8FAFC]">
                        Mode Offline Aktif
                      </p>
                      <p className="text-xs text-[#94A3B8] max-w-[240px]">
                        File ini belum memiliki tag lirik ID3. Aktifkan Mode Online untuk mengekstrak atau mentranskrip lirik otomatis dari lagu.
                      </p>
                    </div>
                  ) : track.source === 'radio' ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <Radio size={28} className="text-[#10B981]" />
                      <p className="text-sm font-medium text-[#F8FAFC]">
                        Siaran Radio Langsung
                      </p>
                      <p className="text-xs text-[#94A3B8] max-w-[240px]">
                        Lirik otomatis tersedia untuk lagu Google Drive, YouTube Music, GitHub, Audius, Jamendo, dan file MP3 HP.
                      </p>
                    </div>
                  ) : isLoadingLyrics ? (
                    <div className="space-y-3 py-4">
                      <p className="text-xs text-[#10B981] font-medium mb-3">
                        Mengekstrak &amp; mendengarkan lirik langsung dari lagu...
                      </p>
                      {[80, 65, 90, 55, 78, 60, 85, 70].map((w, idx) => (
                        <div
                          key={idx}
                          style={{ width: `${w}%` }}
                          className="h-4 rounded bg-white/[0.08] animate-pulse"
                        />
                      ))}
                    </div>
                  ) : syncedLines.length > 0 ? (
                    <div className="space-y-2.5 py-4">
                      {syncedLines.map((line, idx) => {
                        const isLineActive = idx === activeLineIndex;
                        const isPast = activeLineIndex > idx;
                        return (
                          <button
                            key={`${line.timeSec}-${idx}`}
                            ref={isLineActive ? activeLineRef : undefined}
                            type="button"
                            onClick={() => {
                              onSeek(line.timeSec);
                              setAutoScrollLyrics(true);
                            }}
                            className={`block w-full text-left rounded-xl px-3 py-1.5 transition-all duration-200 ${
                              isLineActive
                                ? 'text-[#10B981] font-bold text-[18px] leading-snug bg-[#10B981]/15 border border-[#10B981]/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                                : isPast
                                ? 'text-[#CBD5E1]/55 text-[15px] leading-snug hover:text-[#F8FAFC] hover:bg-white/[0.04]'
                                : 'text-[#F8FAFC]/90 text-[15px] leading-snug hover:text-[#F8FAFC] hover:bg-white/[0.04]'
                            }`}
                          >
                            {line.text}
                          </button>
                        );
                      })}
                    </div>
                  ) : lyricsData?.plainLyrics ? (
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-[#E2E8F0] py-2">
                      {lyricsData.plainLyrics}
                    </p>
                  ) : lyricsData?.instrumental ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <Mic2 size={28} className="text-[#10B981]" />
                      <p className="text-sm font-medium text-[#F8FAFC]">
                        Musik Instrumental
                      </p>
                      <p className="text-xs text-[#94A3B8]">
                        Track ini tercatat sebagai instrumental tanpa vokal.
                      </p>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-3">
                      <Mic2 size={28} className="text-[#94A3B8]/60" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-[#F8FAFC]">
                          Lirik belum ditemukan
                        </p>
                        <p className="text-xs text-[#94A3B8] max-w-[250px]">
                          {lyricsData?.transcribeError
                            ? lyricsData.transcribeError
                            : `Lirik otomatis untuk "${track.title}" belum tersedia di tag ID3 maupun LRCLIB.`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadLyrics(track, true)}
                        className="h-9 px-3.5 rounded-xl dynamic-glass-button text-xs font-medium text-[#F8FAFC]"
                      >
                        Ekstrak Ulang dari Lagu
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Attribution for Lyrics Source */}
                {hasLyricsAvailable && (
                  <div className="px-4 py-2 border-t border-white/[0.08] bg-white/[0.03] text-[10px] text-[#CBD5E1]/80 flex items-center justify-between shrink-0">
                    <span>
                      {syncedLines.length > 0
                        ? 'Lirik Tersinkron • Ketuk baris untuk lompat waktu'
                        : 'Lirik Teks Penuh'}
                    </span>
                    <span className="text-[#10B981] font-medium">
                      {lyricsData?.source === 'id3'
                        ? 'Tag Audio (ID3)'
                        : lyricsData?.source === 'audio-transcribe'
                        ? 'Transkrip Audio Lagu'
                        : 'LRCLIB API'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Optional YouTube Music / Google Drive Embedded Player Switcher */}
                {!isOfflineMode && track.youtubeVideoId && (
                  <div className="relative z-10 flex justify-center mt-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!showYtPlayer && isPlaying) {
                          onTogglePlay();
                        }
                        setShowYtPlayer((prev) => !prev);
                      }}
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium transition-colors ${
                        showYtPlayer
                          ? 'bg-[#10B981] text-[#0B0F17] border border-[#10B981]'
                          : 'dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC]'
                      }`}
                    >
                      <Radio size={13} />
                      <span>
                        {showYtPlayer
                          ? 'Kembali ke Mode Audio Stream'
                          : 'Buka Player Asli YouTube Music'}
                      </span>
                    </button>
                  </div>
                )}

                {!isOfflineMode && !track.youtubeVideoId && track.driveFileId && (
                  <div className="relative z-10 flex items-center justify-center gap-2 mt-2 shrink-0">
                    {!track.drivePreviewOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!showDrivePlayer && isPlaying) {
                            onTogglePlay();
                          }
                          setShowDrivePlayer((prev) => !prev);
                        }}
                        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium transition-colors ${
                          showDrivePlayer
                            ? 'bg-[#10B981] text-[#0B0F17] border border-[#10B981]'
                            : 'dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC]'
                        }`}
                      >
                        <FolderSync size={13} />
                        <span>
                          {showDrivePlayer
                            ? 'Kembali ke Audio Stream Cepat'
                            : 'Buka Player Asli Google Drive'}
                        </span>
                      </button>
                    )}
                    <a
                      href={`https://drive.google.com/file/d/${encodeURIComponent(track.driveFileId)}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-xl dynamic-glass-button text-[11px] font-medium text-[#CBD5E1] hover:text-[#F8FAFC] transition-colors"
                    >
                      <ExternalLink size={12} />
                      <span>Buka File di Drive</span>
                    </a>
                  </div>
                )}

                {/* Large Album Artwork inside Dynamic Glass Frame or Embedded Player */}
                <div className="relative z-10 my-3 flex items-center justify-center">
                  <motion.div
                    aria-hidden="true"
                    animate={{
                      scale: isPlaying ? [0.96, 1.06, 0.96] : 0.92,
                      opacity: isPlaying ? [0.25, 0.42, 0.25] : 0.14,
                    }}
                    transition={{
                      duration: 3.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="absolute w-64 h-64 rounded-full bg-[#10B981]/35 blur-3xl pointer-events-none"
                  />
                  {showYtPlayer && track.youtubeVideoId ? (
                    <div className="relative w-full max-w-[310px] aspect-square rounded-3xl p-2 dynamic-glass-elevated overflow-hidden">
                      <iframe
                        src={`https://www.youtube.com/embed/${encodeURIComponent(track.youtubeVideoId)}?autoplay=1&playsinline=1&rel=0`}
                        title={`YouTube Music: ${track.title}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full rounded-2xl border-0 bg-black"
                      />
                    </div>
                  ) : showDrivePlayer && track.driveFileId ? (
                    <div className="relative w-full max-w-[310px] aspect-square rounded-3xl p-2 dynamic-glass-elevated overflow-hidden flex flex-col">
                      <iframe
                        src={`https://drive.google.com/file/d/${encodeURIComponent(track.driveFileId)}/preview`}
                        title={`Google Drive Audio: ${track.title}`}
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                        className="w-full flex-1 rounded-t-2xl border-0 bg-[#0B0F17]"
                      />
                      <div className="px-3 py-1.5 bg-white/[0.06] border-t border-white/10 rounded-b-2xl text-[10px] text-[#CBD5E1] text-center">
                        Memakai sesi login Google browser Anda tanpa OAuth
                      </div>
                    </div>
                  ) : (
                    <motion.div
                      animate={{ scale: isPlaying ? 1 : 0.94 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="relative w-full max-w-[300px] aspect-square rounded-3xl p-2.5 dynamic-glass-elevated"
                    >
                      <CoverArtwork
                        src={track.coverUrl}
                        alt={`${track.album} cover art`}
                        className="w-full h-full rounded-2xl shadow-2xl shadow-black/70 ring-1 ring-white/20"
                        iconSize={56}
                      />
                    </motion.div>
                  )}
                </div>
              </>
            )}

            {/* Track Info & Quick Actions + Controls inside Dynamic Glass Panel */}
            <div className="relative z-10 rounded-3xl dynamic-glass-card p-4 space-y-3.5 shrink-0">
              {activeTab === 'player' && (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold text-[#F8FAFC] truncate leading-tight">
                      {track.title}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-1 text-sm text-[#CBD5E1]/85">
                      {isDownloaded && (
                        <CheckCircle2
                          size={14}
                          className="text-[#10B981] shrink-0"
                          aria-label="Downloaded offline"
                        />
                      )}
                      <span className="truncate">{track.artist}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {track.source !== 'radio' && !track.id.startsWith('radio-') && (
                      typeof downloadProgress === 'number' && downloadProgress < 100 ? (
                        <CircularDownloadButton
                          trackTitle={track.title}
                          isDownloaded={isDownloaded}
                          progress={downloadProgress}
                          isOfflineMode={isOfflineMode}
                          onDownload={() => onSaveFileToDevice(track)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSaveFileToDevice(track)}
                          disabled={isOfflineMode && !isDownloaded}
                          aria-label={`Download ${track.title} MP3`}
                          title="Download MP3 ke perangkat & simpan offline"
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#10B981]/18 hover:bg-[#10B981]/28 border border-[#10B981]/35 text-[#10B981] text-xs font-semibold active:scale-95 transition-all disabled:opacity-40 whitespace-nowrap"
                        >
                          <FileDown size={15} />
                          <span>Unduh MP3</span>
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => onToggleLike(track.id)}
                      aria-label={
                        isLiked ? `Unlike ${track.title}` : `Like ${track.title}`
                      }
                      aria-pressed={isLiked}
                      className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-white/[0.08] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
                    >
                      <Heart
                        size={22}
                        className={
                          isLiked
                            ? 'text-[#10B981] fill-[#10B981]'
                            : 'text-[#CBD5E1]'
                        }
                      />
                    </button>
                  </div>
                </div>
              )}

              {/* Interactive Seekbar Scrubber */}
              <div>
                <div className="relative h-6 flex items-center">
                  <div className="w-full h-1.5 rounded-full bg-white/[0.12] overflow-hidden pointer-events-none">
                    <div
                      className="h-full bg-gradient-to-r from-[#10B981] to-[#34D399] rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration}
                    step={0.5}
                    value={clampedTime}
                    onChange={(e) => onSeek(Number(e.target.value))}
                    aria-label="Seek audio position"
                    className="seek-slider absolute inset-0 w-full h-full opacity-100"
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#CBD5E1]/80 mt-1">
                  <span data-testid="player-current-time">
                    {formatTime(clampedTime)}
                  </span>
                  <span data-testid="player-total-time">
                    {formatTime(effectiveDuration)}
                  </span>
                </div>
              </div>

              {/* Primary Playback Controls */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={onToggleShuffle}
                  aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                  aria-pressed={shuffle}
                  className={`flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                    shuffle
                      ? 'text-[#10B981] bg-[#10B981]/15 border border-[#10B981]/30'
                      : 'text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-white/[0.06]'
                  }`}
                >
                  <Shuffle size={20} />
                </button>

                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label="Previous track"
                  className="flex items-center justify-center min-h-[48px] min-w-[48px] rounded-full text-[#F8FAFC] hover:bg-white/[0.08] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
                >
                  <SkipBack size={26} fill="currentColor" />
                </button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={onTogglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  data-testid="fullscreen-play-pause"
                  className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-[#34D399] to-[#10B981] hover:from-[#10B981] hover:to-[#059669] text-[#0B0F17] shadow-lg shadow-[#10B981]/35 ring-1 ring-white/30 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F8FAFC]"
                >
                  {isPlaying ? (
                    <Pause size={28} fill="currentColor" />
                  ) : (
                    <Play
                      size={28}
                      fill="currentColor"
                      className="translate-x-[2px]"
                    />
                  )}
                </motion.button>

                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next track"
                  className="flex items-center justify-center min-h-[48px] min-w-[48px] rounded-full text-[#F8FAFC] hover:bg-white/[0.08] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
                >
                  <SkipForward size={26} fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={onCycleRepeat}
                  aria-label={repeatLabel}
                  title={repeatLabel}
                  className={`relative flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                    repeatMode !== 'off'
                      ? 'text-[#10B981] bg-[#10B981]/15 border border-[#10B981]/30'
                      : 'text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-white/[0.06]'
                  }`}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 size={20} />
                  ) : (
                    <Repeat size={20} />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
