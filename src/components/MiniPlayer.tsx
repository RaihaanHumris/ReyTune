import React from 'react';
import { Mic2, Pause, Play, SkipForward } from 'lucide-react';
import { Track } from '../types/music';
import { CoverArtwork, TrackPhotoBackground } from './CoverArtwork';

interface MiniPlayerProps {
  track: Track;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onExpand: () => void;
  onOpenLyrics?: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  track,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onNext,
  onExpand,
  onOpenLyrics,
}) => {
  const effectiveDuration = duration > 0 ? duration : track.durationSec;
  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;

  return (
    <div
      data-testid="mini-player"
      className="fixed bottom-[calc(92px+env(safe-area-inset-bottom,0px))] sm:bottom-[82px] left-1/2 -translate-x-1/2 w-full max-w-md z-30 px-3"
    >
      <div className="relative rounded-2xl overflow-hidden dynamic-glass-elevated">
        {/* Live Song Photo Background behind Dynamic Glass MiniPlayer */}
        <TrackPhotoBackground
          coverUrl={track.coverUrl}
          trackId={track.id}
          title={track.title}
          isPlaying={isPlaying}
          variant="mini"
        />

        {/* 2px Top Progress Bar with Luminous Accent */}
        <div
          className="relative z-10 h-[2px] w-full bg-white/[0.08]"
          role="progressbar"
          aria-label="Track playback progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
        >
          <div
            className="h-full bg-gradient-to-r from-[#10B981] to-[#34D399] shadow-[0_0_8px_rgba(16,185,129,0.75)] transition-[width] duration-150 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="relative z-10 flex items-center justify-between gap-2 px-2.5 h-[62px]">
          {/* Expand Trigger */}
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Open full-screen player for ${track.title}`}
            className="flex flex-1 min-w-0 items-center gap-3 text-left py-1 rounded-xl focus-visible:outline-2 focus-visible:outline-[#10B981]"
          >
            <div className="relative shrink-0 rounded-lg overflow-hidden ring-1 ring-white/15 shadow-md shadow-black/40">
              <CoverArtwork
                src={track.coverUrl}
                alt={`${track.album} cover art`}
                className="w-11 h-11 rounded-lg"
                iconSize={18}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[#F8FAFC] truncate leading-tight">
                {track.title}
              </p>
              <p className="text-[12px] text-[#CBD5E1]/80 truncate mt-0.5 leading-tight">
                {track.artist}
              </p>
            </div>
          </button>

          {/* Playback & Lyrics Controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            {onOpenLyrics && (
              <button
                type="button"
                onClick={onOpenLyrics}
                aria-label={`Buka lirik lagu ${track.title}`}
                title="Lirik Lagu"
                className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full text-[#CBD5E1] hover:text-[#10B981] hover:bg-white/[0.08] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
              >
                <Mic2 size={17} strokeWidth={2} />
              </button>
            )}

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
              className="flex items-center justify-center min-h-[42px] min-w-[42px] rounded-full bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.14] text-[#F8FAFC] shadow-sm active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
            >
              {isPlaying ? (
                <Pause size={19} fill="currentColor" strokeWidth={1.75} />
              ) : (
                <Play size={19} fill="currentColor" strokeWidth={1.75} className="translate-x-[1px]" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              className="flex items-center justify-center min-h-[42px] min-w-[42px] rounded-full text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-white/[0.08] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
            >
              <SkipForward size={19} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
