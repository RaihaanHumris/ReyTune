import React, { useState } from 'react';
import {
  ChevronRight,
  HardDrive,
  Heart,
  ListMusic,
  Plus,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  AudioQuality,
  LibraryTab,
  Playlist,
  StorageStats,
  Track,
} from '../types/music';
import { TrackListItem } from './TrackListItem';

interface LibraryViewProps {
  allTracks: Track[];
  downloadedIds: Set<string>;
  likedIds: Set<string>;
  playlists: Playlist[];
  storageStats: StorageStats;
  activeSubTab: LibraryTab;
  onSelectSubTab: (tab: LibraryTab) => void;
  currentTrackId: string | null;
  isPlaying: boolean;
  downloadProgressMap: Record<string, number>;
  isOfflineMode: boolean;
  audioQuality: AudioQuality;
  onPlayTrack: (track: Track, queueOverride?: Track[]) => void;
  onDownloadTrack: (track: Track) => void;
  onSaveFileToDevice: (track: Track) => void;
  onDeleteDownload: (track: Track) => void;
  onToggleLike: (trackId: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onRemoveTrackFromPlaylist: (playlistId: string, trackId: string) => void;
}

const SUB_TABS: { id: LibraryTab; label: string }[] = [
  { id: 'downloads', label: 'All Downloads' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'liked', label: 'Liked' },
];

export const LibraryView: React.FC<LibraryViewProps> = ({
  allTracks,
  downloadedIds,
  likedIds,
  playlists,
  storageStats,
  activeSubTab,
  onSelectSubTab,
  currentTrackId,
  isPlaying,
  downloadProgressMap,
  isOfflineMode,
  audioQuality,
  onPlayTrack,
  onDownloadTrack,
  onSaveFileToDevice,
  onDeleteDownload,
  onToggleLike,
  onAddToPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onRemoveTrackFromPlaylist,
}) => {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showNewPlaylistForm, setShowNewPlaylistForm] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [formError, setFormError] = useState('');

  const downloadedTracks = allTracks.filter((t) => downloadedIds.has(t.id));
  const likedTracks = allTracks.filter((t) => likedIds.has(t.id));
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null;

