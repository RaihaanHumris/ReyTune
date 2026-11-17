import { INITIAL_DOWNLOADED_IDS, INITIAL_LIKED_IDS, INITIAL_PLAYLISTS } from '../data/tracks';
import { AudioQuality, Playlist } from '../types/music';

const STORAGE_KEYS = {
  DOWNLOADED: 'offlinetune_downloaded_ids_v5',
  LIKED: 'offlinetune_liked_ids_v5',
  PLAYLISTS: 'offlinetune_playlists_v5',
  QUALITY: 'offlinetune_audio_quality_v1',
  OFFLINE_SIM: 'offlinetune_offline_mode_v1',
  DRIVE_URL: 'reytune_custom_drive_url_v1',
} as const;

const AUDIO_CACHE_NAME = 'offlinetune-audio-v1';

export function loadPersistedDriveFolderUrl(defaultUrl: string): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DRIVE_URL);
    return raw && raw.trim() ? raw.trim() : defaultUrl;
  } catch {
    return defaultUrl;
  }
}

export function savePersistedDriveFolderUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DRIVE_URL, url.trim());
  } catch {
    // Ignore storage errors
  }
}

export function loadPersistedDownloadedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOWNLOADED);
    if (!raw) return INITIAL_DOWNLOADED_IDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_DOWNLOADED_IDS;
  } catch {
    return INITIAL_DOWNLOADED_IDS;
  }
}

export function savePersistedDownloadedIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DOWNLOADED, JSON.stringify(ids));
  } catch {
    // Ignore quota errors in private mode
  }
}

export function loadPersistedLikedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIKED);
    if (!raw) return INITIAL_LIKED_IDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_LIKED_IDS;
  } catch {
    return INITIAL_LIKED_IDS;
  }
}

export function savePersistedLikedIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LIKED, JSON.stringify(ids));
  } catch {
    // Ignore storage errors
  }
}

export function loadPersistedPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
    if (!raw) return INITIAL_PLAYLISTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_PLAYLISTS;
  } catch {
    return INITIAL_PLAYLISTS;
  }
}

export function savePersistedPlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
  } catch {
    // Ignore storage errors
  }
}

export function loadPersistedQuality(): AudioQuality {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.QUALITY);
    if (raw === '320' || raw === '192' || raw === '96') {
      return raw;
    }
    return '192';
  } catch {
    return '192';
  }
}

export function savePersistedQuality(quality: AudioQuality): void {
  try {
    localStorage.setItem(STORAGE_KEYS.QUALITY, quality);
  } catch {
    // Ignore storage errors
  }
}

export async function cacheTrackAudioOffline(audioUrl: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const existing = await cache.match(audioUrl);
    if (!existing) {
      await cache.add(audioUrl);
    }
  } catch {
    // Graceful fallback if Cache API is blocked or offline
  }
}

export async function removeCachedTrackAudio(audioUrl: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    await cache.delete(audioUrl);
  } catch {
    // Ignore cache delete errors
  }
}

export async function clearAllCachedAudio(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(AUDIO_CACHE_NAME);
  } catch {
    // Ignore cache clear errors
  }
}
