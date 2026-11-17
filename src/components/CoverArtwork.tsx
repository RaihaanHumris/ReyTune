import React, { useState } from 'react';
import { Disc3 } from 'lucide-react';

interface CoverArtworkProps {
  src: string;
  alt: string;
  className?: string;
  iconSize?: number;
}

export const CoverArtwork: React.FC<CoverArtworkProps> = ({
  src,
  alt,
  className = 'w-12 h-12 rounded-lg',
  iconSize = 20,
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-[#1E293B] to-[#0B0F17] border border-[#1E293B] text-[#10B981] shrink-0 ${className}`}
        aria-label={alt}
      >
        <Disc3 size={iconSize} strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`object-cover shrink-0 bg-[#1E293B] ${className}`}
    />
  );
};
