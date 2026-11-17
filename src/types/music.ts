export type RepeatMode = 'off' | 'all' | 'one';

export type AudioQuality = '320' | '192' | '96';

export type NavTab = 'explore' | 'library' | 'settings';

export type LibraryTab = 'downloads' | 'playlists' | 'liked';

export type TrackSource =
  | 'gdrive'
  | 'ytmusic'
  | 'audius'
  | 'deezer'
  | 'itunes'
  | 'local';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  durationSec: number;
  fileSizeMb: number;
  coverUrl: string;
  audioUrl: string;
  driveFileId?: string;
  youtubeVideoId?: string;
  source?: TrackSource;
  isPreview?: boolean;
  featured?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface StorageStats {
  downloadedCount: number;
  usedMb: number;
  capacityMb: number;
  usagePercent: number;
}
