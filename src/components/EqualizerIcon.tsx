import React from 'react';

interface EqualizerIconProps {
  isPlaying: boolean;
  className?: string;
}

export const EqualizerIcon: React.FC<EqualizerIconProps> = ({ isPlaying, className = '' }) => {
  return (
    <span
      className={`inline-flex items-end gap-[2.5px] h-3.5 w-3.5 justify-center ${className}`}
      aria-hidden="true"
    >
      <span
        className={`w-[2.5px] h-full rounded-full bg-[#10B981] ${
          isPlaying ? 'eq-bar-1' : 'scale-y-50 opacity-80'
        }`}
      />
      <span
        className={`w-[2.5px] h-full rounded-full bg-[#10B981] ${
          isPlaying ? 'eq-bar-2' : 'scale-y-75 opacity-80'
        }`}
      />
      <span
        className={`w-[2.5px] h-full rounded-full bg-[#10B981] ${
          isPlaying ? 'eq-bar-3' : 'scale-y-40 opacity-80'
        }`}
      />
    </span>
  );
};
