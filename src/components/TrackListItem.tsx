import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileDown,
  Heart,
  ListPlus,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { AudioQuality, Track } from '../types/music';
import { formatTime, getEffectiveTrackSizeMb } from '../utils/playerLogic';
import { CircularDownloadButton } from './CircularDownloadButton';
import { CoverArtwork, TrackPhotoBackground } from './CoverArtwork';
import { EqualizerIcon } from './EqualizerIcon';

interface TrackListItemProps {
  track: Track;
  isActive: boolean;
  isPlaying: boolean;
  isDownloaded: boolean;
  isLiked: boolean;
  downloadProgress: number | undefined;
  isOfflineMode: boolean;
  audioQuality: AudioQuality;
  showDirectDelete?: boolean;
  onPlay: (track: Track) => void;
  onDownload: (track: Track) => void;
  onSaveFileToDevice: (track: Track) => void;
  onDeleteDownload: (track: Track) => void;
  onToggleLike: (trackId: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onPrefetch?: (track: Track) => void;
}

export const TrackListItem: React.FC<TrackListItemProps> = ({
  track,
  isActive,
  isPlaying,
  isDownloaded,
  isLiked,
  downloadProgress,
  isOfflineMode,
  audioQuality,
  showDirectDelete = false,
  onPlay,
  onDownload,
  onSaveFileToDevice,
  onDeleteDownload,
  onToggleLike,
  onAddToPlaylist,
  onPrefetch,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDisabledInOffline = isOfflineMode && !isDownloaded;
  const effectiveSize =
    track.source === 'local' || track.source === undefined
      ? getEffectiveTrackSizeMb(track, audioQuality)
      : track.fileSizeMb;

  const isLiveRadio = track.source === 'radio' || track.id.startsWith('radio-');
  const isDownloading = typeof downloadProgress === 'number' && downloadProgress < 100;

  const sourceLabel =
    track.source === 'gdrive'
      ? 'Drive MP3'
      : track.source === 'ytmusic'
      ? 'YT Music'
      : track.source === 'jamendo'
      ? 'Jamendo CC'
      : track.source === 'openverse'
      ? 'Openverse CC'
      : track.source === 'hearthis'
      ? 'Hearthis MP3'
      : track.source === 'archive'
      ? 'Archive MP3'
      : track.source === 'radio'
      ? 'Radio Live'
      : track.source === 'github'
      ? 'GitHub MP3'
      : track.source === 'audius'
      ? 'Audius Free'
      : track.source === 'itunes' || track.isPreview
      ? '30s Preview'
      : null;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      data-testid={`track-item-${track.id}`}
      className={`group relative flex items-center justify-between gap-1 px-2.5 py-2 min-h-[64px] rounded-xl transition-all duration-150 ${
        isActive
          ? 'dynamic-glass-row-active'
          : 'border border-transparent hover:bg-white/[0.05] hover:border-white/[0.08]'
      } ${isDisabledInOffline ? 'opacity-50' : ''}`}
    >
      {/* When this track is active/playing, its cover photo becomes the row background behind dynamic glass */}
      {isActive && (
        <TrackPhotoBackground
          coverUrl={track.coverUrl}
          trackId={track.id}
          title={track.title}
          isPlaying={isPlaying}
          variant="row"
        />
      )}

      {/* Primary clickable track row */}
      <button
        type="button"
        onPointerDown={() => onPrefetch?.(track)}
        onClick={() => onPlay(track)}
        aria-label={`Play ${track.title} by ${track.artist}`}
        className="relative z-10 flex flex-1 min-w-0 items-center gap-3 text-left py-0.5 active:scale-[0.99] transition-transform focus-visible:outline-2 focus-visible:outline-[#10B981] rounded-lg"
      >
        {/* 48x48px Cover Art + Equalizer Overlay */}
        <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10">
          <CoverArtwork
            src={track.coverUrl}
            alt={`${track.album} cover art`}
            className="w-12 h-12 rounded-lg"
            iconSize={18}
          />
          {isActive && (
            <div className="absolute inset-0 bg-[#0B0F17]/65 flex items-center justify-center backdrop-blur-[2px]">
              <EqualizerIcon isPlaying={isPlaying} />
            </div>
          )}
        </div>

        {/* Title, Artist, Offline Checkmark & Metadata */}
        <div className="flex-1 min-w-0">
          <p
            className={`text-[15px] font-medium truncate leading-snug ${
              isActive ? 'text-[#10B981]' : 'text-[#F8FAFC]'
            }`}
          >
            {track.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 text-[13px] text-[#94A3B8] min-w-0">
            {isDownloaded && (
              <CheckCircle2
                size={14}
                className="text-[#10B981] shrink-0"
                aria-label="Available offline"
              />
            )}
            <span className="truncate">{track.artist}</span>
            <span aria-hidden="true" className="text-[#94A3B8]/50 shrink-0">
              ·
            </span>
            <span className="text-[11px] font-mono tabular-nums shrink-0 text-[#94A3B8]/85">
              {isLiveRadio ? 'LIVE' : formatTime(track.durationSec)}
            </span>
            {sourceLabel ? (
              <>
                <span aria-hidden="true" className="text-[#94A3B8]/50 shrink-0 hidden min-[370px]:inline">
                  ·
                </span>
                <span
                  className={`text-[11px] shrink-0 hidden min-[370px]:inline ${
                    track.isPreview ? 'text-[#F59E0B]' : 'text-[#94A3B8]/85'
                  }`}
                >
                  {sourceLabel}
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="text-[#94A3B8]/50 shrink-0 hidden min-[370px]:inline">
                  ·
                </span>
                <span className="text-[11px] font-mono tabular-nums shrink-0 text-[#94A3B8]/85 hidden min-[370px]:inline">
                  {effectiveSize.toFixed(1)} MB
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {/* Right Action Controls */}
      <div className="relative z-10 flex items-center shrink-0" ref={menuRef}>
        {!isLiveRadio &&
          (showDirectDelete && isDownloaded ? (
            <>
              <button
                type="button"
                onClick={() => onSaveFileToDevice(track)}
                aria-label={`Download ${track.title} MP3`}
                title={`Simpan ${track.title} (.mp3) ke perangkat`}
                className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full text-[#10B981] hover:bg-[#10B981]/15 transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <FileDown size={17} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onDeleteDownload(track)}
                aria-label={`Delete download ${track.title}`}
                title={`Remove ${track.title} from offline storage`}
                className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full text-[#94A3B8] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors focus-visible:outline-2 focus-visible:outline-[#EF4444]"
              >
                <Trash2 size={17} strokeWidth={2} />
              </button>
            </>
          ) : isDownloading ? (
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
              title={
                isDownloaded
                  ? `Simpan file .mp3 "${track.title}" ke perangkat (sudah tersimpan offline)`
                  : `Download "${track.title}" (.mp3 & simpan offline)`
              }
              className={`flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full active:scale-95 transition-all disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                isDownloaded
                  ? 'text-[#10B981] bg-[#10B981]/12 hover:bg-[#10B981]/20'
                  : 'text-[#94A3B8] hover:text-[#10B981] hover:bg-white/[0.08]'
              }`}
            >
              <FileDown size={18} strokeWidth={2} />
            </button>
          ))}

        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={`More options for ${track.title}`}
          aria-expanded={menuOpen}
          className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.08] transition-colors focus-visible:outline-2 focus-visible:outline-[#10B981]"
        >
          <MoreVertical size={18} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-2 top-14 z-30 w-56 rounded-2xl dynamic-glass-elevated py-1.5 text-sm"
          >
            {!isLiveRadio && (
              <button
                type="button"
                role="menuitem"
                disabled={isOfflineMode && !isDownloaded}
                onClick={() => {
                  onSaveFileToDevice(track);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[#10B981] font-medium hover:bg-white/[0.08] transition-colors disabled:opacity-40"
              >
                <FileDown size={16} />
                <span>Download MP3 ke HP/PC</span>
              </button>
            )}

            {!isLiveRadio && !isDownloaded && (
              <button
                type="button"
                role="menuitem"
                disabled={isOfflineMode}
                onClick={() => {
                  onDownload(track);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[#F8FAFC] hover:bg-white/[0.08] transition-colors disabled:opacity-40"
              >
                <CheckCircle2 size={16} className="text-[#94A3B8]" />
                <span>Simpan Offline di Aplikasi</span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleLike(track.id);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[#F8FAFC] hover:bg-white/[0.08] transition-colors"
            >
              <Heart
                size={16}
                className={isLiked ? 'text-[#10B981] fill-[#10B981]' : 'text-[#94A3B8]'}
              />
              <span>{isLiked ? 'Hapus dari Disukai' : 'Tambah ke Disukai'}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddToPlaylist(track);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[#F8FAFC] hover:bg-white/[0.08] transition-colors"
            >
              <ListPlus size={16} className="text-[#94A3B8]" />
              <span>Tambah ke Playlist</span>
            </button>

            {isDownloaded && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteDownload(track);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
              >
                <Trash2 size={16} />
                <span>Hapus Cache Offline</span>
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};
