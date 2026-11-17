import { AudioQuality, RepeatMode, StorageStats, Track } from '../types/music';

export const DEFAULT_STORAGE_CAPACITY_MB = 250;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getQualityMultiplier(quality: AudioQuality): number {
  switch (quality) {
    case '320':
      return 1.25;
    case '192':
      return 1.0;
    case '96':
      return 0.6;
  }
}

export function getEffectiveTrackSizeMb(track: Track, quality: AudioQuality): number {
  const scaled = track.fileSizeMb * getQualityMultiplier(quality);
  return Math.round(scaled * 10) / 10;
}

export function calculateStorageStats(
  tracks: Track[],
  downloadedIds: Set<string>,
  quality: AudioQuality = '192',
  capacityMb: number = DEFAULT_STORAGE_CAPACITY_MB
): StorageStats {
  let usedMb = 0;
  let downloadedCount = 0;

  for (const track of tracks) {
    if (downloadedIds.has(track.id)) {
      usedMb += getEffectiveTrackSizeMb(track, quality);
      downloadedCount += 1;
    }
  }

  const roundedUsed = Math.round(usedMb * 10) / 10;
  const usagePercent = capacityMb > 0 ? Math.min(100, Math.round((roundedUsed / capacityMb) * 1000) / 10) : 0;

  return {
    downloadedCount,
    usedMb: roundedUsed,
    capacityMb,
    usagePercent,
  };
}

export function filterTracks(
  tracks: Track[],
  query: string,
  options: { offlineOnly?: boolean; downloadedIds?: Set<string> } = {}
): Track[] {
  const normalizedQuery = query.trim().toLowerCase();
  const { offlineOnly = false, downloadedIds } = options;

  return tracks.filter((track) => {
    if (offlineOnly && downloadedIds && !downloadedIds.has(track.id)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return (
      track.title.toLowerCase().includes(normalizedQuery) ||
      track.artist.toLowerCase().includes(normalizedQuery) ||
      track.album.toLowerCase().includes(normalizedQuery) ||
      track.genre.toLowerCase().includes(normalizedQuery)
    );
  });
}

export function cycleRepeatMode(current: RepeatMode): RepeatMode {
  if (current === 'off') return 'all';
  if (current === 'all') return 'one';
  return 'off';
}

export function canPlayTrack(
  trackId: string,
  isOfflineMode: boolean,
  downloadedIds: Set<string>
): { allowed: boolean; reason?: string } {
  if (!isOfflineMode) {
    return { allowed: true };
  }
  if (downloadedIds.has(trackId)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Lagu belum diunduh. Unduh saat online untuk memutar offline.',
  };
}

export function getNextTrackIndex(params: {
  currentIndex: number;
  queueLength: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  direction: 'next' | 'prev';
  randomFn?: () => number;
}): number | null {
  const {
    currentIndex,
    queueLength,
    repeatMode,
    shuffle,
    direction,
    randomFn = Math.random,
  } = params;

  if (queueLength <= 0) return null;
  if (queueLength === 1) {
    return repeatMode === 'off' && direction === 'next' ? null : 0;
  }

  if (repeatMode === 'one' && direction === 'next') {
    return currentIndex >= 0 ? currentIndex : 0;
  }

  if (shuffle) {
    const candidates: number[] = [];
    for (let i = 0; i < queueLength; i++) {
      if (i !== currentIndex) candidates.push(i);
    }
    const pick = Math.floor(randomFn() * candidates.length);
    return candidates[Math.min(pick, candidates.length - 1)];
  }

  if (direction === 'next') {
    if (currentIndex + 1 < queueLength) {
      return currentIndex + 1;
    }
    return repeatMode === 'all' ? 0 : null;
  }

  // direction === 'prev'
  if (currentIndex - 1 >= 0) {
    return currentIndex - 1;
  }
  return repeatMode === 'all' ? queueLength - 1 : 0;
}
