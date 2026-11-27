import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileDown,
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
import { CoverArtwork, TrackPhotoBackground } from './CoverArtwork';
import { TrackListItem } from './TrackListItem';

const GENRE_FILTERS = [
  { id: 'all', label: 'Semua' },
  { id: 'audius', label: 'Audius Free' },
  { id: 'jamendo', label: 'Jamendo CC' },
  { id: 'hearthis', label: 'Hearthis' },
  { id: 'archive', label: 'Archive MP3' },
  { id: 'ytmusic', label: 'YT Music' },
  { id: 'drive', label: 'Google Drive' },
  { id: 'radio', label: 'Radio ID' },
  { id: 'trending', label: 'Trending' },
  { id: 'indonesia', label: 'Lagu Indo' },
  { id: 'pop', label: 'Pop Indo' },
  { id: 'barat', label: 'Barat Hits' },
  { id: 'viral', label: 'Viral TikTok' },
  { id: 'chill', label: 'Chill' },
] as const;

const AUDIUS_SUB_GENRES = [
  { id: '', label: 'Trending' },
  { id: 'Pop', label: 'Pop' },
  { id: 'Lo-Fi', label: 'Lo-Fi' },
  { id: 'Electronic', label: 'Electronic' },
  { id: 'Hip-Hop/Rap', label: 'Hip-Hop' },
  { id: 'Acoustic', label: 'Acoustic' },
  { id: 'Rock', label: 'Rock' },
  { id: 'R&B/Soul', label: 'R&B' },
  { id: 'Jazz', label: 'Jazz' },
  { id: 'underground', label: 'Underground' },
] as const;

const QUICK_SEARCH_CHIPS = [
  'Tulus',
  'Lo-Fi Chill',
  'Acoustic',
  'Jazz',
  'Electronic',
  'Bernadya',
] as const;

