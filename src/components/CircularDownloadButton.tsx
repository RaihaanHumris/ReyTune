import React from 'react';
import { ArrowDownToLine, Check } from 'lucide-react';

interface CircularDownloadButtonProps {
  trackTitle: string;
  isDownloaded: boolean;
  progress: number | undefined;
  isOfflineMode: boolean;
  onDownload: () => void;
}

export const CircularDownloadButton: React.FC<CircularDownloadButtonProps> = ({
  trackTitle,
  isDownloaded,
  progress,
  isOfflineMode,
  onDownload,
}) => {
  const isDownloading = typeof progress === 'number' && progress < 100;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = isDownloading
    ? circumference - (progress / 100) * circumference
    : circumference;

  if (isDownloading) {
    return (
      <div
        className="relative flex items-center justify-center min-h-[44px] min-w-[44px]"
        role="progressbar"
        aria-label={`Downloading ${trackTitle}: ${progress}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="#1E293B"
            strokeWidth="2.5"
          />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
            className="transition-[stroke-dashoffset] duration-100 ease-linear"
          />
        </svg>
        <span className="absolute text-[9px] font-mono tabular-nums font-semibold text-[#10B981]">
          {progress}%
        </span>
      </div>
    );
  }

  if (isDownloaded) {
    return (
      <span
        className="flex items-center justify-center w-8 h-8 rounded-full bg-[#10B981]/15 text-[#10B981]"
        title="Downloaded for offline playback"
        aria-label={`${trackTitle} downloaded`}
      >
        <Check size={15} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onDownload}
      disabled={isOfflineMode}
      aria-label={`Download ${trackTitle}`}
      title={isOfflineMode ? 'Switch to Online Mode to download' : `Download ${trackTitle}`}
      className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#10B981]"
    >
      <ArrowDownToLine size={18} strokeWidth={2} />
    </button>
  );
};
