import type { Track } from '../types/music.ts';

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

export interface RawJamendoTrack {
  id?: string | number;
  name?: string;
  duration?: number | string;
  artist_id?: string | number;
  artist_name?: string;
  album_name?: string;
  album_id?: string | number;
  license_ccurl?: string;
  releasedate?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  musicinfo?: {
    tags?: {
      genres?: string[];
      instruments?: string[];
      vartags?: string[];
    };
  };
}

export interface RawRadioStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  state?: string;
  bitrate?: number;
  codec?: string;
}

export interface RawOpenverseTrack {
  id?: string;
  title?: string;
  creator?: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  source?: string;
  license?: string;
  license_version?: string;
  genres?: string[];
  tags?: Array<{ name?: string }>;
  audio_set?: {
    title?: string;
    thumbnail?: string;
  } | null;
}

export interface RawArchiveFile {
  name?: string;
  title?: string;
  creator?: string;
  album?: string;
  length?: string | number;
  size?: string | number;
  format?: string;
}

export interface RawItunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

const SPAM_TITLE_REGEX =
  /\b(slot\s*online|agen\s*slot|situs\s*slot|slot\s*gacor|gacor\s*hari\s*ini|togel|judi\s*online|sbobet|maxwin|depo\s*\d+|bo\s*togel|pragmatic\s*play|rtp\s*live|bola88|naga169|zeus\s*slot)\b/i;

export interface SyncedLyricLine {
  timeSec: number;
  text: string;
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

export function normalizeHearthisTrack(
  raw: RawHearthisTrack,
  options?: { source?: 'ytmusic' | 'hearthis'; maxDurationSec?: number }
): Track | null {
  const rawId = raw.id;
  const rawTitle = String(raw.title || '').trim();
  const dur = Math.round(Number(raw.duration || 0));
  const maxDur = options?.maxDurationSec ?? 540;
  if (!rawId || !rawTitle || !raw.stream_url || dur < 60 || dur > maxDur) {
    return null;
  }
  if (SPAM_TITLE_REGEX.test(rawTitle)) {
    return null;
  }

  const norm = rawTitle
    .replace(/\s+[–~]\s+/g, ' - ')
    .replace(/^\d+\s*-?\s*/, '')
    .trim();
  const trackSource = options?.source ?? 'ytmusic';
  let artist =
    raw.user?.username?.trim() ||
    (trackSource === 'hearthis' ? 'Hearthis Artist' : 'YouTube Music & Online');
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
    id: trackSource === 'hearthis' ? `hearthis-${rawId}` : `ytm-ht-${rawId}`,
    title: title || norm,
    artist,
    album: `${artist} - Online MP3`,
    genre: raw.genre?.trim() || (trackSource === 'hearthis' ? 'Hearthis Mix' : 'YouTube Music'),
    durationSec: dur,
    fileSizeMb: estimateMp3SizeMb(dur),
    coverUrl,
    audioUrl: raw.stream_url.replace(/^https:\/\/hearthis\.app\//i, 'https://hearthis.at/'),
    source: trackSource,
    isPreview: false,
  };
}

export function normalizeOpenverseTrack(
  raw: RawOpenverseTrack,
  index = 0
): Track | null {
  const id = String(raw.id || '').trim();
  const rawTitle = String(raw.title || '').trim();
  const audioUrl = String(raw.url || '').trim();
  if (!id || !rawTitle || !audioUrl.startsWith('https://')) return null;

  // Openverse returns duration in milliseconds
  const rawDurMs = Number(raw.duration || 0);
  const durationSec =
    rawDurMs > 1000
      ? Math.round(rawDurMs / 1000)
      : rawDurMs > 0
      ? Math.round(rawDurMs)
      : 195;

  if (durationSec < 45 || durationSec > 900) return null;

  const creator = String(raw.creator || '').trim() || 'Creative Commons Artist';
  let title = rawTitle;
  // Strip redundant "Artist - " prefix when creator matches
  if (
    creator !== 'Creative Commons Artist' &&
    title.toLowerCase().startsWith(`${creator.toLowerCase()} - `)
  ) {
    title = title.slice(creator.length + 3).trim() || rawTitle;
  }

  const rawGenre =
    raw.genres?.[0]?.trim() ||
    raw.tags?.find((t) => t.name && t.name.length > 2)?.name?.trim() ||
    'Free CC Music';
  const genre = rawGenre.charAt(0).toUpperCase() + rawGenre.slice(1);

  const coverUrl =
    (raw.thumbnail && raw.thumbnail.startsWith('https://') ? raw.thumbnail : '') ||
    (raw.audio_set?.thumbnail && raw.audio_set.thumbnail.startsWith('https://')
      ? raw.audio_set.thumbnail
      : '') ||
    FALLBACK_COVERS[index % FALLBACK_COVERS.length];

  const isJamendo = raw.source === 'jamendo' || audioUrl.includes('jamendo.com');
  const licenseLabel = raw.license
    ? `CC ${raw.license.toUpperCase()}${raw.license_version ? ` ${raw.license_version}` : ''}`
    : 'Creative Commons';

  return {
    id: `openverse-${id}`,
    title,
    artist: creator,
    album: raw.audio_set?.title?.trim() || (isJamendo ? 'Jamendo Free CC' : 'Openverse Free Audio'),
    genre,
    durationSec,
    fileSizeMb: estimateMp3SizeMb(durationSec),
    coverUrl,
    audioUrl,
    source: isJamendo ? 'jamendo' : 'openverse',
    license: licenseLabel,
    isPreview: false,
  };
}

export function parseArchiveDuration(raw: string | number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  const str = String(raw || '').trim();
  if (!str) return 0;
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    return Math.round(Number(str));
  }
  const parts = str.split(':').map(Number);
  if (parts.every((n) => Number.isFinite(n))) {
    if (parts.length === 2) return parts[0] * 60 + Math.round(parts[1]);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + Math.round(parts[2]);
  }
  return 0;
}

