import React, { useState } from 'react';
import { Check, ListMusic, Plus, X } from 'lucide-react';
import { Playlist, Track } from '../types/music';

interface PlaylistPickerModalProps {
  track: Track | null;
  playlists: Playlist[];
  onClose: () => void;
  onToggleTrackInPlaylist: (playlistId: string, trackId: string) => void;
  onCreatePlaylist: (name: string, initialTrackId?: string) => void;
}

export const PlaylistPickerModal: React.FC<PlaylistPickerModalProps> = ({
  track,
  playlists,
  onClose,
  onToggleTrackInPlaylist,
  onCreatePlaylist,
}) => {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  if (!track) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('Enter a playlist name');
      return;
    }
    onCreatePlaylist(trimmed, track.id);
    setNewName('');
    setError('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${track.title} to playlist`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md"
    >
      <div className="w-full max-w-md rounded-t-3xl dynamic-glass-elevated p-5 pb-7">
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" aria-hidden="true" />

        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#F8FAFC]">Add to Playlist</h3>
            <p className="text-xs text-[#94A3B8] truncate">{track.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close playlist picker"
            className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.08]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-1.5 max-h-56 overflow-y-auto mb-4">
          {playlists.map((pl) => {
            const includesTrack = pl.trackIds.includes(track.id);
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => onToggleTrackInPlaylist(pl.id, track.id)}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 min-h-[48px] rounded-xl bg-[#0B0F17]/60 hover:bg-[#1E293B] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ListMusic size={18} className="text-[#94A3B8] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#F8FAFC] truncate">{pl.name}</p>
                    <p className="text-xs text-[#94A3B8] tabular-nums">
                      {pl.trackIds.length} {pl.trackIds.length === 1 ? 'track' : 'tracks'}
                    </p>
                  </div>
                </div>
                {includesTrack && (
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#10B981]/20 text-[#10B981] shrink-0">
                    <Check size={14} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleCreate} className="space-y-2 border-t border-[#1E293B] pt-4">
          <label htmlFor="quick-playlist-name" className="block text-xs font-medium text-[#94A3B8]">
            Create New Playlist
          </label>
          <div className="flex items-center gap-2">
            <input
              id="quick-playlist-name"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (error) setError('');
              }}
              placeholder="e.g. Weekend Roadtrip"
              className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#0B0F17] border border-[#1E293B] text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/60 focus:outline-none focus:border-[#10B981]"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 h-11 px-4 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus size={16} />
              <span>Create</span>
            </button>
          </div>
          {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        </form>
      </div>
    </div>
  );
};