  const handleCreatePlaylistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = playlistName.trim();
    if (!trimmed) {
      setFormError('Please enter a playlist name');
      return;
    }
    onCreatePlaylist(trimmed);
    setPlaylistName('');
    setFormError('');
    setShowNewPlaylistForm(false);
  };

  return (
    <div className="space-y-5">
      {/* Local Storage Usage Bar */}
      <section
        aria-label="Offline storage usage"
        className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#1E293B] text-[#10B981]">
              <HardDrive size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#F8FAFC]">Offline Storage</h2>
              <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
                {storageStats.downloadedCount}{' '}
                {storageStats.downloadedCount === 1 ? 'track' : 'tracks'} cached
              </p>
            </div>
          </div>

          <div className="text-right font-mono tabular-nums">
            <p className="text-sm font-semibold text-[#F8FAFC]" data-testid="storage-used-mb">
              {storageStats.usedMb.toFixed(1)} MB
            </p>
            <p className="text-[11px] text-[#94A3B8]">
              of {storageStats.capacityMb} MB
            </p>
          </div>
        </div>

        <div
          className="h-2 w-full rounded-full bg-[#0B0F17] overflow-hidden"
          role="progressbar"
          aria-label="Local storage used"
          aria-valuemin={0}
          aria-valuemax={storageStats.capacityMb}
          aria-valuenow={storageStats.usedMb}
        >
          <motion.div
            initial={false}
            animate={{
              width: `${Math.max(storageStats.usedMb > 0 ? 2 : 0, storageStats.usagePercent)}%`,
            }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full bg-[#10B981]"
          />
        </div>
      </section>

      {/* Filter Tabs */}
      <div
        role="tablist"
        aria-label="Library sections"
        className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#131A26] border border-[#1E293B]"
      >
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                onSelectSubTab(tab.id);
                setSelectedPlaylistId(null);
              }}
              className={`relative h-10 px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#10B981] ${
                isActive ? 'text-[#10B981]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="library-subtab-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-lg bg-[#1E293B] shadow-sm"
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content: All Downloads */}
      {activeSubTab === 'downloads' && (
        <section aria-label="All downloaded tracks" className="space-y-2">
          {downloadedTracks.length === 0 ? (
            <div className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-8 text-center space-y-2">
              <HardDrive size={28} className="mx-auto text-[#94A3B8]" />
              <p className="text-sm font-medium text-[#F8FAFC]">No downloaded tracks</p>
              <p className="text-xs text-[#94A3B8]">
                Download songs from Explore to play them offline anytime.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {downloadedTracks.map((track) => (
                <TrackListItem
                  key={track.id}
                  track={track}
                  isActive={currentTrackId === track.id}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  isDownloaded={true}
                  isLiked={likedIds.has(track.id)}
                  downloadProgress={downloadProgressMap[track.id]}
                  isOfflineMode={isOfflineMode}
                  audioQuality={audioQuality}
                  showDirectDelete={true}
                  onPlay={(t) => onPlayTrack(t, downloadedTracks)}
                  onDownload={onDownloadTrack}
                  onSaveFileToDevice={onSaveFileToDevice}
                  onDeleteDownload={onDeleteDownload}
                  onToggleLike={onToggleLike}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Playlists */}
      {activeSubTab === 'playlists' && (
        <section aria-label="User playlists" className="space-y-4">
          {selectedPlaylist ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlaylistId(null)}
                  className="text-xs font-medium text-[#10B981] hover:underline py-2"
                >
                  &larr; All Playlists
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeletePlaylist(selectedPlaylist.id);
                    setSelectedPlaylistId(null);
                  }}
                  aria-label={`Delete playlist ${selectedPlaylist.name}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] hover:underline py-2"
                >
                  <Trash2 size={14} />
                  <span>Delete Playlist</span>
                </button>
              </div>

              <div className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[#F8FAFC]">
                    {selectedPlaylist.name}
                  </h3>
                  <p className="text-xs text-[#94A3B8] font-mono tabular-nums mt-0.5">
                    {selectedPlaylist.trackIds.length} tracks
                  </p>
                </div>
                {selectedPlaylist.trackIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const plTracks = allTracks.filter((t) =>
                        selectedPlaylist.trackIds.includes(t.id)
                      );
                      if (plTracks.length > 0) {
                        onPlayTrack(plTracks[0], plTracks);
                      }
                    }}
                    className="h-9 px-4 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold"
                  >
                    Play All
                  </button>
                )}
              </div>

              {selectedPlaylist.trackIds.length === 0 ? (
                <p className="text-xs text-[#94A3B8] text-center py-6">
                  This playlist has no tracks yet. Use the track menu to add songs.
                </p>
              ) : (
                <div className="space-y-1">
                  {allTracks
                    .filter((t) => selectedPlaylist.trackIds.includes(t.id))
                    .map((track) => (
                      <div key={track.id} className="flex items-center gap-1">
                        <div className="flex-1 min-w-0">
                          <TrackListItem
                            track={track}
                            isActive={currentTrackId === track.id}
                            isPlaying={isPlaying && currentTrackId === track.id}
                            isDownloaded={downloadedIds.has(track.id)}
                            isLiked={likedIds.has(track.id)}
                            downloadProgress={downloadProgressMap[track.id]}
                            isOfflineMode={isOfflineMode}
                            audioQuality={audioQuality}
                            onPlay={(t) =>
                              onPlayTrack(
                                t,
                                allTracks.filter((item) =>
                                  selectedPlaylist.trackIds.includes(item.id)
                                )
                              )
                            }
                            onDownload={onDownloadTrack}
                            onSaveFileToDevice={onSaveFileToDevice}
                            onDeleteDownload={onDeleteDownload}
                            onToggleLike={onToggleLike}
                            onAddToPlaylist={onAddToPlaylist}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onRemoveTrackFromPlaylist(selectedPlaylist.id, track.id)
                          }
                          aria-label={`Remove ${track.title} from ${selectedPlaylist.name}`}
                          className="flex items-center justify-center min-h-[44px] min-w-[40px] rounded-full text-[#94A3B8] hover:text-[#EF4444]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F8FAFC]">
                  Your Playlists ({playlists.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowNewPlaylistForm((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-xs font-medium text-[#F8FAFC] transition-colors"
                >
                  <Plus size={15} />
                  <span>New Playlist</span>
                </button>
              </div>

              {showNewPlaylistForm && (
                <form
                  onSubmit={handleCreatePlaylistSubmit}
                  className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-3.5 space-y-2"
                >
                  <label htmlFor="new-playlist-input" className="sr-only">
                    Playlist name
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="new-playlist-input"
                      type="text"
                      value={playlistName}
                      onChange={(e) => {
                        setPlaylistName(e.target.value);
                        if (formError) setFormError('');
                      }}
                      placeholder="Playlist name..."
                      className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-[#0B0F17] border border-[#1E293B] text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/60 focus:outline-none focus:border-[#10B981]"
                    />
                    <button
                      type="submit"
                      className="h-10 px-4 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-xs font-semibold shrink-0"
                    >
                      Save
                    </button>
                  </div>
                  {formError && <p className="text-xs text-[#EF4444]">{formError}</p>}
                </form>
              )}

              <div className="space-y-2">
                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => setSelectedPlaylistId(pl.id)}
                    className="w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#131A26] hover:bg-[#1E293B]/80 border border-[#1E293B] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#1E293B] text-[#10B981] shrink-0">
                        <ListMusic size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#F8FAFC] truncate">
                          {pl.name}
                        </p>
                        <p className="text-xs text-[#94A3B8] font-mono tabular-nums mt-0.5">
                          {pl.trackIds.length}{' '}
                          {pl.trackIds.length === 1 ? 'track' : 'tracks'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-[#94A3B8] shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* Tab Content: Liked */}
      {activeSubTab === 'liked' && (
        <section aria-label="Liked tracks" className="space-y-2">
          {likedTracks.length === 0 ? (
            <div className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-8 text-center space-y-2">
              <Heart size={28} className="mx-auto text-[#94A3B8]" />
              <p className="text-sm font-medium text-[#F8FAFC]">No liked songs yet</p>
              <p className="text-xs text-[#94A3B8]">
                Tap the heart icon in the player or track menu to save favorites here.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {likedTracks.map((track) => (
                <TrackListItem
                  key={track.id}
                  track={track}
                  isActive={currentTrackId === track.id}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  isDownloaded={downloadedIds.has(track.id)}
                  isLiked={true}
                  downloadProgress={downloadProgressMap[track.id]}
                  isOfflineMode={isOfflineMode}
                  audioQuality={audioQuality}
                  onPlay={(t) => onPlayTrack(t, likedTracks)}
                  onDownload={onDownloadTrack}
                  onSaveFileToDevice={onSaveFileToDevice}
                  onDeleteDownload={onDeleteDownload}
                  onToggleLike={onToggleLike}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