export function normalizeArchiveTrack(
  identifier: string,
  file: RawArchiveFile,
  fallbackMeta: { title?: string; creator?: string; album?: string },
  index = 0
): Track | null {
  const fileName = String(file.name || '').trim();
  if (!identifier || !fileName || !/\.mp3$/i.test(fileName)) return null;

  const sizeBytes = Number(file.size || 0);
  if (sizeBytes > 0 && (sizeBytes < 300_000 || sizeBytes > 30 * 1024 * 1024)) {
    return null;
  }

  const parsedDur = parseArchiveDuration(file.length);
  const durationSec =
    parsedDur >= 45 && parsedDur <= 900
      ? parsedDur
      : sizeBytes > 0
      ? Math.max(60, Math.min(600, Math.round((sizeBytes * 8) / 160_000)))
      : 210;

  const cleanFileName = fileName
    .split('/')
    .pop()!
    .replace(/\.mp3$/i, '')
    .replace(/^\d+[\s._-]+/, '')
    .replace(/_/g, ' ')
    .trim();

  const title = (file.title || '').trim() || cleanFileName || fallbackMeta.title || identifier;
  const artist =
    (file.creator || '').trim() ||
    (Array.isArray(fallbackMeta.creator)
      ? fallbackMeta.creator[0]
      : fallbackMeta.creator || ''
    ).trim() ||
    'Internet Archive Artist';
  const album =
    (file.album || '').trim() || (fallbackMeta.title || 'Internet Archive Audio').trim();

  const encodedPath = fileName
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const audioUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedPath}`;
  const coverUrl = `https://archive.org/services/img/${encodeURIComponent(identifier)}`;

  const slug = fileName.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24) || String(index);
  const fileSizeMb =
    sizeBytes > 0
      ? Math.max(0.4, Math.round((sizeBytes / (1024 * 1024)) * 10) / 10)
      : estimateMp3SizeMb(durationSec);

  return {
    id: `archive-${identifier.slice(0, 24)}-${slug}`,
    title,
    artist,
    album,
    genre: 'Archive Free MP3',
    durationSec,
    fileSizeMb,
    coverUrl,
    audioUrl,
    source: 'archive',
    license: 'Open / Public Domain',
    isPreview: false,
  };
}

