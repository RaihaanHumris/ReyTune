import type { Track } from '../types/music';

export interface RawAudiusTrack {
  id?: string | number;
  track_id?: string | number;
  title?: string;
  genre?: string;
  duration?: number;
  artwork?: Record<string, string> | null;
  user?: {
    name?: string;
    handle?: string;
  } | null;
}

export interface RawHearthisTrack {
  id?: string | number;
  title?: string;
  duration?: string | number;
  stream_url?: string;
  artwork_url_retina?: string;
  artwork_url?: string;
  thumb?: string;
  genre?: string;
  user?: {
    username?: string;
  } | null;
}

const FALLBACK_COVERS = [
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1539375665275-f9de415ef9ac?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=600&q=80',
];

export function estimateMp3SizeMb(durationSec: number): number {
  const safeDur = Math.max(10, Number.isFinite(durationSec) ? durationSec : 210);
  return Math.round(((safeDur * 24) / 1024) * 10) / 10;
}

export function normalizeAudiusTrack(raw: RawAudiusTrack): Track | null {
  const rawId = raw.id ?? raw.track_id;
  if (!rawId || !raw.title) return null;
  const idStr = String(rawId);
  const durationSec = Math.max(90, Math.round(Number(raw.duration) || 210));
  const coverUrl =
    raw.artwork?.['480x480'] ||
    raw.artwork?.['1000x1000'] ||
    raw.artwork?.['150x150'] ||
    FALLBACK_COVERS[0];

  const cleanTitle = raw.title
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();

  return {
    id: `audius-${idStr}`,
    title: cleanTitle || raw.title.trim(),
    artist:
      raw.user?.name?.trim() ||
      raw.user?.handle?.trim() ||
      'Independent Artist',
    album: raw.genre ? `${raw.genre} Release` : 'ReyTune Full Stream',
    genre: raw.genre?.trim() || 'Trending Music',
    durationSec,
    fileSizeMb: estimateMp3SizeMb(durationSec),
    coverUrl,
    audioUrl: `https://api.audius.co/v1/tracks/${encodeURIComponent(idStr)}/stream?app_name=ReyTune`,
    source: 'audius',
    isPreview: false,
  };
}

export function normalizeHearthisTrack(raw: RawHearthisTrack): Track | null {
  const rawId = raw.id;
  const rawTitle = String(raw.title || '').trim();
  const dur = Math.round(Number(raw.duration || 0));
  if (!rawId || !rawTitle || !raw.stream_url || dur < 90 || dur > 540) {
    return null;
  }

  const norm = rawTitle
    .replace(/\s+[–~]\s+/g, ' - ')
    .replace(/^\d+\s*-?\s*/, '')
    .trim();
  let artist = raw.user?.username?.trim() || 'YouTube Music & Online';
  let title = norm;

  if (norm.includes(' - ')) {
    const parts = norm.split(' - ').map((s) => s.trim());
    artist = parts[0] || artist;
    title = parts
      .slice(1)
      .join(' - ')
      .replace(/\(OST.*?\)/gi, '')
      .replace(/\(Official.*?\)/gi, '')
      .replace(/\(Live.*?\)/gi, '')
      .trim();
  }

  const coverUrl =
    raw.artwork_url_retina ||
    raw.artwork_url ||
    raw.thumb ||
    FALLBACK_COVERS[1];

  return {
    id: `ytm-ht-${rawId}`,
    title: title || norm,
    artist,
    album: `${artist} - Online MP3`,
    genre: raw.genre?.trim() || 'YouTube Music',
    durationSec: dur,
    fileSizeMb: estimateMp3SizeMb(dur),
    coverUrl,
    audioUrl: raw.stream_url,
    source: 'ytmusic',
    isPreview: false,
  };
}