interface ExploreViewProps {
  tracks: Track[];
  featuredTrack: Track | undefined;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeGenre: string;
  onSelectGenre: (genre: string) => void;
  audiusGenre?: string;
  onSelectAudiusGenre?: (subGenre: string) => void;
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
  onPlayAll?: () => void;
  onDownloadTrack: (track: Track) => void;
  onSaveFileToDevice: (track: Track) => void;
  onDeleteDownload: (track: Track) => void;
  onToggleLike: (trackId: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onSwitchToOnline: () => void;
  onImportLocalFiles?: (files: FileList) => void;
  onPrefetchTrack?: (track: Track) => void;
  iframeAuthBlocked?: boolean;
  driveError?: string | null;
  onResetDriveFolder?: () => void;
  jamendoConfigured?: boolean;
  jamendoError?: string | null;
}

function getDriveBrowserOpenUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) {
    return `https://drive.google.com/drive/folders/${encodeURIComponent(trimmed)}`;
  }
  return 'https://drive.google.com';
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  tracks,
  featuredTrack,
  searchQuery,
  onSearchChange,
  activeGenre,
  onSelectGenre,
  audiusGenre = '',
  onSelectAudiusGenre,
  driveFolderUrl,
  onSyncDriveFolder,
  isLoadingApi,
  isLiveApi: _isLiveApi,
  onRefreshFeed,
  isOfflineMode,
  currentTrackId,
  isPlaying,
  downloadedIds,
  likedIds,
  downloadProgressMap,
  audioQuality,
  onPlayTrack,
  onPlayAll,
  onDownloadTrack,
  onSaveFileToDevice,
  onDeleteDownload,
  onToggleLike,
  onAddToPlaylist,
  onSwitchToOnline,
  onImportLocalFiles,
  onPrefetchTrack,
  iframeAuthBlocked = false,
  driveError = null,
  onResetDriveFolder,
  jamendoConfigured = true,
  jamendoError = null,
}) => {
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [customDriveInput, setCustomDriveInput] = useState(driveFolderUrl);
  const [searchSourceFilter, setSearchSourceFilter] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCustomDriveInput(driveFolderUrl);
  }, [driveFolderUrl]);

  useEffect(() => {
    setSearchSourceFilter('all');
  }, [searchQuery]);

  const searchSourceCounts = useMemo(() => {
    if (!searchQuery.trim() || isOfflineMode) return null;
    const counts: Record<string, number> = { all: tracks.length };
    for (const t of tracks) {
      const bucket =
        t.source === 'openverse' || t.source === 'jamendo'
          ? 'jamendo'
          : t.source || 'local';
      counts[bucket] = (counts[bucket] || 0) + 1;
    }
    return counts;
  }, [isOfflineMode, searchQuery, tracks]);

  const visibleTracks = useMemo(() => {
    if (!searchQuery.trim() || isOfflineMode || searchSourceFilter === 'all') {
      return tracks;
    }
    return tracks.filter((t) => {
      if (searchSourceFilter === 'jamendo') {
        return t.source === 'jamendo' || t.source === 'openverse';
      }
      return (t.source || 'local') === searchSourceFilter;
    });
  }, [isOfflineMode, searchQuery, searchSourceFilter, tracks]);

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
      {/* Search Bar (Dynamic Glass Input) */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none z-10"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={
            isOfflineMode
              ? 'Cari lagu tersimpan offline...'
              : 'Cari lagu gratis (Audius, Jamendo CC, Hearthis, Archive, Drive, YT)...'
          }
          aria-label="Search music catalog"
          className="w-full h-11 pl-10 pr-10 rounded-xl dynamic-glass-input text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:outline-none transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[40px] min-w-[40px] text-[#94A3B8] hover:text-[#F8FAFC] z-10"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Iframe Cookie Block Notice for Mobile Browsers */}
      {!isOfflineMode && iframeAuthBlocked && typeof window !== 'undefined' && (
        <div className="rounded-xl bg-[#F59E0B]/10 backdrop-blur-md border border-[#F59E0B]/30 px-3.5 py-2.5 flex items-center justify-between gap-2.5">
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

      {/* Multi-Source API Status Bar: Google Drive + YouTube Music API (Dynamic Glass Card) */}
      {!isOfflineMode && (
        <div className="rounded-2xl dynamic-glass-card p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#10B981]/15 border border-[#10B981]/25 text-[#10B981] flex items-center justify-center shrink-0">
                {activeGenre === 'ytmusic' ? (
                  <Radio size={15} />
                ) : (
                  <FolderSync size={15} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                  Audius · Jamendo CC · Hearthis · Archive · Drive
                </p>
                <p className="text-[11px] text-[#94A3B8] truncate">
                  Streaming Gratis · Download MP3 Langsung · Lirik Sinkron
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
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg dynamic-glass-button text-[11px] font-medium text-[#F8FAFC] transition-colors"
              >
                <Link2 size={12} />
                <span>Drive / GitHub</span>
              </button>
              <button
                type="button"
                onClick={() => onSyncDriveFolder(driveFolderUrl)}
                disabled={isLoadingApi}
                aria-label="Sync Google Drive & Music APIs"
                title="Sinkronkan ulang lagu"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/25 text-[#10B981] transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={isLoadingApi ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </div>

          {showDriveInput && (
            <form onSubmit={handleDriveSubmit} className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={customDriveInput}
                    onChange={(e) => setCustomDriveInput(e.target.value)}
                    placeholder="Tempel link Drive (folder/file/open?id=) atau GitHub..."
                    aria-label="Google Drive or GitHub repository URL"
                    className="w-full h-9 pl-3 pr-8 rounded-lg dynamic-glass-input text-xs text-[#F8FAFC] placeholder:text-[#94A3B8]/60 focus:outline-none"
                  />
                  {customDriveInput && (
                    <button
                      type="button"
                      onClick={() => setCustomDriveInput('')}
                      aria-label="Hapus link"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-[#94A3B8] hover:text-[#F8FAFC]"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="h-9 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold shrink-0"
                >
                  Muat Link
                </button>
              </div>
              <p className="text-[10px] text-[#94A3B8] leading-relaxed">
                Mendukung link Folder, File tunggal (<code className="text-[#CBD5E1]">/file/d/</code>, <code className="text-[#CBD5E1]">/open?id=</code>), ID Drive, atau Repo GitHub publik. File Private juga bisa dipilih langsung lewat tombol <strong className="text-[#10B981]">MP3 HP</strong>.
              </p>
            </form>
          )}

          {driveError && (
            <div
              role="alert"
              className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/35 p-3 space-y-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-[#FBBF24] shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-[#FDE68A]">
                    Akses Google Drive Terbatas / Gagal Dimuat
                  </p>
                  <p className="text-[11px] text-[#FDE68A]/90 leading-relaxed">
                    {driveError}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={getDriveBrowserOpenUrl(driveFolderUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B0F17] text-[11px] font-semibold transition-colors"
                >
                  <ExternalLink size={12} />
                  <span>Atur Berbagi di Drive</span>
                </a>
                {onImportLocalFiles && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-[11px] font-semibold transition-colors"
                  >
                    <Upload size={12} />
                    <span>Pilih File dari Drive / HP</span>
                  </button>
                )}
                {onResetDriveFolder && (
                  <button
                    type="button"
                    onClick={onResetDriveFolder}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg dynamic-glass-button text-[#F8FAFC] text-[11px] font-medium transition-colors"
                  >
                    <RefreshCw size={12} />
                    <span>168 Lagu Drive Default</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interactive Genre / Source Filter Chips (Dynamic Glass Rail) */}
      {!isOfflineMode && !searchQuery.trim() && (
        <div className="space-y-2">
          <div
            role="tablist"
            aria-label="Music sources and genres"
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
                  className={`relative h-9 px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                    isActive
                      ? 'text-[#0B0F17]'
                      : 'dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC]'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="active-genre-bg"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#10B981] to-[#34D399] shadow-[0_4px_14px_rgba(16,185,129,0.3)]"
                    />
                  )}
                  <span className="relative z-10">{g.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sub-genre selector for Audius Free Streaming API */}
          {activeGenre === 'audius' && onSelectAudiusGenre && (
            <div
              aria-label="Audius genres"
              className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
            >
              {AUDIUS_SUB_GENRES.map((sub) => {
                const selected = audiusGenre === sub.id;
                return (
                  <button
                    key={sub.id || 'trending'}
                    type="button"
                    onClick={() => onSelectAudiusGenre(sub.id)}
                    className={`h-7 px-3 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                      selected
                        ? 'bg-[#10B981]/20 border border-[#10B981]/45 text-[#10B981]'
                        : 'bg-white/[0.05] border border-white/[0.08] text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Multi-API Search Source Filter Pills */}
      {!isOfflineMode && searchQuery.trim() && !isLoadingApi && searchSourceCounts && tracks.length > 0 && (
        <div
          aria-label="Filter search results by source"
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
        >
          {(
            [
              { id: 'all', label: 'Semua' },
              { id: 'audius', label: 'Audius' },
              { id: 'jamendo', label: 'Jamendo CC' },
              { id: 'hearthis', label: 'Hearthis' },
              { id: 'archive', label: 'Archive' },
              { id: 'gdrive', label: 'Drive' },
              { id: 'ytmusic', label: 'YT Music' },
              { id: 'itunes', label: 'Preview' },
            ] as const
          )
            .filter((item) => item.id === 'all' || (searchSourceCounts[item.id] || 0) > 0)
            .map((item) => {
              const count = searchSourceCounts[item.id] || 0;
              const isSelected = searchSourceFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSearchSourceFilter(item.id)}
                  className={`h-8 px-3 rounded-xl text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-[#10B981] text-[#0B0F17]'
                      : 'dynamic-glass-button text-[#CBD5E1] hover:text-[#F8FAFC]'
                  }`}
                >
                  {item.label} ({count})
                </button>
              );
            })}
        </div>
      )}

      {/* Featured Spotlight (Dynamic Glass Hero with Artwork Refraction) */}
      {showFeaturedSpotlight && featuredTrack && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          aria-label="Featured track"
        >
          <div className="relative overflow-hidden rounded-2xl dynamic-glass-elevated p-4 flex items-center gap-4">
            {/* Live Song Photo Background behind Dynamic Glass Hero */}
            <TrackPhotoBackground
              coverUrl={featuredTrack.coverUrl}
              trackId={featuredTrack.id}
              title={featuredTrack.title}
              isPlaying={isPlaying && currentTrackId === featuredTrack.id}
              variant="mini"
            />

            <div className="relative z-10 shrink-0 rounded-xl overflow-hidden ring-1 ring-white/20 shadow-lg shadow-black/50">
              <CoverArtwork
                src={featuredTrack.coverUrl}
                alt={`${featuredTrack.album} cover art`}
                className="w-20 h-20 rounded-xl"
                iconSize={28}
              />
            </div>

            <div className="relative z-10 flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#10B981]">
                {featuredTrack.source === 'ytmusic'
                  ? 'YouTube Music Trending'
                  : featuredTrack.source === 'gdrive'
                  ? 'Google Drive Full MP3'
                  : featuredTrack.source === 'github'
                  ? 'GitHub Repository Audio'
                  : featuredTrack.source === 'audius'
                  ? 'Audius Free Full MP3'
                  : featuredTrack.source === 'hearthis'
                  ? 'Hearthis Free Full MP3'
                  : featuredTrack.source === 'archive'
                  ? 'Internet Archive Free MP3'
                  : featuredTrack.source === 'openverse'
                  ? 'Openverse CC Free MP3'
                  : featuredTrack.source === 'radio'
                  ? 'Radio Streaming Live ID'
                  : featuredTrack.source === 'jamendo'
                  ? 'Jamendo Free CC MP3'
                  : 'Featured Track'}
              </p>
              <h2 className="text-base font-bold text-[#F8FAFC] truncate mt-0.5">
                {featuredTrack.title}
              </h2>
              <p className="text-[13px] text-[#CBD5E1]/85 truncate">
                {featuredTrack.artist} ·{' '}
                {featuredTrack.source === 'radio'
                  ? 'LIVE'
                  : formatTime(featuredTrack.durationSec)}
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onPointerDown={() => onPrefetchTrack?.(featuredTrack)}
                  onClick={() => onPlayTrack(featuredTrack)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#10B981] hover:bg-[#059669] active:scale-95 text-[#0B0F17] text-xs font-semibold shadow-sm shadow-[#10B981]/25 transition-all whitespace-nowrap shrink-0"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Putar</span>
                </button>
                {featuredTrack.source !== 'radio' && !featuredTrack.id.startsWith('radio-') && (
                  <button
                    type="button"
                    onClick={() => onSaveFileToDevice(featuredTrack)}
                    disabled={typeof downloadProgressMap[featuredTrack.id] === 'number'}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl dynamic-glass-button active:scale-95 text-[#F8FAFC] text-xs font-medium transition-all whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    <FileDown size={14} className="text-[#10B981]" />
                    <span>
                      {typeof downloadProgressMap[featuredTrack.id] === 'number'
                        ? `${downloadProgressMap[featuredTrack.id]}%`
                        : 'Unduh MP3'}
                    </span>
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
                  ? 'Mencari di 6+ API Musik Gratis...'
                  : 'Memuat Koleksi Musik...'
                : searchQuery
                ? 'Hasil Pencarian Multi-API'
                : activeGenre === 'ytmusic'
                ? 'Koleksi YouTube Music & Online Hits'
                : activeGenre === 'drive'
                ? 'Koleksi Google Drive / GitHub'
                : activeGenre === 'audius'
                ? `Audius Free MP3${audiusGenre ? ` · ${audiusGenre}` : ' · Trending'}`
                : activeGenre === 'hearthis'
                ? 'Hearthis.at Free Full MP3 & Mix'
                : activeGenre === 'archive'
                ? 'Internet Archive Free MP3 (Public Domain)'
                : activeGenre === 'radio'
                ? 'Radio Streaming Indonesia (Live)'
                : activeGenre === 'jamendo'
                ? 'Jamendo Creative Commons Free MP3'
                : 'Koleksi Lengkap (Free MP3 & Online)'}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isLoadingApi && onPlayAll && tracks.length > 0 && (
              <button
                type="button"
                onClick={onPlayAll}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#10B981] text-[11px] font-semibold transition-colors whitespace-nowrap"
              >
                <Play size={11} fill="currentColor" />
                <span>Putar Semua</span>
              </button>
            )}
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
                {visibleTracks.length} lagu
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
        ) : visibleTracks.length === 0 ? (
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
                  Kembali ke Mode Online untuk memutar dan mengunduh lagu gratis dari Audius, Jamendo CC, Hearthis, Archive, &amp; Drive.
                </p>
                <button
                  type="button"
                  onClick={onSwitchToOnline}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold transition-colors"
                >
                  Beralih ke Online
                </button>
              </>
            ) : activeGenre === 'jamendo' && !searchQuery.trim() ? (
              <>
                <Radio size={28} className="mx-auto text-[#10B981]" />
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {jamendoConfigured
                    ? 'Belum ada lagu Jamendo / Openverse yang termuat'
                    : 'Gagal memuat Jamendo Free CC'}
                </p>
                <p className="text-xs text-[#94A3B8] max-w-xs mx-auto leading-relaxed">
                  {jamendoError ||
                    'Katalog Jamendo Creative Commons diakses gratis otomatis via Openverse. Coba muat ulang beberapa saat lagi.'}
                </p>
                <button
                  type="button"
                  onClick={onRefreshFeed}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-[#F8FAFC] text-xs font-medium transition-colors"
                >
                  Muat Ulang Jamendo CC
                </button>
              </>
            ) : activeGenre === 'drive' && !searchQuery.trim() ? (
              <>
                <FolderSync size={28} className="mx-auto text-[#F59E0B]" />
                <p className="text-sm font-medium text-[#F8FAFC]">
                  Folder / Link Drive Tidak Bisa Diakses
                </p>
                <p className="text-xs text-[#94A3B8] max-w-xs mx-auto leading-relaxed">
                  {driveError ||
                    'Pastikan folder Google Drive memiliki izin "Siapa saja yang memiliki link" (Anyone with the link) dan berisi file audio (.mp3/.m4a/.wav/.ogg/.flac).'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {onImportLocalFiles && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold transition-colors"
                    >
                      <Upload size={14} />
                      <span>Pilih File dari Drive / HP</span>
                    </button>
                  )}
                  {onResetDriveFolder && (
                    <button
                      type="button"
                      onClick={onResetDriveFolder}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-[#F8FAFC] text-xs font-medium transition-colors"
                    >
                      <RefreshCw size={14} />
                      <span>Muat Drive Default</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <Search size={28} className="mx-auto text-[#94A3B8]" />
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {searchQuery
                    ? `Tidak ditemukan lagu untuk "${searchQuery}"`
                    : 'Belum ada lagu termuat untuk kategori ini'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  {QUICK_SEARCH_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => onSearchChange(chip)}
                      className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-[11px] text-[#CBD5E1]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-[#F8FAFC] text-xs font-medium transition-colors"
                  >
                    Reset Pencarian
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRefreshFeed}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-[#F8FAFC] text-xs font-medium transition-colors"
                  >
                    Muat Ulang
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleTracks.map((track) => (
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