export function normalizeItunesTrack(raw: RawItunesTrack, index = 0): Track | null {
  if (!raw.trackId || !raw.trackName || !raw.previewUrl) return null;
  if (!raw.previewUrl.startsWith('https://')) return null;

  const coverUrl = raw.artworkUrl100
    ? raw.artworkUrl100.replace('100x100bb', '600x600bb')
    : FALLBACK_COVERS[index % FALLBACK_COVERS.length];

  return {
    id: `itunes-${raw.trackId}`,
    title: raw.trackName.trim(),
    artist: raw.artistName?.trim() || 'Artist',
    album: raw.collectionName?.trim() || 'iTunes Preview',
    genre: raw.primaryGenreName?.trim() || 'Pop',
    durationSec: 30,
    fileSizeMb: 0.7,
    coverUrl,
    audioUrl: raw.previewUrl,
    source: 'itunes',
    isPreview: true,
  };
}

export function normalizeJamendoTrack(
  raw: RawJamendoTrack,
  index = 0
): Track | null {
  const rawId = raw.id;
  const rawTitle = String(raw.name || '').trim();
  if (!rawId || !rawTitle) return null;

  const idStr = String(rawId).trim();
  const durationSec = Math.max(30, Math.round(Number(raw.duration) || 180));
  const rawGenre = raw.musicinfo?.tags?.genres?.[0]?.trim();
  const formattedGenre = rawGenre
    ? rawGenre.charAt(0).toUpperCase() + rawGenre.slice(1)
    : 'Jamendo Indie';

  const audioUrl =
    (raw.audio && raw.audio.startsWith('http') ? raw.audio : '') ||
    (raw.audiodownload && raw.audiodownload.startsWith('http')
      ? raw.audiodownload
      : '') ||
    `https://prod-1.storage.jamendo.com/?trackid=${encodeURIComponent(idStr)}&format=mp32`;

  const coverUrl =
    raw.album_image ||
    raw.image ||
    FALLBACK_COVERS[index % FALLBACK_COVERS.length];

  return {
    id: `jamendo-${idStr}`,
    title: rawTitle,
    artist: raw.artist_name?.trim() || 'Jamendo Artist',
    album: raw.album_name?.trim() || 'Jamendo Release',
    genre: formattedGenre,
    durationSec,
    fileSizeMb: estimateMp3SizeMb(durationSec),
    coverUrl,
    audioUrl,
    source: 'jamendo',
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
  const fileMatch = trimmed.match(/\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{15,})/);
  if (fileMatch?.[1]) return fileMatch[1];
  if (
    /drive\.google\.com\/uc\b|drive\.usercontent\.google\.com\/download\b/i.test(
      trimmed
    )
  ) {
    const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
    if (idMatch?.[1]) return idMatch[1];
  }
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

export function extractDriveResourceKey(input: string): string | undefined {
  const match = input.match(/[?&]resourcekey=([^&#\s]+)/i);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export interface GitHubRepoTarget {
  owner: string;
  repo: string;
  ref?: string;
  path: string;
}

export function extractGitHubRepoSource(input: string): GitHubRepoTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    ref: match[3] ? decodeURIComponent(match[3]) : undefined,
    path: match[4] ? decodeURIComponent(match[4]).replace(/^\/+|\/+$/g, '') : '',
  };
}

export function normalizeRadioStationTrack(
  raw: RawRadioStation,
  index = 0
): Track | null {
  const id = String(raw.stationuuid || '').trim();
  const name = String(raw.name || '').trim();
  const streamUrl = String(raw.url_resolved || raw.url || '').trim();
  if (!id || !name || !streamUrl.startsWith('https://')) return null;

  const rawTag = String(raw.tags || '')
    .split(',')
    .map((t) => t.trim())
    .find(Boolean);

  return {
    id: `radio-${id}`,
    title: name,
    artist: [raw.state, raw.country].filter(Boolean).join(', ') || 'Radio Live ID',
    album: raw.codec
      ? `Live Radio (${raw.codec}${raw.bitrate ? ` · ${raw.bitrate}kbps` : ''})`
      : 'Live Radio Stream',
    genre: rawTag
      ? rawTag.charAt(0).toUpperCase() + rawTag.slice(1)
      : 'Radio Indonesia',
    durationSec: 3600,
    fileSizeMb: 24,
    coverUrl:
      raw.favicon && raw.favicon.startsWith('https://')
        ? raw.favicon
        : FALLBACK_COVERS[index % FALLBACK_COVERS.length],
    audioUrl: streamUrl,
    source: 'radio',
    isPreview: false,
  };
}

export function parseLrcLyrics(lrcText: string): SyncedLyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = lrcText.split(/\r?\n/);
  const parsed: SyncedLyricLine[] = [];

  for (const line of lines) {
    const tagMatches = Array.from(line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g));
    if (tagMatches.length === 0) continue;
    const text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text) continue;
    for (const m of tagMatches) {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      const fracRaw = m[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      if (Number.isFinite(mins) && Number.isFinite(secs) && Number.isFinite(frac)) {
        parsed.push({
          timeSec: Math.round((mins * 60 + secs + frac) * 100) / 100,
          text,
        });
      }
    }
  }

  parsed.sort((a, b) => a.timeSec - b.timeSec);
  return parsed;
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
  const seen = new Set<string>();
  const regex =
    /id="entry-([^"]+)"([\s\S]*?)<div class="flip-entry-title">([^<]+)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const fileId = match[1]?.trim();
    const block = match[2] || '';
    const rawName = decodeHtmlEntities(match[3]?.trim() || '');
    if (!fileId || !rawName || seen.has(fileId)) continue;
    // Skip subfolder entries (handled separately)
    if (block.includes('/drive/folders/')) continue;

    const hasAudioExt = /\.(mp3|m4a|wav|ogg|flac|aac|opus|webm|3gp|amr)$/i.test(rawName);
    const hasAudioIcon = /type\/audio\/|alt="Audio"/i.test(block);
    if (!hasAudioExt && !hasAudioIcon) continue;
    if (rawName === 'audio1645293506.m4a') continue;
    seen.add(fileId);
    results.push({ fileId, fileName: rawName });
  }
  return results;
}

