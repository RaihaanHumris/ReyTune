import React, { useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ExternalLink,
  FolderSync,
  Link2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { AudioQuality, Track } from '../types/music';
import { formatTime } from '../utils/playerLogic';
import { CoverArtwork } from './CoverArtwork';
import { TrackListItem } from './TrackListItem';

const GENRE_FILTERS = [
  { id: 'all', label: 'Semua (320+)' },
  { id: 'ytmusic', label: 'YouTube Music' },
  { id: 'drive', label: 'Google Drive' },
  { id: 'trending', label: 'Trending' },
  { id: 'indonesia', label: 'Lagu Indo' },
  { id: 'pop', label: 'Pop Indo' },
  { id: 'barat', label: 'Barat Hits' },
  { id: 'viral', label: 'Viral TikTok' },
  { id: 'chill', label: 'Chill' },
] as const;

interface ExploreViewProps {
  tracks: Track[];
  featuredTrack: Track | undefined;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeGenre: string;
  onSelectGenre: (genre: string) => void;
  driveFolderUrl: string;
  onSyncDriveFolder: (folderUrl: string) => void;
  isLoadingApi: boolean;
  isLiveApi: boolean;
  onRefreshFeed: () => void;
  isOfflineMode: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  downloadedIds: Set<string>;
  likedIds: Set<string>;
  downloadProgressMap: Record<string, number>;
  audioQuality: AudioQuality;
  onPlayTrack: (track: Track) => void;
  onDownloadTrack: (track: Track) => void;
  onSaveFileToDevice: (track: Track) => void;
  onDeleteDownload: (track: Track) => void;
  onToggleLike: (trackId: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onSwitchToOnline: () => void;
  onImportLocalFiles?: (files: FileList) => void;
  onPrefetchTrack?: (track: Track) => void;
  iframeAuthBlocked?: boolean;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  tracks,
  featuredTrack,
  searchQuery,
  onSearchChange,
  activeGenre,
  onSelectGenre,
  driveFolderUrl,
  onSyncDriveFolder,
  isLoadingApi,
  isLiveApi,
  onRefreshFeed,
  isOfflineMode,
  currentTrackId,
  isPlaying,
  downloadedIds,
  likedIds,
  downloadProgressMap,
  audioQuality,
  onPlayTrack,
  onDownloadTrack,
  onSaveFileToDevice,
  onDeleteDownload,
  onToggleLike,
  onAddToPlaylist,
  onSwitchToOnline,
  onImportLocalFiles,
  onPrefetchTrack,
  iframeAuthBlocked = false,
}) => {
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [customDriveInput, setCustomDriveInput] = useState(driveFolderUrl);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showFeaturedSpotlight =
    !isOfflineMode &&
    !searchQuery.trim() &&
    featuredTrack !== undefined &&
    !isLoadingApi;

  const handleDriveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customDriveInput.trim();
    if (!trimmed) return;
    onSyncDriveFolder(trimmed);
    setShowDriveInput(false);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={
            isOfflineMode
              ? 'Cari lagu tersimpan offline...'
              : 'Cari di YouTube Music & Drive (Bernadya, Tulus, Sheila On 7...)'
          }
          aria-label="Search music catalog"
          className="w-full h-11 pl-10 pr-10 rounded-xl bg-[#1E293B] text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] border border-transparent focus:border-[#10B981] focus:outline-none transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[40px] min-w-[40px] text-[#94A3B8] hover:text-[#F8FAFC]"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Iframe Cookie Block Notice for Mobile Browsers */}
      {!isOfflineMode && iframeAuthBlocked && typeof window !== 'undefined' && (
        <div className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 flex items-center justify-between gap-2.5">
          <p className="text-[11px] text-[#FDE68A] leading-snug">
            Browser HP memblokir cookie pratinjau untuk streaming Drive. Buka di tab browser penuh agar semua lagu Drive lancar.
          </p>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#F59E0B] text-[#0B0F17] text-[11px] font-semibold whitespace-nowrap shrink-0"
          >
            <ExternalLink size={12} />
            <span>Buka Tab</span>
          </a>
        </div>
      )}

      {/* Multi-Source API Status Bar: Google Drive + YouTube Music API */}
      {!isOfflineMode && (
        <div className="rounded-xl bg-[#131A26] border border-[#1E293B] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#10B981]/15 text-[#10B981] flex items-center justify-center shrink-0">
                {activeGenre === 'ytmusic' ? (
                  <Radio size={15} />
                ) : (
                  <FolderSync size={15} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                  Google Drive + YouTube Music API Aktif
                </p>
                <p className="text-[11px] text-[#94A3B8] truncate">
                  168 Lagu Drive · 150+ YT Music &amp; Live Search
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onImportLocalFiles && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onImportLocalFiles(e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Pilih file MP3/Audio langsung dari memori HP atau Laptop"
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/30 text-[11px] font-semibold text-[#10B981] transition-colors"
                  >
                    <Upload size={12} />
                    <span>MP3 HP</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowDriveInput((prev) => !prev)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#1E293B] hover:bg-[#334155] text-[11px] font-medium text-[#F8FAFC] transition-colors"
              >
                <Link2 size={12} />
                <span>Link Drive</span>
              </button>
              <button
                type="button"
                onClick={() => onSyncDriveFolder(driveFolderUrl)}
                disabled={isLoadingApi}
                aria-label="Sync Google Drive & YouTube Music"
                title="Sinkronkan ulang lagu dari Google Drive & YouTube Music"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#10B981] transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={isLoadingApi ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </div>

          {showDriveInput && (
            <form onSubmit={handleDriveSubmit} className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customDriveInput}
                  onChange={(e) => setCustomDriveInput(e.target.value)}
                  placeholder="Link folder / file Google Drive publik..."
                  aria-label="Google Drive folder or file URL"
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-[#0B0F17] border border-[#1E293B] text-xs text-[#F8FAFC] placeholder:text-[#94A3B8]/60 focus:outline-none focus:border-[#10B981]"
                />
                <button
                  type="submit"
                  className="h-9 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold shrink-0"
                >
                  Muat Drive
                </button>
              </div>
              <p className="text-[10px] text-[#94A3B8]">
                Mendukung link Folder atau 1 File MP3/M4A yang diset &quot;Siapa saja yang memiliki link&quot;.
              </p>
            </form>
          )}
        </div>
      )}

      {/* Interactive Genre Filter Chips */}
      {!isOfflineMode && !searchQuery.trim() && (
        <div
          role="tablist"
          aria-label="Music genres"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
        >
          {GENRE_FILTERS.map((g) => {
            const isActive = activeGenre === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectGenre(g.id)}
                className={`relative h-9 px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                  isActive
                    ? 'text-[#0B0F17]'
                    : 'bg-[#131A26] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="active-genre-bg"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-lg bg-[#10B981]"
                  />
                )}
                <span className="relative z-10">{g.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Featured Spotlight */}
      {showFeaturedSpotlight && featuredTrack && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          aria-label="Featured track"
        >
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#131A26] to-[#1E293B]/60 border border-[#1E293B] p-4 flex items-center gap-4">
            <CoverArtwork
              src={featuredTrack.coverUrl}
              alt={`${featuredTrack.album} cover art`}
              className="w-20 h-20 rounded-xl shadow-lg"
              iconSize={28}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#10B981]">
                {featuredTrack.source === 'ytmusic'
                  ? 'YouTube Music Trending'
                  : featuredTrack.source === 'gdrive'
                  ? 'Google Drive Full MP3'
                  : 'Featured Track'}
              </p>
              <h2 className="text-base font-bold text-[#F8FAFC] truncate mt-0.5">
                {featuredTrack.title}
              </h2>
              <p className="text-[13px] text-[#94A3B8] truncate">
                {featuredTrack.artist} · {formatTime(featuredTrack.durationSec)}
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onPointerDown={() => onPrefetchTrack?.(featuredTrack)}
                  onClick={() => onPlayTrack(featuredTrack)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#10B981] hover:bg-[#059669] active:scale-95 text-[#0B0F17] text-xs font-semibold transition-all whitespace-nowrap shrink-0"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Putar Sekarang</span>
                </button>
                {!downloadedIds.has(featuredTrack.id) && (
                  <button
                    type="button"
                    onClick={() => onDownloadTrack(featuredTrack)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#1E293B] hover:bg-[#334155] active:scale-95 text-[#F8FAFC] text-xs font-medium transition-all whitespace-nowrap shrink-0"
                  >
                    <ArrowDownToLine size={14} />
                    <span>Simpan Offline</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* Track List Section */}
      <section aria-label={isOfflineMode ? 'Saved offline tracks' : 'Music feed'}>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-[#F8FAFC]">
              {isOfflineMode
                ? 'Lagu Tersimpan Offline'
                : isLoadingApi
                ? searchQuery.trim()
                  ? 'Mencari di YouTube Music & Drive...'
                  : 'Memuat Koleksi Musik...'
                : searchQuery
                ? 'Hasil Pencarian (Drive + YouTube Music)'
                : activeGenre === 'ytmusic'
                ? 'Koleksi YouTube Music & Online Hits'
                : activeGenre === 'drive'
                ? 'Koleksi Google Drive (Full MP3)'
                : 'Koleksi Lengkap (Drive + YouTube Music)'}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isOfflineMode && (
              <button
                type="button"
                onClick={onRefreshFeed}
                aria-label="Refresh music feed"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] transition-colors"
              >
                <RefreshCw
                  size={14}
                  className={isLoadingApi ? 'animate-spin text-[#10B981]' : ''}
                />
              </button>
            )}
            {!isLoadingApi && (
              <span className="text-xs font-mono tabular-nums text-[#94A3B8]">
                {tracks.length} lagu
              </span>
            )}
          </div>
        </div>

        {isLoadingApi ? (
          <div className="space-y-2" aria-label="Loading tracks">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-2.5 py-2 min-h-[64px] rounded-xl bg-[#131A26]/70 animate-pulse"
              >
                <div className="w-12 h-12 rounded-lg bg-[#1E293B] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/5 rounded bg-[#1E293B]" />
                  <div className="h-3 w-2/5 rounded bg-[#1E293B]" />
                </div>
              </div>
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <div className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-8 text-center space-y-3">
            {isOfflineMode ? (
              <>
                <WifiOff size={28} className="mx-auto text-[#94A3B8]" />
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {searchQuery
                    ? `Tidak ada lagu tersimpan untuk "${searchQuery}"`
                    : 'Belum ada lagu offline'}
                </p>
                <p className="text-xs text-[#94A3B8]">
                  Kembali ke Mode Online untuk memutar dan mengunduh 320+ lagu dari Google Drive &amp; YouTube Music.
                </p>
                <button
                  type="button"
                  onClick={onSwitchToOnline}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold transition-colors"
                >
                  Beralih ke Online
                </button>
              </>
            ) : (
              <>
                <Search size={28} className="mx-auto text-[#94A3B8]" />
                <p className="text-sm font-medium text-[#F8FAFC]">
                  Tidak ditemukan lagu untuk &ldquo;{searchQuery}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-[#F8FAFC] text-xs font-medium transition-colors"
                >
                  Reset Pencarian
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track) => (
              <TrackListItem
                key={track.id}
                track={track}
                isActive={currentTrackId === track.id}
                isPlaying={isPlaying && currentTrackId === track.id}
                isDownloaded={downloadedIds.has(track.id)}
                isLiked={likedIds.has(track.id)}
                downloadProgress={downloadProgressMap[track.id]}
                isOfflineMode={isOfflineMode}
                audioQuality={audioQuality}
                onPlay={onPlayTrack}
                onDownload={onDownloadTrack}
                onSaveFileToDevice={onSaveFileToDevice}
                onDeleteDownload={onDeleteDownload}
                onToggleLike={onToggleLike}
                onAddToPlaylist={onAddToPlaylist}
                onPrefetch={onPrefetchTrack}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
