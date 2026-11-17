import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  FileDown,
  Heart,
  ListPlus,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { RepeatMode, Track } from '../types/music';
import { formatTime } from '../utils/playerLogic';
import { CircularDownloadButton } from './CircularDownloadButton';
import { CoverArtwork } from './CoverArtwork';
import { EqualizerIcon } from './EqualizerIcon';

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
  const [showYtPlayer, setShowYtPlayer] = useState(false);

  useEffect(() => {
    setShowYtPlayer(false);
  }, [track?.id]);

  if (!track) return null;

  const effectiveDuration = duration > 0 ? duration : track.durationSec;
  const clampedTime = Math.min(currentTime, effectiveDuration);
  const progressPercent =
    effectiveDuration > 0 ? (clampedTime / effectiveDuration) * 100 : 0;

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
      : 'ReyTune Online';

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

            {/* Optional YouTube Music Video/Audio Mode Switcher */}
            {!isOfflineMode && track.youtubeVideoId && (
              <div className="flex justify-center mt-1 shrink-0">
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

            {/* Track Info & Quick Actions */}
            <div className="space-y-6">
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