export function parseDriveSubfoldersFromHtml(html: string): string[] {
  const folders: string[] = [];
  const seen = new Set<string>();
  const regex = /href="https:\/\/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]{15,})[^"]*"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const id = match[1]?.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      folders.push(id);
    }
  }
  return folders;
}

export function parseDriveAudioFilename(fileName: string): {
  title: string;
  artist: string;
  genre: string;
} {
  let base = fileName.replace(/\.(mp3|m4a|wav|ogg|flac|aac|opus|webm|3gp|amr)$/i, '').trim();
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

const TRUSTED_AUDIO_HOST_SUFFIXES = [
  'drive.usercontent.google.com',
  'drive.google.com',
  'googleusercontent.com',
  'audius.co',
  'audius.org',
  'hearthis.at',
  'hearthis.app',
  'jamendo.com',
  'archive.org',
  'openverse.org',
  'upload.wikimedia.org',
  'cdn.freesound.org',
  'raw.githubusercontent.com',
  'github.com',
  'audio-ssl.itunes.apple.com',
  'itunes.apple.com',
];

function isPrivateOrLocalHostname(host: string): boolean {
  const cleaned = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !cleaned ||
    cleaned === 'localhost' ||
    cleaned === '0.0.0.0' ||
    cleaned === '127.0.0.1' ||
    cleaned === '::1' ||
    cleaned === '::' ||
    cleaned.endsWith('.local') ||
    cleaned.endsWith('.internal') ||
    /^127\./.test(cleaned) ||
    /^10\./.test(cleaned) ||
    /^192\.168\./.test(cleaned) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleaned) ||
    /^169\.254\./.test(cleaned) ||
    /^0\./.test(cleaned) ||
    /^(fc|fd|fe80)/i.test(cleaned) ||
    /^::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/i.test(cleaned)
  ) {
    return true;
  }
  return false;
}

export function isSafeAudioProxyUrl(
  rawUrl: string,
  approvedUrls?: ReadonlySet<string>
): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHostname(host)) {
      return false;
    }
    if (approvedUrls && approvedUrls.has(rawUrl)) {
      return true;
    }
    return TRUSTED_AUDIO_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

export function sanitizeDownloadFilename(title: string, artist: string): string {
  const raw = `${artist} - ${title}`
    .replace(/[<>:"/\\|?*;'\r\n\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = raw.slice(0, 80) || 'reytune-track';
  return `${safe}.mp3`;
}
