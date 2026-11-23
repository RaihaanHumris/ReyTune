import React, { useEffect, useState } from 'react';
import { Disc3 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export const BUNDLED_COVER_PHOTOS = [
  '/src/assets/images/cover_midnight_echoes_1794886924153.jpg',
  '/src/assets/images/cover_emerald_canopy_1794886924947.jpg',
  '/src/assets/images/cover_warm_cassette_1794886926901.jpg',
  '/src/assets/images/cover_vinyl_solitude_1794886925568.jpg',
  '/src/assets/images/cover_concrete_horizon_1794886925876.jpg',
  '/src/assets/images/cover_nordic_drift_1794886926549.jpg',
];

export function getFallbackCoverPhoto(seed = ''): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return BUNDLED_COVER_PHOTOS[hash % BUNDLED_COVER_PHOTOS.length];
}

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
  const [imgSrc, setImgSrc] = useState<string>(() => src || getFallbackCoverPhoto(alt));
  const [triedFallback, setTriedFallback] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setImgSrc(src || getFallbackCoverPhoto(alt));
    setTriedFallback(false);
    setHasError(false);
  }, [src, alt]);

  if (hasError) {
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
      src={imgSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => {
        if (!triedFallback) {
          setTriedFallback(true);
          setImgSrc(getFallbackCoverPhoto(alt));
        } else {
          setHasError(true);
        }
      }}
      className={`object-cover shrink-0 bg-[#1E293B] ${className}`}
    />
  );
};

interface TrackPhotoBackgroundProps {
  coverUrl?: string;
  trackId?: string;
  title?: string;
  isPlaying?: boolean;
  variant?: 'fullscreen' | 'shell' | 'mini' | 'row';
}

export const TrackPhotoBackground: React.FC<TrackPhotoBackgroundProps> = ({
  coverUrl,
  trackId = '',
  title = '',
  isPlaying = false,
  variant = 'fullscreen',
}) => {
  const seed = `${trackId}-${title}`;
  const [activeSrc, setActiveSrc] = useState<string>(
    () => coverUrl || getFallbackCoverPhoto(seed)
  );
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    setActiveSrc(coverUrl || getFallbackCoverPhoto(seed));
    setTriedFallback(false);
  }, [coverUrl, seed]);

  const handleImgError = () => {
    if (!triedFallback) {
      setTriedFallback(true);
      setActiveSrc(getFallbackCoverPhoto(seed));
    }
  };

  if (variant === 'mini') {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden z-0"
      >
        <AnimatePresence mode="sync">
          <motion.img
            key={activeSrc}
            src={activeSrc}
            alt=""
            referrerPolicy="no-referrer"
            onError={handleImgError}
            initial={{ opacity: 0 }}
            animate={{
              opacity: isPlaying ? 0.65 : 0.45,
              scale: isPlaying ? 1.18 : 1.08,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="w-full h-full object-cover blur-md saturate-150"
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0F17]/70 via-[#0B0F17]/50 to-[#0B0F17]/70 backdrop-blur-[10px]" />
      </div>
    );
  }

  if (variant === 'row') {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl z-0"
      >
        <img
          src={activeSrc}
          alt=""
          referrerPolicy="no-referrer"
          onError={handleImgError}
          className={`w-full h-full object-cover blur-md saturate-150 transition-transform duration-700 ${
            isPlaying ? 'scale-115 opacity-50' : 'scale-105 opacity-35'
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0F17]/80 via-[#0B0F17]/60 to-[#0B0F17]/75 backdrop-blur-[8px]" />
      </div>
    );
  }

  if (variant === 'shell') {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 mx-auto max-w-md overflow-hidden z-0"
      >
        <AnimatePresence mode="sync">
          <motion.div
            key={activeSrc}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            {/* Full-screen ambient blurred cover photo */}
            <img
              src={activeSrc}
              alt=""
              referrerPolicy="no-referrer"
              onError={handleImgError}
              className={`w-full h-full object-cover blur-2xl saturate-150 transition-all duration-1000 ${
                isPlaying ? 'scale-125 opacity-55' : 'scale-110 opacity-30'
              }`}
            />
            {/* Upper recognizable song photo focal layer */}
            <img
              src={activeSrc}
              alt=""
              referrerPolicy="no-referrer"
              onError={handleImgError}
              className={`absolute inset-x-0 top-0 w-full h-[58%] object-cover blur-[4px] saturate-125 transition-all duration-1000 ${
                isPlaying ? 'scale-105 opacity-45' : 'scale-100 opacity-22'
              }`}
              style={{
                maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 100%)',
              }}
            />
          </motion.div>
        </AnimatePresence>

        {/* Measured glass scrim so all list items and text remain crisp */}
        <div
          className={`absolute inset-0 transition-colors duration-700 ${
            isPlaying
              ? 'bg-gradient-to-b from-[#0B0F17]/45 via-[#0B0F17]/68 to-[#0B0F17]/88'
              : 'bg-gradient-to-b from-[#0B0F17]/65 via-[#0B0F17]/80 to-[#0B0F17]/94'
          }`}
        />
      </div>
    );
  }

  // Default: 'fullscreen' (FullScreenPlayer Now Playing & Lyrics view)
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden z-0"
    >
      <AnimatePresence mode="sync">
        <motion.div
          key={activeSrc}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.75, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {/* Base full-bleed saturated photo aura */}
          <img
            src={activeSrc}
            alt=""
            referrerPolicy="no-referrer"
            onError={handleImgError}
            className={`w-full h-full object-cover blur-2xl saturate-150 transition-transform duration-1000 ${
              isPlaying ? 'scale-125 opacity-85' : 'scale-110 opacity-65'
            }`}
          />
          {/* Direct recognizable song photo background layer */}
          <img
            src={activeSrc}
            alt=""
            referrerPolicy="no-referrer"
            onError={handleImgError}
            className={`absolute inset-0 w-full h-full object-cover blur-[3px] saturate-125 transition-all duration-1000 ${
              isPlaying ? 'scale-105 opacity-60' : 'scale-100 opacity-42'
            }`}
          />
        </motion.div>
      </AnimatePresence>

      {/* Dynamic glass contrast scrim over the song photo */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B0F17]/40 via-[#0B0F17]/52 to-[#0B0F17]/82" />
      <div className="absolute inset-0 backdrop-blur-[6px]" />
    </div>
  );
};

