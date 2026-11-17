import React from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { Track } from '../types/music';
import { CoverArtwork } from './CoverArtwork';

interface MiniPlayerProps {
  track: Track;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onExpand: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  track,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onNext,
  onExpand,
}) => {
  const effectiveDuration = duration > 0 ? duration : track.durationSec;
  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;

  return (
    <div
      data-testid="mini-player"
      className="fixed bottom-[calc(94px+env(safe-area-inset-bottom,0px))] sm:bottom-[82px] left-1/2 -translate-x-1/2 w-full max-w-md z-30 px-3"
    >
      <div className="relative rounded-xl overflow-hidden bg-[#1E293B]/90 backdrop-blur-md border border-[#334155]/50 shadow-xl">
        {/* 2px Top Progress Bar */}
        <div
          className="h-[2px] w-full bg-[#0B0F17]/85"
          role="progressbar"
          aria-label="Track playback progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
        >
          <div
            className="h-full bg-[#10B981] transition-[width] duration-150 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 h-[62px]">
          {/* Expand Trigger */}
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Open full-screen player for ${track.title}`}
            className="flex flex-1 min-w-0 items-center gap-3 text-left py-1 rounded-lg focus-visible:outline-2 focus-visible:outline-[#10B981]"
          >
            <CoverArtwork
              src={track.coverUrl}
              alt={`${track.album} cover art`}
              className="w-11 h-11 rounded-md"
              iconSize={18}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-[#F8FAFC] truncate leading-tight">
                {track.title}
              </p>
              <p className="text-[12px] text-[#94A3B8] truncate mt-0.5 leading-tight">
                {track.artist}
              </p>
            </div>
          </button>

          {/* Playback Controls */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#F8FAFC] hover:bg-[#0B0F17]/40 active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
            >
              {isPlaying ? (
                <Pause size={20} fill="currentColor" strokeWidth={1.75} />
              ) : (
                <Play size={20} fill="currentColor" strokeWidth={1.75} className="translate-x-[1px]" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#0B0F17]/40 active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[#10B981]"
            >
              <SkipForward size={19} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