export function parseYouTubeMusicSearchResponse(
  data: unknown,
  maxItems = 25
): Track[] {
  const items: Track[] = [];
  const seenIds = new Set<string>();

  function walk(node: unknown) {
    if (!node || typeof node !== 'object' || items.length >= maxItems) return;
    const obj = node as Record<string, unknown>;

    if (
      obj.musicResponsiveListItemRenderer &&
      typeof obj.musicResponsiveListItemRenderer === 'object'
    ) {
      const r = obj.musicResponsiveListItemRenderer as Record<string, any>;
      const videoId = String(r.playlistItemData?.videoId || '').trim();
      const thumbs: Array<{ url?: string }> =
        r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const rawThumb = thumbs[thumbs.length - 1]?.url || FALLBACK_COVERS[2];
      const coverUrl = rawThumb.replace(/=w\d+-h\d+/, '=w544-h544');

      const cols: Array<any> = r.flexColumns || [];
      const title = String(
        cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.text || ''
      ).trim();
      const metaRuns: Array<{ text?: string }> =
        cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artist =
        String(metaRuns[0]?.text || 'YouTube Music Artist').trim() ||
        'YouTube Music Artist';
      const album =
        String(metaRuns[2]?.text || `${artist} - YouTube Music`).trim() ||
        `${artist} - YouTube Music`;
      const lastRun = String(metaRuns[metaRuns.length - 1]?.text || '').trim();

      let durationSec = 218;
      if (/^\d+:\d+$/.test(lastRun)) {
        const [m, s] = lastRun.split(':').map(Number);
        if (Number.isFinite(m) && Number.isFinite(s)) {
          durationSec = Math.max(60, m * 60 + s);
        }
      }

      if (videoId && title && !seenIds.has(videoId)) {
        seenIds.add(videoId);
        items.push({
          id: `ytm-${videoId}`,
          youtubeVideoId: videoId,
          title,
          artist,
          album,
          genre: 'YouTube Music',
          durationSec,
          fileSizeMb: estimateMp3SizeMb(durationSec),
          coverUrl,
          audioUrl: `/api/music/ytm-audio?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
          source: 'ytmusic',
          isPreview: false,
        });
      }
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key]);
      if (items.length >= maxItems) break;
    }
  }

  walk(data);
  return items;
}

export function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{15,})/);
  if (fileMatch?.[1]) return fileMatch[1];
  return null;
}

export function extractDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || extractDriveFileId(trimmed)) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
  if (folderMatch?.[1]) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  if (idParamMatch?.[1]) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) return trimmed;
  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function parseDriveEmbeddedFolderHtml(
  html: string
): { fileId: string; fileName: string }[] {
  const results: { fileId: string; fileName: string }[] = [];
  const regex =
    /id="entry-([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const fileId = match[1]?.trim();
    const rawName = decodeHtmlEntities(match[2]?.trim() || '');
    if (!fileId || !rawName) continue;
    if (!/\.(mp3|m4a|wav|ogg|flac)$/i.test(rawName)) continue;
    if (rawName === 'audio1645293506.m4a') continue;
    results.push({ fileId, fileName: rawName });
  }
  return results;
}

export function parseDriveAudioFilename(fileName: string): {
  title: string;
  artist: string;
  genre: string;
} {
  let base = fileName.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '').trim();
  base = base.replace(/\s*\(\d+\)\s*$/, '').trim();

  if (
    base.startsWith('DJ ') ||
    /VIRAL TIKTOK|REMIX|MASHUP|Thailand Edit/i.test(base)
  ) {
    const parts = base.split(' - ').map((s) => s.trim());
    if (parts.length >= 2) {
      return {
        title: parts[0].replace(/🔥|🚨/g, '').trim(),
        artist: parts
          .slice(1)
          .join(' - ')
          .replace(/🔥|🚨/g, '')
          .trim(),
        genre: 'Viral TikTok',
      };
    }
    return {
      title: base.replace(/🔥|🚨/g, '').trim(),
      artist: 'DJ Viral TikTok Remix',
      genre: 'Viral TikTok',
    };
  }

  if (base.includes(' - ')) {
    const parts = base.split(' - ').map((s) => s.trim());
    let artist = parts[0] || 'ReyTune Collection';
    let title = (parts[1] || base)
      .replace(/\(Official.*?\)/gi, '')
      .replace(/\[Official.*?\]/gi, '')
      .replace(/\(Lirik.*?\)/gi, '')
      .replace(/\(Lyrics.*?\)/gi, '')
      .replace(/Official Lyric Video/gi, '')
      .replace(/Official Music Video/gi, '')
      .replace(/\.OMV$/i, '')
      .trim();

    if (artist.toUpperCase() === 'TULUS') artist = 'Tulus';
    const indoArtists =
      /Tulus|Raim Laode|Nadhif|Juicy Luicy|Judika|Sal Priadi|Bagindas|Lyla|Keisya|Mahen|Rony Parulian|Samuel Cipta|Anggis Devaki|Denny Caknan|NOAH|ILIR7|Hal|HAL|Khifnu|Overnight|Piche Kota|eńau|eńau|Armada|Fiersa Besari|Ungu|Idgitaf|Misellia/i;
    return {
      title: title || base,
      artist,
      genre: indoArtists.test(artist) ? 'Lagu Indo' : 'Barat Hits',
    };
  }

  return {
    title: base,
    artist: 'ReyTune Collection',
    genre: 'Lagu Indo',
  };
}

export function normalizeDriveTrack(
  fileId: string,
  fileName: string,
  index = 0
): Track {
  const parsed = parseDriveAudioFilename(fileName);
  const durationSec = 225;
  return {
    id: `gdrive-${fileId}`,
    driveFileId: fileId,
    title: parsed.title,
    artist: parsed.artist,
    album: `${parsed.artist} Single`,
    genre: parsed.genre,
    durationSec,
    fileSizeMb: estimateMp3SizeMb(durationSec),
    coverUrl: FALLBACK_COVERS[index % FALLBACK_COVERS.length],
    audioUrl: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    source: 'gdrive',
    isPreview: false,
  };
}

export function isSafeAudioProxyUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sanitizeDownloadFilename(title: string, artist: string): string {
  const raw = `${artist} - ${title}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim();
  const safe = raw.slice(0, 80) || 'reytune-track';
  return `${safe}.mp3`;
}
