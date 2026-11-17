import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Disc3,
  FileDown,
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
import type { SyncedLyricLine } from '../utils/musicNormalizer';
import { formatTime } from '../utils/playerLogic';
import { CircularDownloadButton } from './CircularDownloadButton';
import { CoverArtwork } from './CoverArtwork';
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
  const [lyricsData, setLyricsData] = useState<LyricsResponse | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [autoScrollLyrics, setAutoScrollLyrics] = useState(true);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const loadLyrics = useCallback(
    async (targetTrack: Track, force = false) => {
      if (isOfflineMode) return;
      const cacheKey = targetTrack.id;
      if (!force && clientLyricsCache.has(cacheKey)) {
        setLyricsData(clientLyricsCache.get(cacheKey)!);
        return;
      }

      setIsLoadingLyrics(true);
      try {
        const params = new URLSearchParams({
          title: targetTrack.title,
          artist: targetTrack.artist,
          album: targetTrack.album,
          duration: String(Math.round(targetTrack.durationSec || 0)),
        });
        const res = await fetch(`/api/music/lyrics?${params.toString()}`, {
          credentials: 'include',
          signal: AbortSignal.timeout(6500),
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || ct.includes('text/html')) {
          throw new Error('Failed to load lyrics');
        }
        const json = (await res.json()) as LyricsResponse;
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

  useEffect(() => {
    setShowYtPlayer(false);
    setAutoScrollLyrics(true);
    if (!track) {
      setLyricsData(null);
      return;
    }
    const cached = clientLyricsCache.get(track.id);
    setLyricsData(cached ?? null);
    if (isOpen && !isOfflineMode && track.source !== 'radio') {
      void loadLyrics(track);
    }
  }, [isOfflineMode, isOpen, loadLyrics, track]);

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
      : track.source === 'radio'
      ? 'Radio Live Indonesia'
      : track.source === 'jamendo'
      ? 'Jamendo Free MP3'
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
          className="fixed inset-0 z-50 flex justify-center bg-black/75 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md h-full bg-gradient-to-b from-[#131A26] via-[#0B0F17] to-[#0B0F17] flex flex-col justify-between px-6 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(2.75rem,calc(env(safe-area-inset-bottom,0px)+2.25rem))] overflow-y-auto"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                aria-label="Minimize player"
                className="flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <ChevronDown size={24} />
              </button>

              <div className="text-center min-w-0 px-2">
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
                <p className="text-[12px] text-[#94A3B8] truncate">
                  {track.album}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onAddToPlaylist(track)}
                aria-label={`Add ${track.title} to playlist`}
                className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <ListPlus size={20} />
              </button>
            </header>

            {/* View Switcher: Pemutar vs Lirik Lagu */}
            <div className="flex items-center justify-center gap-1.5 mt-2 shrink-0">
              <div className="inline-flex p-1 rounded-xl bg-[#131A26] border border-[#1E293B]">
                <button
                  type="button"
                  onClick={() => setActiveTab('player')}
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === 'player'
                      ? 'bg-[#10B981] text-[#0B0F17]'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC]'
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
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === 'lyrics'
                      ? 'bg-[#10B981] text-[#0B0F17]'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC]'
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
              /* Dedicated Interactive Synced & Plain Lyrics Page */
              <div
                className="flex-1 min-h-0 flex flex-col my-3 rounded-2xl bg-[#131A26]/75 border border-[#1E293B] overflow-hidden"
                data-testid="lyrics-page-view"
              >
                {/* Mini Track Context Bar inside Lyrics Page */}
                <div className="flex items-center justify-between gap-2.5 px-4 py-2.5 border-b border-[#1E293B]/80 bg-[#0B0F17]/40 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CoverArtwork
                      src={track.coverUrl}
                      alt={track.title}
                      className="w-9 h-9 rounded-lg shrink-0"
                      iconSize={16}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-[#94A3B8] truncate">
                        {track.artist}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {syncedLines.length > 0 && !autoScrollLyrics && (
                      <button
                        type="button"
                        onClick={() => setAutoScrollLyrics(true)}
                        className="h-7 px-2.5 rounded-lg bg-[#10B981]/15 text-[#10B981] text-[11px] font-semibold"
                      >
                        Ikuti Lirik
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadLyrics(track, true)}
                      disabled={isLoadingLyrics || isOfflineMode}
                      aria-label="Muat ulang lirik"
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] disabled:opacity-40"
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
                  {isOfflineMode ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <Mic2 size={28} className="text-[#94A3B8]/60" />
                      <p className="text-sm font-medium text-[#F8FAFC]">
                        Mode Offline Aktif
                      </p>
                      <p className="text-xs text-[#94A3B8] max-w-[240px]">
                        Aktifkan Mode Online untuk memuat lirik lagu secara otomatis dari LRCLIB API.
                      </p>
                    </div>
                  ) : track.source === 'radio' ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <Radio size={28} className="text-[#10B981]" />
                      <p className="text-sm font-medium text-[#F8FAFC]">
                        Siaran Radio Langsung
                      </p>
                      <p className="text-xs text-[#94A3B8] max-w-[240px]">
                        Lirik otomatis tersedia untuk lagu Google Drive, YouTube Music, GitHub, Audius, dan Jamendo.
                      </p>
                    </div>
                  ) : isLoadingLyrics ? (
                    <div className="space-y-3 py-4 animate-pulse">
                      {[80, 65, 90, 55, 78, 60, 85, 70].map((w, idx) => (
                        <div
                          key={idx}
                          style={{ width: `${w}%` }}
                          className="h-4 rounded bg-[#1E293B]"
                        />
                      ))}
                    </div>
                  ) : syncedLines.length > 0 ? (
                    <div className="space-y-3 py-4">
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
                            className={`block w-full text-left rounded-lg px-2 py-1 transition-all duration-200 ${
                              isLineActive
                                ? 'text-[#10B981] font-bold text-[18px] leading-snug bg-[#10B981]/10'
                                : isPast
                                ? 'text-[#94A3B8]/55 text-[15px] leading-snug hover:text-[#F8FAFC]'
                                : 'text-[#CBD5E1]/85 text-[15px] leading-snug hover:text-[#F8FAFC]'
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
                        <p className="text-xs text-[#94A3B8] max-w-[240px]">
                          Lirik untuk &ldquo;{track.title}&rdquo; belum tersedia di database LRCLIB.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadLyrics(track, true)}
                        className="h-9 px-3.5 rounded-lg bg-[#1E293B] hover:bg-[#334155] text-xs font-medium text-[#F8FAFC]"
                      >
                        Coba Cari Lagi
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Attribution for LRCLIB */}
                {hasLyricsAvailable && (
                  <div className="px-4 py-2 border-t border-[#1E293B]/70 bg-[#0B0F17]/40 text-[10px] text-[#94A3B8] flex items-center justify-between shrink-0">
                    <span>
                      {syncedLines.length > 0
                        ? 'Lirik Tersinkron • Ketuk baris untuk lompat waktu'
                        : 'Lirik Teks Penuh'}
                    </span>
                    <span className="text-[#10B981] font-medium">LRCLIB API</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Optional YouTube Music Video/Audio Mode Switcher */}
                {!isOfflineMode && track.youtubeVideoId && (
                  <div className="flex justify-center mt-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!showYtPlayer && isPlaying) {
                          onTogglePlay();
                        }
                        setShowYtPlayer((prev) => !prev);
                      }}
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        showYtPlayer
                          ? 'bg-[#10B981] text-[#0B0F17] border-[#10B981]'
                          : 'bg-[#131A26] text-[#94A3B8] hover:text-[#F8FAFC] border-[#1E293B]'
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

                {/* Large Album Artwork or Embedded YouTube Music Player */}
                <div className="relative my-3 flex items-center justify-center">
                  <motion.div
                    aria-hidden="true"
                    animate={{
                      scale: isPlaying ? [0.96, 1.05, 0.96] : 0.92,
                      opacity: isPlaying ? [0.22, 0.38, 0.22] : 0.12,
                    }}
                    transition={{
                      duration: 3.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="absolute w-64 h-64 rounded-full bg-[#10B981]/30 blur-3xl pointer-events-none"
                  />
                  {showYtPlayer && track.youtubeVideoId ? (
                    <div className="relative w-full max-w-[310px] aspect-square rounded-2xl overflow-hidden shadow-2xl shadow-black/70 border border-[#1E293B] bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${encodeURIComponent(track.youtubeVideoId)}?autoplay=1&playsinline=1&rel=0`}
                        title={`YouTube Music: ${track.title}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full border-0"
                      />
                    </div>
                  ) : (
                    <motion.div
                      animate={{ scale: isPlaying ? 1 : 0.94 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="relative w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden shadow-2xl shadow-black/70 border border-[#1E293B]"
                    >
                      <CoverArtwork
                        src={track.coverUrl}
                        alt={`${track.album} cover art`}
                        className="w-full h-full rounded-2xl"
                        iconSize={56}
                      />
                    </motion.div>
                  )}
                </div>
              </>
            )}

            {/* Track Info & Quick Actions + Controls */}
            <div className="space-y-4 shrink-0">
              {activeTab === 'player' && (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold text-[#F8FAFC] truncate leading-tight">
                      {track.title}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-1 text-sm text-[#94A3B8]">
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

                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => onSaveFileToDevice(track)}
                      disabled={isOfflineMode && !isDownloaded}
                      aria-label={`Save ${track.title} MP3 file`}
                      title="Save MP3 file to device"
                      className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] transition-colors disabled:opacity-40"
                    >
                      <FileDown size={20} />
                    </button>

                    <CircularDownloadButton
                      trackTitle={track.title}
                      isDownloaded={isDownloaded}
                      progress={downloadProgress}
                      isOfflineMode={isOfflineMode}
                      onDownload={() => onDownload(track)}
                    />

                    <button
                      type="button"
                      onClick={() => onToggleLike(track.id)}
                      aria-label={
                        isLiked ? `Unlike ${track.title}` : `Like ${track.title}`
                      }
                      aria-pressed={isLiked}
                      className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
                    >
                      <Heart
                        size={22}
                        className={
                          isLiked
                            ? 'text-[#10B981] fill-[#10B981]'
                            : 'text-[#94A3B8]'
                        }
                      />
                    </button>
                  </div>
                </div>
              )}

              {/* Interactive Seekbar Scrubber */}
              <div>
                <div className="relative h-6 flex items-center">
                  <div className="w-full h-1.5 rounded-full bg-[#1E293B] overflow-hidden pointer-events-none">
                    <div
                      className="h-full bg-[#10B981] rounded-full"
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
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#94A3B8] mt-1">
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
                      ? 'text-[#10B981] bg-[#10B981]/10'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  <Shuffle size={20} />
                </button>

                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label="Previous track"
                  className="flex items-center justify-center min-h-[48px] min-w-[48px] rounded-full text-[#F8FAFC] hover:bg-[#1E293B] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
                >
                  <SkipBack size={26} fill="currentColor" />
                </button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={onTogglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  data-testid="fullscreen-play-pause"
                  className="flex items-center justify-center w-16 h-16 rounded-full bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] shadow-lg shadow-[#10B981]/30 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F8FAFC]"
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
                  className="flex items-center justify-center min-h-[48px] min-w-[48px] rounded-full text-[#F8FAFC] hover:bg-[#1E293B] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
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
                      ? 'text-[#10B981] bg-[#10B981]/10'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC]'
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
