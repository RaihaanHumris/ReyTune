import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import {
  DEFAULT_DRIVE_FOLDER_ID,
  DRIVE_FOLDER_TRACKS,
  LOCAL_BUNDLED_TRACKS,
  YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
} from './src/data/tracks.ts';
import type { Track } from './src/types/music.ts';
import { parseId3FromBytes } from './src/utils/id3LyricsParser.ts';
import {
  extractDriveFileId,
  extractDriveFolderId,
  extractDriveResourceKey,
  extractGitHubRepoSource,
  isSafeAudioProxyUrl,
  normalizeArchiveTrack,
  normalizeAudiusTrack,
  normalizeDriveTrack,
  normalizeHearthisTrack,
  normalizeItunesTrack,
  normalizeJamendoTrack,
  normalizeOpenverseTrack,
  normalizeRadioStationTrack,
  parseDriveAudioFilename,
  parseDriveEmbeddedFolderHtml,
  parseDriveSubfoldersFromHtml,
  parseLrcLyrics,
  parseYouTubeMusicSearchResponse,
  sanitizeDownloadFilename,
  type RawArchiveFile,
  type RawAudiusTrack,
  type RawHearthisTrack,
  type RawItunesTrack,
  type RawJamendoTrack,
  type RawOpenverseTrack,
  type RawRadioStation,
  type SyncedLyricLine,
} from './src/utils/musicNormalizer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_TRACKS_DIR = path.resolve(__dirname, 'public/audio/tracks');
const PUBLIC_AUDIO_DIR = path.resolve(__dirname, 'public/audio');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Fast lookup map of pre-enriched Google Drive tracks by id (`gdrive-<fileId>`)
const PRE_ENRICHED_DRIVE_MAP = new Map<string, Track>();
for (const t of DRIVE_FOLDER_TRACKS) {
  PRE_ENRICHED_DRIVE_MAP.set(t.id, t);
}

// Combined local + Drive + YouTube Music pre-indexed tracks for instant lookup
const ALL_INDEXED_TRACKS: Track[] = [
  ...DRIVE_FOLDER_TRACKS,
  ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
  ...LOCAL_BUNDLED_TRACKS,
];

const ALL_INDEXED_MAP = new Map<string, Track>();
const APPROVED_STREAM_URLS = new Set<string>();
const MAX_DYNAMIC_INDEXED_TRACKS = 4000;

function registerDiscoveredTracks(tracks: Track[]): void {
  for (const t of tracks) {
    if (!t?.id) continue;
    if (ALL_INDEXED_MAP.size >= MAX_DYNAMIC_INDEXED_TRACKS && !ALL_INDEXED_MAP.has(t.id)) {
      const oldestKey = ALL_INDEXED_MAP.keys().next().value;
      if (oldestKey && !PRE_ENRICHED_DRIVE_MAP.has(oldestKey)) {
        ALL_INDEXED_MAP.delete(oldestKey);
      }
    }
    ALL_INDEXED_MAP.set(t.id, t);
    if (t.audioUrl && t.audioUrl.startsWith('https://')) {
      if (APPROVED_STREAM_URLS.size >= MAX_DYNAMIC_INDEXED_TRACKS) {
        const oldestUrl = APPROVED_STREAM_URLS.values().next().value;
        if (oldestUrl) APPROVED_STREAM_URLS.delete(oldestUrl);
      }
      APPROVED_STREAM_URLS.add(t.audioUrl);
      const normalized = t.audioUrl.replace(/^https:\/\/hearthis\.app\//i, 'https://hearthis.at/');
      APPROVED_STREAM_URLS.add(normalized);
    }
  }
}

registerDiscoveredTracks(ALL_INDEXED_TRACKS);

// Cache of synced Google Drive folders (folderId -> { updatedAt, tracks })
const driveFolderCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();

// Cache of resolved audio URLs for YouTube Music tracks (key -> resolved upstream audio URL)
const ytmAudioUrlCache = new Map<string, string>();

// Short-TTL query caches for free music APIs
const jamendoQueryCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();
const openverseQueryCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();
const archiveQueryCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();
const hearthisFeedCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();
const audiusFeedCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();

// Cache for LRCLIB lyrics & Radio Browser stations
const lyricsCache = new Map<
  string,
  {
    updatedAt: number;
    found: boolean;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    syncedLines: SyncedLyricLine[];
    plainLyrics: string;
    instrumental: boolean;
    source: string;
  }
>();

const radioStationCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();

function getJamendoClientId(): string {
  const raw = (process.env.JAMENDO_CLIENT_ID || '').trim();
  if (!raw || raw === 'MY_JAMENDO_CLIENT_ID' || raw === 'YOUR_JAMENDO_CLIENT_ID') {
    return '';
  }
  return raw;
}

// In-memory LRU cache of full MP3 track buffers for instant (<1ms) HTTP 206 Range responses
const MAX_CACHED_AUDIO_BUFFERS = 40;
const MAX_CACHED_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT_WARMUPS = 2;
const audioBufferCache = new Map<
  string,
  { buffer: Buffer; contentType: string }
>();
let totalCachedAudioBytes = 0;
const inFlightBufferWarmups = new Map<string, Promise<Buffer | null>>();
let activeWarmupCount = 0;

// Short-TTL cache for resolved Google Drive CDN stream URLs so Range seeks bypass Drive confirm checks
const driveResolvedUrlCache = new Map<
  string,
  { url: string; cookie?: string; expiresAt: number }
>();

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function normalizeUpstreamAudioUrl(rawUrl: string): string {
  return rawUrl.replace(/^https:\/\/hearthis\.app\//i, 'https://hearthis.at/');
}

function extractDriveFileIdFromAudioUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.hostname.includes('drive.usercontent.google.com') ||
      parsed.hostname.includes('drive.google.com')
    ) {
      const qId = parsed.searchParams.get('id');
      if (qId && /^[a-zA-Z0-9_-]{10,}$/.test(qId)) {
        return qId;
      }
      const dMatch = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(parsed.pathname);
      if (dMatch?.[1]) {
        return dMatch[1];
      }
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

function inferAudioContentType(
  rawContentType: string,
  contentDisposition: string,
  titleHint: string,
  urlHint: string
): string {
  const ct = rawContentType.toLowerCase();
  if (
    ct.includes('audio/') ||
    ct.includes('mpeg') ||
    ct.includes('mp4') ||
    ct.includes('ogg') ||
    ct.includes('flac') ||
    ct.includes('wav') ||
    ct.includes('aac') ||
    ct.includes('webm')
  ) {
    return ct.split(';')[0].trim();
  }
  const combinedHint = `${contentDisposition} ${titleHint} ${urlHint}`.toLowerCase();
  if (/\.m4a\b/.test(combinedHint)) return 'audio/mp4';
  if (/\.aac\b/.test(combinedHint)) return 'audio/aac';
  if (/\.flac\b/.test(combinedHint)) return 'audio/flac';
  if (/\.wav\b/.test(combinedHint)) return 'audio/wav';
  if (/\.(ogg|opus)\b/.test(combinedHint)) return 'audio/ogg';
  if (/\.webm\b/.test(combinedHint)) return 'audio/webm';
  return 'audio/mpeg';
}

function extractDriveConfirmUrlFromHtml(html: string, baseUrl: string): string | null {
  const formMatch = /<form[^>]*id=["']download-form["'][^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i.exec(
    html
  );
  if (formMatch?.[1]) {
    const actionUrl = new URL(formMatch[1].replace(/&amp;/g, '&'), baseUrl);
    const inputsBlock = formMatch[2] || '';
    const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = inputRegex.exec(inputsBlock)) !== null) {
      actionUrl.searchParams.set(m[1], m[2]);
    }
    return actionUrl.toString();
  }

  const hrefMatch = /href=["']([^"']*confirm=[^"']+)["']/i.exec(html);
  if (hrefMatch?.[1]) {
    return new URL(hrefMatch[1].replace(/&amp;/g, '&'), baseUrl).toString();
  }

  const uuidMatch = /name=["']uuid["']\s+value=["']([^"']+)["']/i.exec(html);
  const idMatch = /name=["']id["']\s+value=["']([^"']+)["']/i.exec(html);
  if (uuidMatch?.[1] && idMatch?.[1]) {
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(idMatch[1])}&export=download&confirm=t&uuid=${encodeURIComponent(uuidMatch[1])}`;
  }

  return null;
}

function extractCookieHeaderFromResponse(res: Response): string {
  const headersAny = res.headers as unknown as {
    getSetCookie?: () => string[];
  };
  const rawCookies =
    typeof headersAny.getSetCookie === 'function'
      ? headersAny.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie')!]
      : [];
  return rawCookies
    .map((line) => line.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function fetchUpstreamAudioWithFallback(
  rawUrl: string,
  method: 'GET' | 'HEAD',
  incomingRange: string,
  signal: AbortSignal
): Promise<Response> {
  const normalizedUrl = normalizeUpstreamAudioUrl(rawUrl);
  const driveFileId = extractDriveFileIdFromAudioUrl(normalizedUrl);

  const buildHeaders = (cookie?: string): Record<string, string> => {
    const h: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: '*/*',
    };
    if (incomingRange) {
      h.Range = incomingRange;
    }
    if (cookie) {
      h.Cookie = cookie;
    }
    return h;
  };

  if (!driveFileId) {
    return fetch(normalizedUrl, {
      method,
      headers: buildHeaders(),
      redirect: 'follow',
      signal,
    });
  }

  const cachedResolved = driveResolvedUrlCache.get(driveFileId);
  const resourceKey = extractDriveResourceKey(normalizedUrl);
  const rkParam = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';
  const candidates: { url: string; cookie?: string }[] = [];
  if (cachedResolved && cachedResolved.expiresAt > Date.now()) {
    candidates.push({ url: cachedResolved.url, cookie: cachedResolved.cookie });
  }
  candidates.push({
    url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveFileId)}&export=download&confirm=t${rkParam}`,
  });
  candidates.push({
    url: `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(driveFileId)}${rkParam}`,
  });

  let lastResponse: Response | null = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, {
        method,
        headers: buildHeaders(candidate.cookie),
        redirect: 'follow',
        signal,
      });
      lastResponse = res;
      const ct = (res.headers.get('content-type') || '').toLowerCase();

      // If Google Drive returned an HTML virus-scan/confirm page, extract confirm+uuid and retry
      if (ct.includes('text/html')) {
        if (method === 'HEAD') {
          const probeRes = await fetch(candidate.url, {
            method: 'GET',
            headers: buildHeaders(candidate.cookie),
            redirect: 'follow',
            signal,
          });
          const probeCt = (probeRes.headers.get('content-type') || '').toLowerCase();
          if ((probeRes.ok || probeRes.status === 206) && !probeCt.includes('text/html')) {
            return probeRes;
          }
          if (probeCt.includes('text/html')) {
            const html = await probeRes.text();
            const confirmUrl = extractDriveConfirmUrlFromHtml(html, probeRes.url || candidate.url);
            const cookie = extractCookieHeaderFromResponse(probeRes) || candidate.cookie;
            if (confirmUrl) {
              const confirmed = await fetch(confirmUrl, {
                method: 'GET',
                headers: buildHeaders(cookie),
                redirect: 'follow',
                signal,
              });
              const confirmedCt = (confirmed.headers.get('content-type') || '').toLowerCase();
              if ((confirmed.ok || confirmed.status === 206) && !confirmedCt.includes('text/html')) {
                driveResolvedUrlCache.set(driveFileId, {
                  url: confirmed.url || confirmUrl,
                  cookie,
                  expiresAt: Date.now() + 8 * 60 * 1000,
                });
                return confirmed;
              }
            }
          }
          continue;
        }

        const html = await res.text();
        const confirmUrl = extractDriveConfirmUrlFromHtml(html, res.url || candidate.url);
        const cookie = extractCookieHeaderFromResponse(res) || candidate.cookie;
        if (confirmUrl) {
          const confirmed = await fetch(confirmUrl, {
            method,
            headers: buildHeaders(cookie),
            redirect: 'follow',
            signal,
          });
          lastResponse = confirmed;
          const confirmedCt = (confirmed.headers.get('content-type') || '').toLowerCase();
          if ((confirmed.ok || confirmed.status === 206) && !confirmedCt.includes('text/html')) {
            driveResolvedUrlCache.set(driveFileId, {
              url: confirmed.url || confirmUrl,
              cookie,
              expiresAt: Date.now() + 8 * 60 * 1000,
            });
            return confirmed;
          }
        }
        continue;
      }

      if (res.ok || res.status === 206) {
        if (res.url && res.url.startsWith('https://')) {
          driveResolvedUrlCache.set(driveFileId, {
            url: res.url,
            cookie: candidate.cookie,
            expiresAt: Date.now() + 8 * 60 * 1000,
          });
        }
        return res;
      }

      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        driveResolvedUrlCache.delete(driveFileId);
        continue;
      }

      return res;
    } catch (err) {
      if (signal.aborted) throw err;
      driveResolvedUrlCache.delete(driveFileId);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw new Error('All Google Drive upstream endpoints failed');
}

function storeAudioBufferInCache(
  normalizedUrl: string,
  buffer: Buffer,
  contentType: string
): void {
  if (buffer.length < 32768 || buffer.length > 24 * 1024 * 1024) return;
  const existing = audioBufferCache.get(normalizedUrl);
  if (existing) {
    totalCachedAudioBytes -= existing.buffer.length;
    audioBufferCache.delete(normalizedUrl);
  }
  while (
    audioBufferCache.size >= MAX_CACHED_AUDIO_BUFFERS ||
    (totalCachedAudioBytes + buffer.length > MAX_CACHED_AUDIO_BYTES &&
      audioBufferCache.size > 0)
  ) {
    const oldestKey = audioBufferCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = audioBufferCache.get(oldestKey);
    if (evicted) {
      totalCachedAudioBytes -= evicted.buffer.length;
    }
    audioBufferCache.delete(oldestKey);
  }
  audioBufferCache.set(normalizedUrl, { buffer, contentType });
  totalCachedAudioBytes += buffer.length;
}

function warmTrackBuffer(rawUrl: string): Promise<Buffer | null> {
  const normalizedUrl = normalizeUpstreamAudioUrl(rawUrl);
  if (!normalizedUrl.startsWith('https://')) {
    return Promise.resolve(null);
  }
  const existing = audioBufferCache.get(normalizedUrl);
  if (existing) {
    return Promise.resolve(existing.buffer);
  }
  const inFlight = inFlightBufferWarmups.get(normalizedUrl);
  if (inFlight) {
    return inFlight;
  }
  if (activeWarmupCount >= MAX_CONCURRENT_WARMUPS) {
    return Promise.resolve(null);
  }

  activeWarmupCount += 1;
  const promise = (async () => {
    try {
      const res = await fetchUpstreamAudioWithFallback(
        normalizedUrl,
        'GET',
        '',
        AbortSignal.timeout(28000)
      );
      if (!res.ok && res.status !== 206) {
        return null;
      }
      const rawCt = res.headers.get('content-type') || '';
      if (rawCt.toLowerCase().includes('text/html')) {
        return null;
      }
      const ct = inferAudioContentType(
        rawCt,
        res.headers.get('content-disposition') || '',
        '',
        normalizedUrl
      );
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      if (buf.length < 32768) {
        return null;
      }
      storeAudioBufferInCache(normalizedUrl, buf, ct);
      return buf;
    } catch {
      return null;
    } finally {
      activeWarmupCount = Math.max(0, activeWarmupCount - 1);
      inFlightBufferWarmups.delete(normalizedUrl);
    }
  })();

  inFlightBufferWarmups.set(normalizedUrl, promise);
  return promise;
}

async function prewarmInitialCatalog(): Promise<void> {
  const priorityTracks = [
    ...DRIVE_FOLDER_TRACKS.slice(0, 8),
    ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS.slice(0, 4),
  ];
  // Warm top 3 immediately in parallel so featured tracks ("Hati-Hati di Jalan", "penjaga hati", "About You") are in RAM right away
  await Promise.all(
    priorityTracks.slice(0, 3).map((t) => warmTrackBuffer(t.audioUrl))
  );
  for (const t of priorityTracks.slice(3)) {
    await warmTrackBuffer(t.audioUrl);
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 5500
): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ReyTune/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return (await res.json()) as T;
}

function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const key = `${t.title.toLowerCase().trim()}::${t.artist.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function enrichTrackWithItunes(track: Track): Promise<Track> {
  if (track.coverUrl && track.coverUrl.includes('mzstatic.com')) {
    return track;
  }
  const cleanArtist =
    track.artist === 'ReyTune Collection' || track.artist.includes('DJ ')
      ? ''
      : track.artist;
  const query = `${cleanArtist} ${track.title}`.trim();
  if (!query) return track;

  try {
    const data = await fetchJsonWithTimeout<{
      results?: Array<{
        artistName?: string;
        collectionName?: string;
        trackTimeMillis?: number;
        artworkUrl100?: string;
      }>;
    }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=ID&entity=song&limit=1`,
      3500
    );
    const hit = data?.results?.[0];
    if (!hit) return track;

    const durationSec = hit.trackTimeMillis
      ? Math.max(90, Math.round(hit.trackTimeMillis / 1000))
      : track.durationSec;
    const coverUrl = hit.artworkUrl100
      ? hit.artworkUrl100.replace('100x100bb', '600x600bb')
      : track.coverUrl;
    const artist =
      track.artist === 'ReyTune Collection' && hit.artistName
        ? hit.artistName
        : track.artist;

    return {
      ...track,
      artist,
      album: hit.collectionName || track.album,
      durationSec,
      fileSizeMb: Math.round(((durationSec * 24) / 1024) * 10) / 10,
      coverUrl,
    };
  } catch {
    return track;
  }
}

// Query YouTube Music Official Internal API (youtubei/v1/search)
async function searchYouTubeMusicApi(
  query: string,
  limit = 20
): Promise<Track[]> {
  try {
    const res = await fetch(
      'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: 'https://music.youtube.com',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240717.01.00',
              hl: 'id',
              gl: 'ID',
            },
          },
          query,
          params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', // Songs filter
        }),
        signal: AbortSignal.timeout(4500),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return parseYouTubeMusicSearchResponse(data, limit);
  } catch {
    return [];
  }
}

// Query Hearthis.at Public API for full-length MP3 tracks
async function searchHearthisTracks(
  query: string,
  limit = 12
): Promise<Track[]> {
  try {
    const rawList = await fetchJsonWithTimeout<RawHearthisTrack[]>(
      `https://api-v2.hearthis.at/search?t=${encodeURIComponent(query)}&page=1&count=${limit}`,
      4500
    );
    if (!Array.isArray(rawList)) return [];
    const tracks = rawList
      .map((item) => normalizeHearthisTrack(item, { source: 'hearthis', maxDurationSec: 600 }))
      .filter((t): t is Track => t !== null);
    registerDiscoveredTracks(tracks);
    return tracks;
  } catch {
    return [];
  }
}

async function fetchHearthisFeedTracks(
  type: 'popular' | 'new' = 'popular',
  limit = 25
): Promise<Track[]> {
  const cacheKey = `${type}::${limit}`;
  const cached = hearthisFeedCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 4 * 60 * 1000) {
    return cached.tracks;
  }

  try {
    const [feedRes, popSearchRes] = await Promise.all([
      fetchJsonWithTimeout<RawHearthisTrack[]>(
        `https://api-v2.hearthis.at/feed/?type=${encodeURIComponent(type)}&page=1&count=${Math.min(30, limit + 8)}`,
        5000
      ).catch(() => [] as RawHearthisTrack[]),
      fetchJsonWithTimeout<RawHearthisTrack[]>(
        `https://api-v2.hearthis.at/search?t=${encodeURIComponent('acoustic pop chill')}&page=1&count=12`,
        4500
      ).catch(() => [] as RawHearthisTrack[]),
    ]);

    const shortTracks = (Array.isArray(popSearchRes) ? popSearchRes : [])
      .map((item) => normalizeHearthisTrack(item, { source: 'hearthis', maxDurationSec: 600 }))
      .filter((t): t is Track => t !== null);

    const feedTracks = (Array.isArray(feedRes) ? feedRes : [])
      .map((item) => normalizeHearthisTrack(item, { source: 'hearthis', maxDurationSec: 5400 }))
      .filter((t): t is Track => t !== null);

    const tracks = dedupeTracks([...shortTracks, ...feedTracks]).slice(0, limit);
    registerDiscoveredTracks(tracks);
    if (tracks.length > 0) {
      hearthisFeedCache.set(cacheKey, { updatedAt: now, tracks });
    }
    return tracks;
  } catch {
    return cached?.tracks ?? [];
  }
}

// Query Openverse Audio API (Zero API key — indexes Creative Commons full MP3s from Jamendo & Wikimedia)
async function fetchOpenverseTracks(options: {
  query?: string;
  source?: string;
  limit?: number;
}): Promise<Track[]> {
  const q = (options.query || '').trim();
  const source = (options.source || '').trim();
  const limit = Math.min(20, Math.max(5, options.limit || 20));
  const cacheKey = `${q.toLowerCase()}::${source.toLowerCase()}::${limit}`;
  const cached = openverseQueryCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 6 * 60 * 1000) {
    return cached.tracks;
  }

  try {
    const params = new URLSearchParams({
      category: 'music',
      page_size: String(limit),
    });
    if (q) {
      params.set('q', q);
    }
    if (source) {
      params.set('source', source);
    }

    const res = await fetchJsonWithTimeout<{ results?: RawOpenverseTrack[] }>(
      `https://api.openverse.org/v1/audio/?${params.toString()}`,
      8500
    );
    const rawList = Array.isArray(res?.results) ? res.results : [];
    const tracks = dedupeTracks(
      rawList
        .map((item, idx) => normalizeOpenverseTrack(item, idx))
        .filter((t): t is Track => t !== null)
    );
    registerDiscoveredTracks(tracks);
    if (tracks.length > 0) {
      openverseQueryCache.set(cacheKey, { updatedAt: now, tracks });
    }
    return tracks;
  } catch {
    return cached?.tracks ?? [];
  }
}

// Query Internet Archive Open Audio API (Zero API key — legal full MP3s)
async function fetchInternetArchiveTracks(
  query = '',
  limit = 16
): Promise<Track[]> {
  const q = query.trim();
  const cacheKey = `${q.toLowerCase()}::${limit}`;
  const cached = archiveQueryCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 10 * 60 * 1000) {
    return cached.tracks;
  }

  try {
    const safeQueryTerm = q.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    const searchExpr = safeQueryTerm
      ? `mediatype:audio AND collection:(audio_music OR netlabels OR opensource_audio) AND (${safeQueryTerm})`
      : `mediatype:audio AND collection:(netlabels OR audio_music) AND (jazz OR acoustic OR lo-fi OR chill OR indie OR piano)`;

    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      searchExpr
    )}&fl[]=identifier,title,creator,downloads&sort[]=downloads+desc&rows=6&output=json`;

    const searchRes = await fetchJsonWithTimeout<{
      response?: {
        docs?: Array<{
          identifier?: string;
          title?: string;
          creator?: string | string[];
        }>;
      };
    }>(searchUrl, 6000);

    const docs = Array.isArray(searchRes?.response?.docs)
      ? searchRes.response.docs.filter((d) => Boolean(d.identifier))
      : [];
    if (docs.length === 0) return cached?.tracks ?? [];

    const metaList = await Promise.all(
      docs.slice(0, 5).map(async (doc) => {
        const id = String(doc.identifier);
        try {
          const filesRes = await fetchJsonWithTimeout<{ result?: RawArchiveFile[] }>(
            `https://archive.org/metadata/${encodeURIComponent(id)}/files`,
            5000
          );
          const files = Array.isArray(filesRes?.result) ? filesRes.result : [];
          const mp3s = files
            .filter(
              (f) =>
                /\.mp3$/i.test(f.name || '') &&
                !/(_64kb|_vbr_mp3\.zip|sample|preview)/i.test(f.name || '')
            )
            .slice(0, 4);
          return mp3s
            .map((file, idx) =>
              normalizeArchiveTrack(
                id,
                file,
                {
                  title: doc.title,
                  creator: Array.isArray(doc.creator) ? doc.creator[0] : doc.creator,
                },
                idx
              )
            )
            .filter((t): t is Track => t !== null);
        } catch {
          return [] as Track[];
        }
      })
    );

    const tracks = dedupeTracks(metaList.flat()).slice(0, limit);
    registerDiscoveredTracks(tracks);
    if (tracks.length > 0) {
      archiveQueryCache.set(cacheKey, { updatedAt: now, tracks });
    }
    return tracks;
  } catch {
    return cached?.tracks ?? [];
  }
}

// Query iTunes Search API for metadata & 30s official preview fallback
async function fetchItunesPreviewTracks(
  query: string,
  limit = 6
): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const data = await fetchJsonWithTimeout<{ results?: RawItunesTrack[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=ID&entity=song&limit=${limit}`,
      4000
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    const tracks = results
      .map((item, idx) => normalizeItunesTrack(item, idx))
      .filter((t): t is Track => t !== null);
    registerDiscoveredTracks(tracks);
    return tracks;
  } catch {
    return [];
  }
}

// Resolve a playable upstream HTTPS audio URL for a YouTube Music song
async function resolveYouTubeMusicAudioUrl(
  videoId: string,
  title: string,
  artist: string
): Promise<string | null> {
  const cacheKey = `${videoId}::${artist.toLowerCase()}::${title.toLowerCase()}`;
  const cached = ytmAudioUrlCache.get(cacheKey);
  if (cached) return cached;

  const normTitle = title.toLowerCase().trim();
  const normArtist = artist.toLowerCase().trim();

  // 1. Check pre-indexed Google Drive + YouTube Music / Hearthis catalog
  const indexedMatch = ALL_INDEXED_TRACKS.find((t) => {
    if (videoId && t.youtubeVideoId === videoId && t.audioUrl.startsWith('https://')) {
      return true;
    }
    const tTitle = t.title.toLowerCase();
    const tArtist = t.artist.toLowerCase();
    return (
      t.audioUrl.startsWith('https://') &&
      (tTitle === normTitle || tTitle.includes(normTitle) || normTitle.includes(tTitle)) &&
      (tArtist.includes(normArtist) || normArtist.includes(tArtist))
    );
  });

  if (indexedMatch && indexedMatch.audioUrl.startsWith('https://')) {
    ytmAudioUrlCache.set(cacheKey, indexedMatch.audioUrl);
    APPROVED_STREAM_URLS.add(indexedMatch.audioUrl);
    return indexedMatch.audioUrl;
  }

  const cleanQ = `${artist} ${title}`.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const titleWords = normTitle.split(/\s+/).filter((w) => w.length > 2);
  const artistWords = normArtist.split(/\s+/).filter((w) => w.length > 2);

  // 2. Try Hearthis.at full MP3 (strict Artist + Title match, spam-filtered)
  try {
    const htTracks = await searchHearthisTracks(cleanQ, 8);
    const hit = htTracks.find((item) => {
      const combined = `${item.artist} ${item.title}`.toLowerCase();
      const hasTitle =
        titleWords.length === 0 || titleWords.some((w) => combined.includes(w));
      const hasArtist =
        artistWords.length === 0 || artistWords.some((w) => combined.includes(w));
      return item.durationSec >= 90 && item.durationSec <= 540 && hasTitle && hasArtist;
    });
    if (hit?.audioUrl) {
      ytmAudioUrlCache.set(cacheKey, hit.audioUrl);
      APPROVED_STREAM_URLS.add(hit.audioUrl);
      return hit.audioUrl;
    }
  } catch {
    // Continue to next tier
  }

  // 3. Try Audius full MP3 stream (minimum 90s full track)
  try {
    const audiusRes = await fetchJsonWithTimeout<{ data?: RawAudiusTrack[] }>(
      `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(cleanQ)}&limit=6&app_name=ReyTune`,
      3800
    );
    const list = audiusRes?.data || [];
    const hit = list.find((item) => {
      const d = Number(item.duration || 0);
      const itemTitle = String(item.title || '').toLowerCase();
      return (
        d >= 90 &&
        d <= 540 &&
        Boolean(item.id) &&
        titleWords.some((w) => itemTitle.includes(w))
      );
    });
    if (hit?.id) {
      const streamUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(String(hit.id))}/stream?app_name=ReyTune`;
      ytmAudioUrlCache.set(cacheKey, streamUrl);
      APPROVED_STREAM_URLS.add(streamUrl);
      return streamUrl;
    }
  } catch {
    // Continue to next tier
  }

  // 4. Try Openverse / Jamendo full MP3 stream
  try {
    const ovTracks = await fetchOpenverseTracks({ query: cleanQ, limit: 5 });
    const hit = ovTracks.find((item) => {
      const combined = `${item.artist} ${item.title}`.toLowerCase();
      return titleWords.some((w) => combined.includes(w));
    });
    if (hit?.audioUrl) {
      ytmAudioUrlCache.set(cacheKey, hit.audioUrl);
      APPROVED_STREAM_URLS.add(hit.audioUrl);
      return hit.audioUrl;
    }
  } catch {
    // Continue to next tier
  }

  // 5. Try iTunes official audio preview for the exact requested song (never play an unrelated song!)
  try {
    const itunesHits = await fetchItunesPreviewTracks(cleanQ, 3);
    if (itunesHits[0]?.audioUrl) {
      ytmAudioUrlCache.set(cacheKey, itunesHits[0].audioUrl);
      APPROVED_STREAM_URLS.add(itunesHits[0].audioUrl);
      return itunesHits[0].audioUrl;
    }
  } catch {
    // Continue to final fallback
  }

  // 6. Fallback only if same artist exists in full-length indexed catalog
  const artistFullFallback = ALL_INDEXED_TRACKS.find((t) =>
    t.artist.toLowerCase().includes(normArtist)
  );
  return artistFullFallback?.audioUrl || null;
}

function extractDriveViewTitle(html: string): {
  title: string | null;
  requiresLogin: boolean;
} {
  const requiresLogin =
    /accounts\.google\.com\/ServiceLogin|Sign in - Google Accounts|You need access|Perlu akses|Minta akses/i.test(
      html
    );
  const ogMatch = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html);
  const rawTitle =
    ogMatch?.[1] ||
    (/<title>([^<]+)<\/title>/i.exec(html)?.[1] || '').replace(/\s*-\s*Google Drive\s*$/i, '');
  const cleaned = rawTitle
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  if (
    !cleaned ||
    /^(Google Drive|Sign in|Access denied|Error|Meet Google Drive|Page Not Found|Not Found|找不到|Tidak ditemukan|404|403)/i.test(
      cleaned
    )
  ) {
    return { title: null, requiresLogin };
  }
  return { title: cleaned, requiresLogin };
}

async function getSingleDriveFileTrack(
  fileId: string,
  resourceKey?: string
): Promise<{ folderId: string; tracks: Track[]; live: boolean; error?: string }> {
  const rkQuery = resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : '';
  const rkParam = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';
  const downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${rkParam}`;
  const viewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view${rkQuery}`;
  const previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview${rkQuery}`;

  const [audioProbe, viewMeta] = await Promise.all([
    fetchUpstreamAudioWithFallback(
      downloadUrl,
      'GET',
      'bytes=0-262143',
      AbortSignal.timeout(9000)
    ).catch(() => null),
    fetch(viewUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(6500),
    })
      .then(async (r) => extractDriveViewTitle(await r.text()))
      .catch(() => ({ title: null, requiresLogin: false })),
  ]);

  const ct = (audioProbe?.headers.get('content-type') || '').toLowerCase();
  const audioOk =
    Boolean(audioProbe) &&
    (audioProbe!.ok || audioProbe!.status === 206) &&
    !ct.includes('text/html');

  if (audioOk && audioProbe) {
    const disp = audioProbe.headers.get('content-disposition') || '';
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disp);
    const plainMatch = /filename="([^"]+)"/i.exec(disp);
    let fileName = viewMeta.title || `Drive Audio ${fileId.slice(0, 6)}.mp3`;
    if (utf8Match?.[1]) {
      fileName = decodeURIComponent(utf8Match[1]);
    } else if (plainMatch?.[1]) {
      fileName = plainMatch[1];
    }

    let rawTrack = normalizeDriveTrack(fileId, fileName, 0);
    if (rkParam) {
      rawTrack = { ...rawTrack, audioUrl: downloadUrl };
    }

    try {
      const sliceBuf = Buffer.from(await audioProbe.arrayBuffer());
      if (sliceBuf.length > 128) {
        const id3 = parseId3FromBytes(sliceBuf);
        if (id3.title) {
          rawTrack = {
            ...rawTrack,
            title: id3.title,
            artist: id3.artist || rawTrack.artist,
            album: id3.album || rawTrack.album,
          };
        }
      }
    } catch {
      // Ignore optional ID3 inspection failure
    }

    const enriched = await enrichTrackWithItunes(rawTrack);
    PRE_ENRICHED_DRIVE_MAP.set(enriched.id, enriched);
    ALL_INDEXED_MAP.set(enriched.id, enriched);
    void warmTrackBuffer(enriched.audioUrl);

    return {
      folderId: fileId,
      tracks: [enriched],
      live: true,
    };
  }

  // File cannot be fetched anonymously from the server (still Restricted/Private or requires login).
  // Provide a browser-session Google Drive /preview fallback track so users logged into Google can still play it without OAuth.
  const displayTitle = viewMeta.title
    ? parseDriveAudioFilename(viewMeta.title).title
    : `File Drive (${fileId.slice(0, 6)})`;
  const displayArtist = viewMeta.title
    ? parseDriveAudioFilename(viewMeta.title).artist
    : 'Sesi Google Drive (Private)';

  const previewTrack: Track = {
    id: `gdrive-${fileId}`,
    driveFileId: fileId,
    drivePreviewOnly: true,
    title: displayTitle,
    artist: displayArtist,
    album: 'Google Drive (Akses Terbatas)',
    genre: 'Google Drive',
    durationSec: 210,
    fileSizeMb: 4.5,
    coverUrl:
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
    audioUrl: previewUrl,
    source: 'gdrive',
    isPreview: true,
  };

  return {
    folderId: fileId,
    tracks: [previewTrack],
    live: false,
    error: viewMeta.requiresLogin
      ? 'File Drive ini masih Dibatasi/Private. Klik Putar untuk memutar via sesi login Google di browser, atau ubah ke "Siapa saja yang memiliki link" agar bisa stream penuh & offline.'
      : 'Server tidak diizinkan mengunduh byte audio langsung dari file Drive ini. Anda tetap bisa memutarnya lewat Player Google Drive di browser atau pilih lewat tombol "MP3 HP".',
  };
}

async function getGitHubRepoTracks(
  rawUrl: string
): Promise<{ folderId: string; tracks: Track[]; live: boolean; error?: string }> {
  const target = extractGitHubRepoSource(rawUrl);
  if (!target) {
    return {
      folderId: rawUrl,
      tracks: [],
      live: false,
      error: 'Link GitHub tidak valid.',
    };
  }

  const cacheKey = `gh:${target.owner}/${target.repo}/${target.ref || 'default'}/${target.path}`;
  const cached = driveFolderCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 5 * 60 * 1000) {
    return { folderId: cacheKey, tracks: cached.tracks, live: true };
  }

  type GitHubContentItem = {
    type?: string;
    name?: string;
    path?: string;
    sha?: string;
    size?: number;
    download_url?: string | null;
  };

  async function listAudioFiles(dirPath: string, depth = 0): Promise<GitHubContentItem[]> {
    const apiPath = dirPath
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(target!.owner)}/${encodeURIComponent(target!.repo)}/contents/${apiPath}${target!.ref ? `?ref=${encodeURIComponent(target!.ref)}` : ''}`;
    const res = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ReyTune/1.0',
      },
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    const items = (await res.json()) as GitHubContentItem[];
    if (!Array.isArray(items)) return [];

    const audioFiles = items.filter(
      (item) =>
        item.type === 'file' &&
        Boolean(item.download_url) &&
        /\.(mp3|m4a|wav|ogg|flac)$/i.test(item.name || '')
    );

    if (audioFiles.length > 0 || depth >= 1) {
      return audioFiles;
    }

    const candidateDirs = items
      .filter((item) => item.type === 'dir' && item.path)
      .slice(0, 4);
    for (const dir of candidateDirs) {
      const nested = await listAudioFiles(dir.path!, depth + 1).catch(() => []);
      if (nested.length > 0) {
        audioFiles.push(...nested);
      }
    }
    return audioFiles;
  }

  try {
    const audioItems = await listAudioFiles(target.path);
    if (audioItems.length === 0) {
      return {
        folderId: cacheKey,
        tracks: [],
        live: false,
        error:
          'Repositori GitHub tidak memiliki file audio (.mp3/.m4a/.wav/.ogg/.flac). Pastikan repositori bersifat publik.',
      };
    }

    const tracks: Track[] = audioItems.slice(0, 100).map((item, idx) => {
      const fileName = item.name || `Track ${idx + 1}.mp3`;
      const parsed = parseDriveAudioFilename(fileName);
      const id = `github-${(item.sha || String(idx)).slice(0, 16)}`;
      const sizeMb = item.size
        ? Math.max(0.5, Math.round((item.size / (1024 * 1024)) * 10) / 10)
        : 3.5;
      return {
        id,
        title: parsed.title,
        artist: parsed.artist,
        album: `${target.owner}/${target.repo}`,
        genre: parsed.genre,
        durationSec: 215,
        fileSizeMb: sizeMb,
        coverUrl:
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
        audioUrl: item.download_url!,
        source: 'github',
        isPreview: false,
      };
    });

    const enrichedSubset = await Promise.all(
      tracks.slice(0, 8).map((t) => enrichTrackWithItunes(t))
    );
    const mergedTracks = dedupeTracks([...enrichedSubset, ...tracks.slice(8)]);
    for (const t of mergedTracks) {
      ALL_INDEXED_MAP.set(t.id, t);
    }
    driveFolderCache.set(cacheKey, { updatedAt: now, tracks: mergedTracks });

    return {
      folderId: cacheKey,
      tracks: mergedTracks,
      live: true,
    };
  } catch {
    return {
      folderId: cacheKey,
      tracks: cached?.tracks ?? [],
      live: false,
      error:
        'Gagal membaca repositori GitHub. Pastikan repositori publik dan URL benar.',
    };
  }
}

async function getDriveFolderTracks(
  rawFolderInput?: string,
  forceRefresh = false
): Promise<{ folderId: string; tracks: Track[]; live: boolean; error?: string }> {
  const input = (rawFolderInput || '').trim();
  if (extractGitHubRepoSource(input)) {
    return getGitHubRepoTracks(input);
  }

  const resourceKey = extractDriveResourceKey(input);
  const singleFileId = extractDriveFileId(input);
  if (singleFileId) {
    return getSingleDriveFileTrack(singleFileId, resourceKey);
  }

  const folderId = extractDriveFolderId(input) || DEFAULT_DRIVE_FOLDER_ID;
  const isExplicitFolderUrl = /\/folders\//i.test(input);

  const cached = driveFolderCache.get(folderId);
  const now = Date.now();
  if (!forceRefresh && cached && now - cached.updatedAt < 5 * 60 * 1000) {
    return { folderId, tracks: cached.tracks, live: true };
  }

  const rkParam = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';

  const fetchEmbeddedFolder = async (
    targetFolderId: string
  ): Promise<{
    entries: { fileId: string; fileName: string }[];
    subfolders: string[];
    requiresLogin: boolean;
  }> => {
    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(targetFolderId)}${rkParam}#list`;
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    const html = await res.text();
    const requiresLogin =
      res.status === 401 ||
      res.status === 403 ||
      res.url.includes('accounts.google.com') ||
      /Sign in - Google Accounts|You need access|Perlu akses/i.test(html);
    if (!res.ok && res.status !== 404) {
      return { entries: [], subfolders: [], requiresLogin };
    }
    return {
      entries: res.ok ? parseDriveEmbeddedFolderHtml(html) : [],
      subfolders: res.ok ? parseDriveSubfoldersFromHtml(html) : [],
      requiresLogin,
    };
  };

  try {
    const rootResult = await fetchEmbeddedFolder(folderId);
    const entries = [...rootResult.entries];
    let requiresLogin = rootResult.requiresLogin;

    // Also scan 1 level of subfolders (up to 6) if the user shared a parent folder
    if (rootResult.subfolders.length > 0 && entries.length < 150) {
      const subResults = await Promise.all(
        rootResult.subfolders.slice(0, 6).map((subId) =>
          fetchEmbeddedFolder(subId).catch(() => ({
            entries: [],
            subfolders: [],
            requiresLogin: false,
          }))
        )
      );
      for (const sr of subResults) {
        for (const item of sr.entries) {
          if (!entries.some((e) => e.fileId === item.fileId)) {
            entries.push(item);
          }
        }
      }
    }

    // If embeddedfolderview returned nothing and input is NOT explicitly a /folders/ URL
    // (for example https://drive.google.com/open?id=FILE_ID or raw FILE_ID), try treating it as a single file!
    if (entries.length === 0 && !isExplicitFolderUrl && input) {
      return getSingleDriveFileTrack(folderId, resourceKey);
    }

    // Fallback check on the main /drive/folders/ page if embeddedfolderview had 0 items
    if (entries.length === 0 && folderId !== DEFAULT_DRIVE_FOLDER_ID) {
      try {
        const folderPageUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ''}`;
        const pageRes = await fetch(folderPageUrl, {
          headers: { 'User-Agent': BROWSER_USER_AGENT },
          redirect: 'follow',
          signal: AbortSignal.timeout(6500),
        });
        const pageHtml = await pageRes.text();
        if (
          pageRes.status === 401 ||
          pageRes.status === 403 ||
          pageRes.url.includes('accounts.google.com') ||
          /Sign in - Google Accounts|You need access|Perlu akses/i.test(pageHtml)
        ) {
          requiresLogin = true;
        }
      } catch {
        // Ignore secondary probe error
      }
    }

    if (entries.length === 0) {
      if (folderId === DEFAULT_DRIVE_FOLDER_ID) {
        return { folderId, tracks: DRIVE_FOLDER_TRACKS, live: true };
      }
      return {
        folderId,
        tracks: [],
        live: false,
        error: requiresLogin
          ? 'Folder Google Drive ini masih Private / Dibatasi ("Restricted"). Ubah izin berbagi Drive ke "Siapa saja yang memiliki link", atau impor lagu Anda lewat tombol "MP3 HP".'
          : 'Folder Google Drive kosong atau tidak ada file audio (.mp3/.m4a/.wav/.ogg/.flac) yang terbaca. Pastikan akses publik ("Siapa saja yang memiliki link") aktif.',
      };
    }

    const resolvedTracks: Track[] = [];
    const newEntriesToEnrich: Track[] = [];

    const duplicateFileIds = new Set([
      '1R21X8Bo3IybUQbW6OSWAyd8SqUcyybNc',
      '1VXTL04Bg4yP6w_361TDoOK7wZNs1mATU',
      '17992p8CGfK4SNeqmF1-NW73r9Y47iHn_',
      '1kenLK3tUAc2v_Jnd3Ppsh_rK5ooxz7cP',
      '1GrzX37DyRzngguLOgaB9-jJ2B5WzkzW9',
      '13ewK7CDD4xBMEXW0DJZs9uOnLzkvs3wd',
      '14Z1RfJ7Ya8u290NmoRPbgGJ-M2v_Qfpe',
    ]);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (duplicateFileIds.has(entry.fileId)) continue;
      const trackId = `gdrive-${entry.fileId}`;
      const existing = PRE_ENRICHED_DRIVE_MAP.get(trackId);
      if (existing) {
        resolvedTracks.push(existing);
      } else {
        let normalized = normalizeDriveTrack(entry.fileId, entry.fileName, i);
        if (rkParam) {
          normalized = {
            ...normalized,
            audioUrl: `${normalized.audioUrl}${rkParam}`,
          };
        }
        newEntriesToEnrich.push(normalized);
        resolvedTracks.push(normalized);
      }
    }

    if (newEntriesToEnrich.length > 0) {
      const subset = newEntriesToEnrich.slice(0, 8);
      const enrichedSubset = await Promise.all(
        subset.map((t) => enrichTrackWithItunes(t))
      );
      const enrichedMap = new Map(enrichedSubset.map((t) => [t.id, t]));
      for (let i = 0; i < resolvedTracks.length; i++) {
        const updated = enrichedMap.get(resolvedTracks[i].id);
        if (updated) {
          resolvedTracks[i] = updated;
          PRE_ENRICHED_DRIVE_MAP.set(updated.id, updated);
        }
      }
    }

    let finalTracks: Track[];
    if (folderId === DEFAULT_DRIVE_FOLDER_ID) {
      const liveIds = new Set(resolvedTracks.map((t) => t.id));
      const orderedDefault = DRIVE_FOLDER_TRACKS.filter((t) =>
        liveIds.has(t.id)
      );
      const extraNew = resolvedTracks.filter(
        (t) => !DRIVE_FOLDER_TRACKS.some((d) => d.id === t.id)
      );
      finalTracks = dedupeTracks([...orderedDefault, ...extraNew]);
    } else {
      finalTracks = dedupeTracks(resolvedTracks);
      for (const t of finalTracks) {
        ALL_INDEXED_MAP.set(t.id, t);
      }
      for (const t of finalTracks.slice(0, 3)) {
        void warmTrackBuffer(t.audioUrl);
      }
    }

    driveFolderCache.set(folderId, { updatedAt: now, tracks: finalTracks });
    return { folderId, tracks: finalTracks, live: true };
  } catch {
    if (folderId === DEFAULT_DRIVE_FOLDER_ID) {
      return { folderId, tracks: DRIVE_FOLDER_TRACKS, live: true };
    }
    return {
      folderId,
      tracks: cached?.tracks ?? [],
      live: false,
      error:
        'Gagal terhubung ke folder Google Drive. Pastikan link valid dan diset publik ("Siapa saja yang memiliki link").',
    };
  }
}

async function fetchAudiusTracks(
  query: string,
  limit = 15,
  audiusGenre = ''
): Promise<Track[]> {
  const g = audiusGenre.trim();
  const cacheKey = `${query.toLowerCase()}::${g.toLowerCase()}::${limit}`;
  const cached = audiusFeedCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 4 * 60 * 1000) {
    return cached.tracks;
  }

  try {
    let url: string;
    if (query === 'trending') {
      url = g && g.toLowerCase() !== 'all'
        ? `https://api.audius.co/v1/tracks/trending?genre=${encodeURIComponent(g)}&limit=${limit}&app_name=ReyTune`
        : `https://api.audius.co/v1/tracks/trending?limit=${limit}&app_name=ReyTune`;
    } else if (query === 'underground') {
      url = `https://api.audius.co/v1/tracks/trending/underground?limit=${limit}&app_name=ReyTune`;
    } else {
      url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=ReyTune`;
    }
    const audiusRes = await fetchJsonWithTimeout<{ data?: RawAudiusTrack[] }>(
      url,
      4500
    );
    if (!audiusRes || !Array.isArray(audiusRes.data)) return cached?.tracks ?? [];
    const tracks = audiusRes.data
      .map(normalizeAudiusTrack)
      .filter((t): t is Track => t !== null && t.durationSec >= 60);
    registerDiscoveredTracks(tracks);
    if (tracks.length > 0) {
      audiusFeedCache.set(cacheKey, { updatedAt: now, tracks });
    }
    return tracks;
  } catch {
    return cached?.tracks ?? [];
  }
}

async function fetchJamendoTracks(options: {
  query?: string;
  tags?: string;
  order?: string;
  limit?: number;
}): Promise<{ configured: boolean; tracks: Track[]; error?: string; viaOpenverse?: boolean }> {
  const clientId = getJamendoClientId();
  const q = (options.query || '').trim();
  const tags = (options.tags || '').trim();
  const limit = Math.min(50, Math.max(1, options.limit || 25));

  // Zero-Key Automatic Fallback: Use Openverse API (source=jamendo) to serve real full-length Jamendo MP3s without an API key!
  if (!clientId) {
    const ovQuery = (q || tags || '').trim();
    const openverseJamendo = await fetchOpenverseTracks({
      query: ovQuery,
      source: 'jamendo',
      limit: Math.min(20, limit),
    });
    return {
      configured: true,
      viaOpenverse: true,
      tracks: openverseJamendo,
      error:
        openverseJamendo.length === 0
          ? 'Gagal memuat katalog Openverse/Jamendo saat ini. Coba muat ulang.'
          : undefined,
    };
  }

  const order = (options.order || (q ? 'relevance' : 'popularity_month')).trim();
  const cacheKey = `${q.toLowerCase()}::${tags.toLowerCase()}::${order}::${limit}`;
  const cached = jamendoQueryCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 3 * 60 * 1000) {
    return { configured: true, tracks: cached.tracks };
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      limit: String(limit),
      order,
      include: 'musicinfo',
      imagesize: '600',
      audioformat: 'mp32',
    });
    if (q) params.set('namesearch', q);
    if (tags) params.set('tags', tags);

    const res = await fetchJsonWithTimeout<{
      headers?: { status?: string; code?: number; error_message?: string };
      results?: RawJamendoTrack[];
    }>(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, 5500);

    if (res?.headers?.status === 'failed') {
      return {
        configured: true,
        tracks: [],
        error: res.headers.error_message || 'Jamendo API request failed',
      };
    }

    const rawList = Array.isArray(res?.results) ? res.results : [];
    const tracks = rawList
      .map((item, idx) => normalizeJamendoTrack(item, idx))
      .filter((t): t is Track => t !== null);

    registerDiscoveredTracks(tracks);
    jamendoQueryCache.set(cacheKey, { updatedAt: now, tracks });
    return { configured: true, tracks };
  } catch {
    return {
      configured: true,
      tracks: cached?.tracks ?? [],
      error: 'Gagal terhubung ke Jamendo API. Coba beberapa saat lagi.',
    };
  }
}

async function fetchRadioBrowserStations(
  countryCode = 'ID',
  limit = 25
): Promise<Track[]> {
  const code = (countryCode || 'ID').trim().toUpperCase();
  const cached = radioStationCache.get(code);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 5 * 60 * 1000) {
    return cached.tracks;
  }

  const mirrors = [
    `https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/${encodeURIComponent(code)}?limit=${limit}&order=clickcount&reverse=true&hidebroken=true`,
    `https://fr1.api.radio-browser.info/json/stations/bycountrycodeexact/${encodeURIComponent(code)}?limit=${limit}&order=clickcount&reverse=true&hidebroken=true`,
    `https://nl1.api.radio-browser.info/json/stations/bycountrycodeexact/${encodeURIComponent(code)}?limit=${limit}&order=clickcount&reverse=true&hidebroken=true`,
  ];

  for (const url of mirrors) {
    try {
      const rawStations = await fetchJsonWithTimeout<RawRadioStation[]>(url, 4500);
      if (!Array.isArray(rawStations)) continue;
      const tracks = dedupeTracks(
        rawStations
          .map((item, idx) => normalizeRadioStationTrack(item, idx))
          .filter((t): t is Track => t !== null)
      );
      if (tracks.length > 0) {
        registerDiscoveredTracks(tracks);
        radioStationCache.set(code, { updatedAt: now, tracks });
        return tracks;
      }
    } catch {
      // Try next Radio Browser mirror
    }
  }
  return cached?.tracks ?? [];
}

type LyricsResult = {
  updatedAt: number;
  found: boolean;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  syncedLines: SyncedLyricLine[];
  plainLyrics: string;
  instrumental: boolean;
  source: string;
  transcribeConfigured?: boolean;
  transcribeError?: string;
};

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveSongAudioLocation(
  trackId?: string,
  explicitAudioUrl?: string
): { staticPath?: string; upstreamUrl?: string } {
  const cleanId = (trackId || '').trim();
  const safeBasename = cleanId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeBasename) {
    const staticDiskPath = path.resolve(STATIC_TRACKS_DIR, `${safeBasename}.mp3`);
    if (
      staticDiskPath.startsWith(STATIC_TRACKS_DIR + path.sep) &&
      fs.existsSync(staticDiskPath)
    ) {
      return { staticPath: staticDiskPath };
    }
  }

  const indexed = cleanId
    ? ALL_INDEXED_MAP.get(cleanId) || PRE_ENRICHED_DRIVE_MAP.get(cleanId)
    : undefined;
  if (indexed) {
    if (indexed.audioUrl.startsWith('/audio/')) {
      const localPath = path.resolve(
        __dirname,
        'public',
        indexed.audioUrl.replace(/^\/+/, '')
      );
      if (
        localPath.startsWith(PUBLIC_AUDIO_DIR + path.sep) &&
        fs.existsSync(localPath)
      ) {
        return { staticPath: localPath };
      }
    }
    if (indexed.audioUrl.startsWith('https://')) {
      return { upstreamUrl: indexed.audioUrl };
    }
  }

  if (explicitAudioUrl && isSafeAudioProxyUrl(explicitAudioUrl, APPROVED_STREAM_URLS)) {
    return { upstreamUrl: explicitAudioUrl };
  }
  if (cleanId.startsWith('gdrive-')) {
    const fileId = cleanId.replace(/^gdrive-/, '');
    return {
      upstreamUrl: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    };
  }
  if (cleanId.startsWith('jamendo-')) {
    const jId = cleanId.replace(/^jamendo-/, '');
    return {
      upstreamUrl: `https://prod-1.storage.jamendo.com/?trackid=${encodeURIComponent(jId)}&format=mp32`,
    };
  }
  return {};
}

async function loadAudioBytesForSong(
  trackId?: string,
  explicitAudioUrl?: string,
  headerOnly = false
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const loc = resolveSongAudioLocation(trackId, explicitAudioUrl);

  if (loc.staticPath) {
    try {
      if (headerOnly) {
        const fd = await fs.promises.open(loc.staticPath, 'r');
        try {
          const buf = Buffer.alloc(262144);
          const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
          return { buffer: buf.subarray(0, bytesRead), mimeType: 'audio/mp3' };
        } finally {
          await fd.close();
        }
      }
      const stat = await fs.promises.stat(loc.staticPath);
      if (stat.size <= 18 * 1024 * 1024) {
        const buf = await fs.promises.readFile(loc.staticPath);
        return { buffer: buf, mimeType: 'audio/mp3' };
      }
    } catch {
      return null;
    }
  }

  if (!loc.upstreamUrl) return null;
  const normalizedUrl = normalizeUpstreamAudioUrl(loc.upstreamUrl);

  const cached = audioBufferCache.get(normalizedUrl);
  if (cached) {
    if (headerOnly) {
      return {
        buffer: cached.buffer.subarray(0, 262144),
        mimeType: cached.contentType === 'audio/mpeg' ? 'audio/mp3' : cached.contentType,
      };
    }
    if (cached.buffer.length <= 18 * 1024 * 1024) {
      return {
        buffer: cached.buffer,
        mimeType: cached.contentType === 'audio/mpeg' ? 'audio/mp3' : cached.contentType,
      };
    }
  }

  try {
    const res = await fetchUpstreamAudioWithFallback(
      normalizedUrl,
      'GET',
      headerOnly ? 'bytes=0-262143' : '',
      AbortSignal.timeout(headerOnly ? 7000 : 25000)
    );
    if (!res.ok && res.status !== 206) return null;
    const rawCt = (res.headers.get('content-type') || '').toLowerCase();
    if (rawCt.includes('text/html')) return null;

    const cl = Number(res.headers.get('content-length') || '0');
    if (!headerOnly && cl > 18 * 1024 * 1024) return null;

    const ct = inferAudioContentType(
      rawCt,
      res.headers.get('content-disposition') || '',
      '',
      normalizedUrl
    );
    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    if (!headerOnly && buf.length > 32768 && buf.length <= 18 * 1024 * 1024) {
      storeAudioBufferInCache(normalizedUrl, buf, ct);
    }
    return {
      buffer: buf,
      mimeType: ct === 'audio/mpeg' ? 'audio/mp3' : ct,
    };
  } catch {
    return null;
  }
}

async function transcribeLyricsFromAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string,
  titleHint?: string,
  artistHint?: string
): Promise<{
  found: boolean;
  syncedLines: SyncedLyricLine[];
  plainLyrics: string;
  instrumental: boolean;
  error?: string;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      found: false,
      syncedLines: [],
      plainLyrics: '',
      instrumental: false,
      error: 'GEMINI_API_KEY belum dikonfigurasi.',
    };
  }

  if (audioBuffer.length < 4096 || audioBuffer.length > 18 * 1024 * 1024) {
    return {
      found: false,
      syncedLines: [],
      plainLyrics: '',
      instrumental: false,
      error: 'Ukuran audio tidak didukung untuk transkrip otomatis (maks 18 MB).',
    };
  }

  const normalizedMime =
    mimeType === 'audio/mpeg' ? 'audio/mp3' : mimeType.split(';')[0] || 'audio/mp3';
  const contextLine =
    titleHint && artistHint
      ? `Song reference metadata (use only to disambiguate spelling if vocals are unclear): "${titleHint}" by "${artistHint}".`
      : '';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: normalizedMime,
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: `Transcribe the sung song lyrics directly from this audio track into synchronized LRC format ([mm:ss.xx] line of lyrics) matching when each line is actually sung in the audio. ${contextLine} Preserve the original sung language accurately (Indonesian, English, Javanese, etc.). Output only LRC lyric lines (or [Instrumental] if there are no sung vocals).`,
          },
        ],
      },
    });

    const rawText = (response.text || '').trim();
    if (!rawText) {
      return {
        found: false,
        syncedLines: [],
        plainLyrics: '',
        instrumental: false,
      };
    }

    if (/^\[?instrumental\]?$/i.test(rawText)) {
      return {
        found: true,
        syncedLines: [],
        plainLyrics: '',
        instrumental: true,
      };
    }

    const syncedLines = parseLrcLyrics(rawText);
    const plainLyrics =
      syncedLines.length > 0
        ? syncedLines.map((l) => l.text).join('\n')
        : rawText.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();

    return {
      found: Boolean(syncedLines.length > 0 || plainLyrics),
      syncedLines,
      plainLyrics,
      instrumental: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal mentranskrip audio lagu.';
    return {
      found: false,
      syncedLines: [],
      plainLyrics: '',
      instrumental: false,
      error: message,
    };
  }
}

async function fetchLyricsFromLrclib(options: {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
}): Promise<LyricsResult> {
  const cleanTitle = options.title
    .replace(/\(Official.*?\)|\[Official.*?\]|\(Lirik.*?\)|\(Lyrics.*?\)/gi, '')
    .trim();
  const cleanArtist =
    options.artist === 'ReyTune Collection' ||
    options.artist === 'File Musik HP' ||
    options.artist === 'DJ Viral TikTok Remix'
      ? ''
      : options.artist.trim();

  const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTitle.toLowerCase()}`;
  const cached = lyricsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 24 * 60 * 60 * 1000) {
    return cached;
  }

  type LrcRecord = {
    id?: number;
    trackName?: string;
    name?: string;
    artistName?: string;
    albumName?: string;
    instrumental?: boolean;
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
  };

  const toResult = (rec: LrcRecord | null | undefined): LyricsResult => {
    if (!rec) {
      return {
        updatedAt: now,
        found: false,
        syncedLines: [],
        plainLyrics: '',
        instrumental: false,
        source: 'lrclib',
      };
    }
    const syncedLines = rec.syncedLyrics ? parseLrcLyrics(rec.syncedLyrics) : [];
    const plainLyrics = (rec.plainLyrics || '').trim();
    const found = Boolean(rec.instrumental || syncedLines.length > 0 || plainLyrics);
    return {
      updatedAt: now,
      found,
      trackName: rec.trackName || rec.name || cleanTitle,
      artistName: rec.artistName || cleanArtist,
      albumName: rec.albumName || options.album,
      syncedLines,
      plainLyrics,
      instrumental: Boolean(rec.instrumental),
      source: 'lrclib',
    };
  };

  try {
    if (cleanTitle && cleanArtist) {
      const getParams = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist,
      });
      if (options.album && !options.album.includes('Single')) {
        getParams.set('album_name', options.album);
      }
      if (options.durationSec && options.durationSec > 30) {
        getParams.set('duration', String(Math.round(options.durationSec)));
      }

      const exactRes = await fetch(
        `https://lrclib.net/api/get?${getParams.toString()}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ReyTune/1.0 (https://reytune.app)',
          },
          signal: AbortSignal.timeout(4500),
        }
      ).catch(() => null);

      if (exactRes && exactRes.ok) {
        const hit = (await exactRes.json()) as LrcRecord;
        const parsed = toResult(hit);
        if (parsed.found) {
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        }
      }
    }

    const q = [cleanArtist, cleanTitle].filter(Boolean).join(' ').trim();
    if (q) {
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ReyTune/1.0 (https://reytune.app)',
          },
          signal: AbortSignal.timeout(5000),
        }
      ).catch(() => null);

      if (searchRes && searchRes.ok) {
        const list = (await searchRes.json()) as LrcRecord[];
        if (Array.isArray(list) && list.length > 0) {
          const best =
            list.find((r) => Boolean(r.syncedLyrics)) ||
            list.find((r) => Boolean(r.plainLyrics)) ||
            list[0];
          const parsed = toResult(best);
          if (parsed.found) {
            lyricsCache.set(cacheKey, parsed);
            return parsed;
          }
        }
      }
    }
  } catch {
    // Graceful fallback if LRCLIB is unreachable
  }

  return toResult(null);
}

async function resolveAutomaticSongLyrics(options: {
  trackId?: string;
  audioUrl?: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  autoFromAudio?: boolean;
  forceRefresh?: boolean;
}): Promise<LyricsResult> {
  const now = Date.now();
  const transcribeConfigured = Boolean(getGeminiClient());
  const idCacheKey = options.trackId ? `id::${options.trackId}` : '';

  if (!options.forceRefresh && idCacheKey) {
    const cached = lyricsCache.get(idCacheKey);
    if (cached && cached.found && now - cached.updatedAt < 24 * 60 * 60 * 1000) {
      return { ...cached, transcribeConfigured };
    }
  }

  // Tier 1: Extract embedded USLT / SYLT lyrics & real TIT2/TPE1 tags directly from the song's audio file
  let id3Title: string | undefined;
  let id3Artist: string | undefined;
  if (options.trackId || options.audioUrl) {
    const headerSlice = await loadAudioBytesForSong(
      options.trackId,
      options.audioUrl,
      true
    );
    if (headerSlice) {
      const id3 = parseId3FromBytes(headerSlice.buffer);
      id3Title = id3.title;
      id3Artist = id3.artist;
      if (id3.syncedLines.length > 0 || id3.plainLyrics) {
        const result: LyricsResult = {
          updatedAt: now,
          found: true,
          trackName: id3.title || options.title,
          artistName: id3.artist || options.artist,
          albumName: id3.album || options.album,
          syncedLines: id3.syncedLines,
          plainLyrics: id3.plainLyrics,
          instrumental: false,
          source: 'id3',
          transcribeConfigured,
        };
        if (idCacheKey) lyricsCache.set(idCacheKey, result);
        return result;
      }
    }
  }

  // Tier 2: Lookup synced lyrics via LRCLIB using track metadata and any ID3-embedded TIT2/TPE1 tags
  const lrclibHit = await fetchLyricsFromLrclib({
    title: options.title,
    artist: options.artist,
    album: options.album,
    durationSec: options.durationSec,
  });
  if (lrclibHit.found) {
    const result = { ...lrclibHit, transcribeConfigured };
    if (idCacheKey) lyricsCache.set(idCacheKey, result);
    return result;
  }

  if (
    id3Title &&
    (id3Title.toLowerCase() !== options.title.toLowerCase() ||
      (id3Artist && id3Artist.toLowerCase() !== options.artist.toLowerCase()))
  ) {
    const id3LrclibHit = await fetchLyricsFromLrclib({
      title: id3Title,
      artist: id3Artist || options.artist,
      album: options.album,
      durationSec: options.durationSec,
    });
    if (id3LrclibHit.found) {
      const result = { ...id3LrclibHit, transcribeConfigured };
      if (idCacheKey) lyricsCache.set(idCacheKey, result);
      return result;
    }
  }

  // Tier 3: Automatic Audio-to-Lyrics transcription directly from the song audio (Gemini 3.5 Transcribe)
  let transcribeError: string | undefined;
  if (options.autoFromAudio !== false && transcribeConfigured) {
    const fullAudio = await loadAudioBytesForSong(
      options.trackId,
      options.audioUrl,
      false
    );
    if (fullAudio) {
      const transcribed = await transcribeLyricsFromAudioBuffer(
        fullAudio.buffer,
        fullAudio.mimeType,
        id3Title || options.title,
        id3Artist || options.artist
      );
      if (transcribed.found) {
        const result: LyricsResult = {
          updatedAt: now,
          found: true,
          trackName: id3Title || options.title,
          artistName: id3Artist || options.artist,
          albumName: options.album,
          syncedLines: transcribed.syncedLines,
          plainLyrics: transcribed.plainLyrics,
          instrumental: transcribed.instrumental,
          source: 'audio-transcribe',
          transcribeConfigured,
        };
        if (idCacheKey) lyricsCache.set(idCacheKey, result);
        return result;
      }
      transcribeError = transcribed.error;
    }
  }

  return {
    updatedAt: now,
    found: false,
    syncedLines: [],
    plainLyrics: '',
    instrumental: false,
    source: 'none',
    transcribeConfigured,
    transcribeError,
  };
}

function filterCatalogByGenre(
  driveTracks: Track[],
  ytMusicTracks: Track[],
  genre: string
): Track[] {
  const g = genre.trim().toLowerCase();
  const combinedAll = dedupeTracks([...driveTracks, ...ytMusicTracks]);

  if (!g || g === 'all') {
    return combinedAll;
  }
  if (g === 'ytmusic') {
    return dedupeTracks([...ytMusicTracks]);
  }
  if (g === 'drive') {
    return driveTracks;
  }
  if (g === 'trending') {
    const topYtm = ytMusicTracks.slice(0, 25);
    const featuredDrive = driveTracks.filter(
      (t) =>
        t.featured ||
        /Tulus|Raim Laode|Nadhif|Juicy Luicy|Sal Priadi|Idgitaf|Judika|ROSÉ|Bruno Mars|The 1975|Rex Orange County|Hindia|Pamungkas/i.test(
          t.artist
        )
    );
    return dedupeTracks([
      ...featuredDrive.slice(0, 15),
      ...topYtm,
      ...featuredDrive.slice(15),
    ]);
  }
  if (g === 'indonesia') {
    const indoDrive = driveTracks.filter(
      (t) =>
        t.genre.toLowerCase().includes('indo') ||
        /Tulus|Raim Laode|Nadhif|Juicy Luicy|Sal Priadi|Idgitaf|Judika|Armada|Fiersa|NOAH|Lyla|Bagindas|Ungu|Denny Caknan|Hindia|Pamungkas|Misellia|Keisya|Mahen|Rony Parulian|Samuel Cipta|Anggis Devaki|ILIR7|Hal|HAL|Amigdala|Samsons|Repvblik|Yovie|Tipe-X|Ebiet|Anji|Rizky Febian|Aldy Maldini|Kaleb|Mario G|Angga Candra|Piche Kota|Overnight|eńau|eńau/i.test(
          t.artist
        )
    );
    return dedupeTracks([...indoDrive, ...ytMusicTracks]);
  }
  if (g === 'pop') {
    const popDrive = driveTracks.filter(
      (t) =>
        t.genre === 'Pop Indo' ||
        /Tulus|Juicy Luicy|Nadhif|Mahalini|Judika|Sal Priadi|Idgitaf|Rizky Febian|Keisya|Mahen|Rony Parulian|Armada|NOAH|Samsons|Repvblik|Yovie|Kaleb|Anggis Devaki|Misellia/i.test(
          t.artist
        )
    );
    return dedupeTracks([...ytMusicTracks.slice(0, 30), ...popDrive]);
  }
  if (g === 'barat') {
    return driveTracks.filter((t) => t.genre === 'Barat Hits');
  }
  if (g === 'viral') {
    const viralDrive = driveTracks.filter(
      (t) =>
        t.genre === 'Viral TikTok' ||
        /APT|Sesi Potret|Sailor Song|Kita Lewati Berdua|Jatuh Suka|Sedia Aku Sebelum Hujan|Kota Ini Tak Sama|Negoro Angin|The One That Got Away|Gata Only|Love Nwantiti|Somebody's Pleasure|Mary On A Cross|Angel Baby|Copines|Paro|Dandelions|People/i.test(
          t.title
        )
    );
    return dedupeTracks([...viralDrive, ...ytMusicTracks.slice(0, 20)]);
  }
  if (g === 'chill' || g === 'lofi') {
    return combinedAll.filter(
      (t) =>
        t.genre === 'Chill' ||
        /Raim Laode|Nadhif|Tulus|Fiersa|Sal Priadi|Amigdala|Pamungkas|Rex Orange County|Lana Del Rey|Radiohead|yaeow|Kina|Payung Teduh|Fourtwnty|Nadin Amizah|Feby Putri|Hindia|Kunto Aji|Barasuara|Mocca|Hal|HAL/i.test(
          t.artist
        )
    );
  }
  return combinedAll;
}

function serveCachedAudioBuffer(
  cached: { buffer: Buffer; contentType: string },
  req: express.Request,
  res: express.Response,
  isDownload: boolean,
  title: string,
  artist: string
): void {
  const total = cached.buffer.length;
  res.setHeader('Content-Type', cached.contentType || 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges'
  );

  if (isDownload) {
    const filename = sanitizeDownloadFilename(title, artist);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }

  const incomingRange =
    typeof req.headers.range === 'string' ? req.headers.range.trim() : '';

  if (incomingRange) {
    const match = /bytes=(\d*)-(\d*)/.exec(incomingRange);
    if (match) {
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (!match[1] && match[2]) {
        const suffixLen = parseInt(match[2], 10);
        start = Math.max(0, total - suffixLen);
        end = total - 1;
      }
      if (start >= total || start < 0 || end < start) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      end = Math.min(end, total - 1);
      const slice = cached.buffer.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(slice.length));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(slice);
      return;
    }
  }

  res.status(200);
  res.setHeader('Content-Length', String(total));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(cached.buffer);
}

async function pipeUpstreamAudio(
  rawUrl: string,
  req: express.Request,
  res: express.Response,
  isDownload: boolean,
  title: string,
  artist: string,
  skipInlineCache = false
) {
  const normalizedUrl = normalizeUpstreamAudioUrl(rawUrl);

  // 1. Serve immediately (<1ms) if the full MP3 is already in our RAM buffer cache
  if (!skipInlineCache) {
    const cached = audioBufferCache.get(normalizedUrl);
    if (cached) {
      // Refresh LRU order
      audioBufferCache.delete(normalizedUrl);
      audioBufferCache.set(normalizedUrl, cached);
      serveCachedAudioBuffer(cached, req, res, isDownload, title, artist);
      return;
    }
  }

  const incomingRange =
    typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
  const isFullRangeFromStart = incomingRange === 'bytes=0-';

  // Only warm in background for small probes (e.g. Safari bytes=0-1 or HEAD).
  // For GET without Range or Chrome's Range: bytes=0-, stream once and cache inline in 1 pass!
  if (!skipInlineCache && ((incomingRange && !isFullRangeFromStart) || req.method === 'HEAD')) {
    void warmTrackBuffer(normalizedUrl);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  const onResponseClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', onResponseClose);

  try {
    const upstream = await fetchUpstreamAudioWithFallback(
      normalizedUrl,
      req.method === 'HEAD' ? 'HEAD' : 'GET',
      incomingRange,
      controller.signal
    );

    if (!upstream.ok && upstream.status !== 206) {
      res
        .status(upstream.status)
        .json({ error: 'Failed to fetch upstream audio' });
      return;
    }

    const rawContentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (rawContentType.includes('text/html')) {
      res
        .status(403)
        .json({ error: 'Upstream returned HTML instead of audio stream' });
      return;
    }

    const contentDisposition = upstream.headers.get('content-disposition') || '';
    const contentType = inferAudioContentType(
      rawContentType,
      contentDisposition,
      title,
      normalizedUrl
    );
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges'
    );
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (isDownload) {
      const filename = sanitizeDownloadFilename(title, artist);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const startsAtZero =
      !incomingRange ||
      (isFullRangeFromStart &&
        (!contentRange || contentRange.startsWith('bytes 0-')));
    const shouldCacheInline =
      !skipInlineCache &&
      startsAtZero &&
      req.method === 'GET' &&
      (!contentLength || Number(contentLength) <= 22 * 1024 * 1024);
    const cacheChunks: Buffer[] = [];
    let cacheBytes = 0;
    let streamCompleted = false;

    const nodeStream = Readable.fromWeb(
      upstream.body as Parameters<typeof Readable.fromWeb>[0]
    );
    if (shouldCacheInline) {
      nodeStream.on('data', (chunk: Buffer) => {
        if (cacheBytes + chunk.length <= 22 * 1024 * 1024) {
          cacheChunks.push(chunk);
          cacheBytes += chunk.length;
        }
      });
      nodeStream.on('end', () => {
        streamCompleted = true;
        if (cacheBytes > 32768) {
          storeAudioBufferInCache(
            normalizedUrl,
            Buffer.concat(cacheChunks),
            contentType
          );
        }
      });
    }
    res.on('close', () => {
      if (!res.writableEnded && !streamCompleted) {
        nodeStream.destroy();
      }
    });
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
  } finally {
    clearTimeout(timeoutId);
    res.off('close', onResponseClose);
  }
}

async function startServer() {
  const app = express();

  // Self-destructing /sw.js and /dev-sw.js endpoints to cleanly evict any stale VitePWA service worker
  app.get(['/sw.js', '/dev-sw.js'], (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(
      `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        });
      })
  );
});`
    );
  });

  app.get('/registerSW.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send('// Service Worker registration disabled in preview\n');
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'ReyTune',
      defaultDriveFolderId: DEFAULT_DRIVE_FOLDER_ID,
      driveTracksCount: DRIVE_FOLDER_TRACKS.length,
      ytMusicTracksCount: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
      totalCatalogCount: ALL_INDEXED_TRACKS.length,
      jamendoConfigured: Boolean(getJamendoClientId()),
    });
  });

  // Direct Google Drive folder inspection / sync endpoint
  app.get('/api/music/drive', async (req, res) => {
    const folderInput = String(
      req.query.folder || DEFAULT_DRIVE_FOLDER_ID
    ).trim();
    const refresh = req.query.refresh === '1';
    const result = await getDriveFolderTracks(folderInput, refresh);
    res.json({
      folderId: result.folderId,
      count: result.tracks.length,
      live: result.live,
      tracks: result.tracks,
      error: result.error,
    });
  });

  // Direct Jamendo / Openverse Free MP3 endpoint (Zero API key fallback!)
  app.get('/api/music/jamendo', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const tags = String(req.query.tags || req.query.tag || '').trim();
    const limit = Number(req.query.limit || 25) || 25;
    const result = await fetchJamendoTracks({
      query: q,
      tags,
      order: q ? 'relevance' : 'popularity_month',
      limit,
    });
    res.json({
      configured: result.configured,
      viaOpenverse: Boolean(result.viaOpenverse),
      query: q,
      tags,
      count: result.tracks.length,
      tracks: result.tracks,
      live: result.tracks.length > 0 || (result.configured && !result.error),
      error: result.error,
    });
  });

  // Direct Openverse Creative Commons Free Audio endpoint (Zero API Key)
  app.get('/api/music/openverse', async (req, res) => {
    const q = String(req.query.q || 'chill acoustic pop').trim();
    const source = String(req.query.source || '').trim();
    const limit = Number(req.query.limit || 20) || 20;
    const tracks = await fetchOpenverseTracks({ query: q, source, limit });
    res.json({
      query: q,
      count: tracks.length,
      tracks,
      live: tracks.length > 0,
    });
  });

  // Direct Internet Archive Open Audio endpoint (Zero API Key, 100% Free Full MP3)
  app.get('/api/music/archive', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 18) || 18;
    const tracks = await fetchInternetArchiveTracks(q, limit);
    res.json({
      query: q,
      count: tracks.length,
      tracks,
      live: tracks.length > 0,
    });
  });

  // Direct Audius Free Streaming API endpoint (Zero API Key, genre & search support)
  app.get('/api/music/audius', async (req, res) => {
    const q = String(req.query.q || 'trending').trim();
    const genre = String(req.query.genre || '').trim();
    const limit = Number(req.query.limit || 25) || 25;
    const tracks = await fetchAudiusTracks(q, limit, genre);
    res.json({
      query: q,
      genre,
      count: tracks.length,
      tracks,
      live: tracks.length > 0,
    });
  });

  // Direct Hearthis.at Free Streaming API endpoint (Zero API Key, spam-filtered)
  app.get('/api/music/hearthis', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 25) || 25;
    const tracks = q
      ? await searchHearthisTracks(q, limit)
      : await fetchHearthisFeedTracks('popular', limit);
    res.json({
      query: q,
      count: tracks.length,
      tracks,
      live: tracks.length > 0,
    });
  });

  // Direct Radio Browser API endpoint (Indonesian & Global Live Radio, Zero API Key)
  app.get('/api/music/radio', async (req, res) => {
    const country = String(req.query.country || 'ID').trim();
    const limit = Number(req.query.limit || 25) || 25;
    const tracks = await fetchRadioBrowserStations(country, limit);
    res.json({
      country,
      count: tracks.length,
      tracks,
      live: true,
    });
  });

  // Automatic Song-Derived Lyrics endpoint (ID3 USLT/SYLT -> LRCLIB -> Gemini 3.5 Transcribe)
  app.get('/api/music/lyrics', async (req, res) => {
    const trackId = String(req.query.id || '').trim();
    const audioUrl = String(req.query.audioUrl || '').trim();
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const album = String(req.query.album || '').trim();
    const durationSec = Number(req.query.duration || 0) || 0;
    const autoFromAudio = String(req.query.autoFromAudio || '1') !== '0';
    const forceRefresh = String(req.query.refresh || '') === '1';

    if (!title && !trackId) {
      res.status(400).json({ found: false, syncedLines: [], plainLyrics: '', error: 'Missing track title' });
      return;
    }

    const result = await resolveAutomaticSongLyrics({
      trackId,
      audioUrl,
      title: title || trackId,
      artist,
      album,
      durationSec,
      autoFromAudio,
      forceRefresh,
    });
    res.json(result);
  });

  // Extract or transcribe lyrics directly from uploaded local audio bytes (for mobile device MP3s)
  app.post(
    '/api/music/lyrics-from-audio',
    express.json({ limit: '24mb' }),
    async (req, res) => {
      const body = (req.body || {}) as {
        trackId?: string;
        base64Audio?: string;
        mimeType?: string;
        title?: string;
        artist?: string;
      };
      if (!body.base64Audio) {
        res.status(400).json({ found: false, syncedLines: [], plainLyrics: '', error: 'Missing audio payload' });
        return;
      }

      const audioBuffer = Buffer.from(body.base64Audio, 'base64');
      const id3 = parseId3FromBytes(audioBuffer.subarray(0, 262144));
      if (id3.syncedLines.length > 0 || id3.plainLyrics) {
        res.json({
          found: true,
          trackName: id3.title || body.title,
          artistName: id3.artist || body.artist,
          albumName: id3.album,
          syncedLines: id3.syncedLines,
          plainLyrics: id3.plainLyrics,
          instrumental: false,
          source: 'id3',
          transcribeConfigured: Boolean(getGeminiClient()),
        });
        return;
      }

      const transcribed = await transcribeLyricsFromAudioBuffer(
        audioBuffer,
        body.mimeType || 'audio/mp3',
        id3.title || body.title,
        id3.artist || body.artist
      );
      res.json({
        found: transcribed.found,
        trackName: id3.title || body.title,
        artistName: id3.artist || body.artist,
        syncedLines: transcribed.syncedLines,
        plainLyrics: transcribed.plainLyrics,
        instrumental: transcribed.instrumental,
        source: transcribed.found ? 'audio-transcribe' : 'none',
        transcribeConfigured: Boolean(getGeminiClient()),
        transcribeError: transcribed.error,
      });
    }
  );

  // Direct YouTube Music search & trending API endpoint
  app.get('/api/music/ytmusic', async (req, res) => {
    const q = String(
      req.query.q || 'Lagu Pop Indonesia Terpopuler Viral'
    ).trim();
    const liveYtm = await searchYouTubeMusicApi(q, 25);
    registerDiscoveredTracks(liveYtm);
    const combined = dedupeTracks([
      ...liveYtm,
      ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
    ]);
    res.json({
      query: q,
      liveCount: liveYtm.length,
      count: combined.length,
      tracks: combined,
      live: true,
    });
  });

  // Smart Audio Stream Resolver for YouTube Music tracks (mounted on both /api/ytm-track.mp3 and /api/music/ytm-audio)
  app.all(['/api/ytm-track.mp3', '/api/music/ytm-audio'], async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    const title = String(req.query.title || 'Track').trim();
    const artist = String(req.query.artist || 'Artist').trim();
    const isDownload = req.query.download === '1';

    try {
      const resolvedUrl = await resolveYouTubeMusicAudioUrl(
        videoId,
        title,
        artist
      );
      if (!resolvedUrl || !isSafeAudioProxyUrl(resolvedUrl, APPROVED_STREAM_URLS)) {
        res.status(404).json({ error: 'Could not resolve audio stream' });
        return;
      }
      await pipeUpstreamAudio(
        resolvedUrl,
        req,
        res,
        isDownload,
        title,
        artist
      );
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'YouTube Music audio proxy failed' });
      }
    }
  });

  // Discover complete music catalog (Google Drive + YouTube Music + Audius + Hearthis + Openverse/Jamendo + Internet Archive + Radio)
  app.get('/api/music/discover', async (req, res) => {
    const genre = String(req.query.genre || 'all')
      .trim()
      .toLowerCase();
    const audiusGenre = String(req.query.audiusGenre || '').trim();
    const folderInput = String(
      req.query.folder || DEFAULT_DRIVE_FOLDER_ID
    ).trim();
    const refresh = req.query.refresh === '1';
    const jamendoConfigured = true; // Always available via Jamendo API or Openverse zero-key index

    try {
      if (genre === 'radio') {
        const stations = await fetchRadioBrowserStations('ID', 25);
        res.json({
          folderId: DEFAULT_DRIVE_FOLDER_ID,
          totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
          totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
          totalJamendoTracks: 0,
          jamendoConfigured,
          tracks: stations,
          live: true,
        });
        return;
      }

      if (genre === 'audius') {
        const audiusTracks = await fetchAudiusTracks(
          audiusGenre === 'underground' ? 'underground' : 'trending',
          28,
          audiusGenre === 'underground' ? '' : audiusGenre
        );
        res.json({
          folderId: DEFAULT_DRIVE_FOLDER_ID,
          totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
          totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
          totalJamendoTracks: 0,
          jamendoConfigured,
          tracks: audiusTracks,
          live: true,
        });
        return;
      }

      if (genre === 'hearthis') {
        const hearthisTracks = await fetchHearthisFeedTracks('popular', 28);
        res.json({
          folderId: DEFAULT_DRIVE_FOLDER_ID,
          totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
          totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
          totalJamendoTracks: 0,
          jamendoConfigured,
          tracks: hearthisTracks,
          live: hearthisTracks.length > 0,
        });
        return;
      }

      if (genre === 'archive') {
        const archiveTracks = await fetchInternetArchiveTracks('', 20);
        res.json({
          folderId: DEFAULT_DRIVE_FOLDER_ID,
          totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
          totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
          totalJamendoTracks: 0,
          jamendoConfigured,
          tracks: archiveTracks,
          live: archiveTracks.length > 0,
        });
        return;
      }

      if (genre === 'jamendo' || genre === 'openverse') {
        const jamendoRes = await fetchJamendoTracks({
          order: 'popularity_month',
          limit: 25,
        });
        res.json({
          folderId: DEFAULT_DRIVE_FOLDER_ID,
          totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
          totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
          totalJamendoTracks: jamendoRes.tracks.length,
          jamendoConfigured: jamendoRes.configured,
          jamendoError: jamendoRes.error,
          tracks: jamendoRes.tracks,
          live: jamendoRes.tracks.length > 0,
        });
        return;
      }

      const shouldFetchDirectJamendo =
        Boolean(getJamendoClientId()) &&
        (genre === 'all' ||
          genre === 'trending' ||
          genre === 'pop' ||
          genre === 'chill' ||
          genre === 'lofi');

      const [driveResult, jamendoExtraRes, audiusExtras] = await Promise.all([
        getDriveFolderTracks(folderInput, refresh),
        shouldFetchDirectJamendo
          ? fetchJamendoTracks({
              tags:
                genre === 'pop'
                  ? 'pop'
                  : genre === 'chill' || genre === 'lofi'
                  ? 'chillout'
                  : undefined,
              order: 'popularity_month',
              limit: 12,
            })
          : Promise.resolve({ configured: true, tracks: [] as Track[] }),
        genre === 'chill' || genre === 'lofi'
          ? fetchAudiusTracks('trending', 10, 'Lo-Fi')
          : genre === 'trending'
          ? fetchAudiusTracks('trending', 10)
          : Promise.resolve([] as Track[]),
      ]);

      const filtered = filterCatalogByGenre(
        driveResult.tracks,
        YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
        genre
      );

      let onlineExtras: Track[] = [];
      if (genre === 'ytmusic' && refresh) {
        onlineExtras = await searchYouTubeMusicApi(
          'Lagu Indonesia Terpopuler Hits',
          20
        );
      } else if (genre === 'chill' || genre === 'lofi') {
        onlineExtras = LOCAL_BUNDLED_TRACKS;
      }

      const combined = dedupeTracks([
        ...onlineExtras,
        ...filtered,
        ...audiusExtras,
        ...jamendoExtraRes.tracks,
      ]);
      registerDiscoveredTracks(combined);

      res.json({
        folderId: driveResult.folderId,
        totalDriveTracks: driveResult.tracks.length,
        totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
        totalJamendoTracks: jamendoExtraRes.tracks.length,
        jamendoConfigured,
        tracks: combined,
        live: driveResult.live,
        driveError: driveResult.error,
      });
    } catch {
      const fallback = filterCatalogByGenre(
        DRIVE_FOLDER_TRACKS,
        YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
        genre
      );
      res.json({
        folderId: DEFAULT_DRIVE_FOLDER_ID,
        totalDriveTracks: DRIVE_FOLDER_TRACKS.length,
        totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
        totalJamendoTracks: 0,
        jamendoConfigured,
        tracks: fallback,
        live: true,
      });
    }
  });

  // Search full-length tracks across Google Drive + Audius + Hearthis.at + Jamendo/Openverse CC + Internet Archive + YouTube Music
  app.get('/api/music/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const folderInput = String(
      req.query.folder || DEFAULT_DRIVE_FOLDER_ID
    ).trim();
    const jamendoConfigured = true;

    if (!q) {
      res.json({
        tracks: dedupeTracks([
          ...DRIVE_FOLDER_TRACKS,
          ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
        ]),
        jamendoConfigured,
        live: true,
      });
      return;
    }

    const normalizedQ = q.toLowerCase();

    try {
      const [
        driveResult,
        ytmLiveTracks,
        jamendoResult,
        hearthisTracks,
        audiusTracks,
        archiveTracks,
      ] = await Promise.all([
        getDriveFolderTracks(folderInput, false),
        searchYouTubeMusicApi(q, 14),
        fetchJamendoTracks({ query: q, limit: 12 }),
        searchHearthisTracks(q, 12),
        fetchAudiusTracks(q, 14),
        fetchInternetArchiveTracks(q, 8),
      ]);

      const driveMatches = driveResult.tracks.filter(
        (t) =>
          t.title.toLowerCase().includes(normalizedQ) ||
          t.artist.toLowerCase().includes(normalizedQ) ||
          t.album.toLowerCase().includes(normalizedQ) ||
          t.genre.toLowerCase().includes(normalizedQ)
      );

      const indexedYtmMatches = YOUTUBE_MUSIC_AND_ONLINE_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(normalizedQ) ||
          t.artist.toLowerCase().includes(normalizedQ) ||
          t.album.toLowerCase().includes(normalizedQ)
      );

      const localMatches = LOCAL_BUNDLED_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(normalizedQ) ||
          t.artist.toLowerCase().includes(normalizedQ)
      );

      // Prioritize direct, instant-playable full-length MP3 sources first
      let combined = dedupeTracks([
        ...driveMatches,
        ...indexedYtmMatches,
        ...audiusTracks,
        ...jamendoResult.tracks,
        ...hearthisTracks,
        ...archiveTracks,
        ...ytmLiveTracks,
        ...localMatches,
      ]);

      // If very few full-length hits matched, also include official 30s iTunes previews so user still finds mainstream songs
      if (combined.length < 4) {
        const itunesPreviews = await fetchItunesPreviewTracks(q, 6);
        combined = dedupeTracks([...combined, ...itunesPreviews]);
      }

      registerDiscoveredTracks(combined);

      res.json({
        tracks: combined,
        driveMatchCount: driveMatches.length,
        ytMusicMatchCount: indexedYtmMatches.length + ytmLiveTracks.length,
        jamendoMatchCount: jamendoResult.tracks.length,
        audiusMatchCount: audiusTracks.length,
        hearthisMatchCount: hearthisTracks.length,
        archiveMatchCount: archiveTracks.length,
        jamendoConfigured,
        live: true,
      });
    } catch {
      const fallbackMatches = ALL_INDEXED_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(normalizedQ) ||
          t.artist.toLowerCase().includes(normalizedQ) ||
          t.album.toLowerCase().includes(normalizedQ)
      );
      res.json({ tracks: fallbackMatches, jamendoConfigured, live: true });
    }
  });

  // Clean static-style MP3 route (/audio/tracks/:trackParam) for instant mobile <audio> playback & .mp3 downloads
  app.all('/audio/tracks/:trackParam', async (req, res) => {
    const rawParam = String(req.params.trackParam || '').replace(/\.mp3$/i, '');
    const isDownload = req.query.download === '1';

    const track = ALL_INDEXED_MAP.get(rawParam) || PRE_ENRICHED_DRIVE_MAP.get(rawParam);
    const title = String(req.query.title || track?.title || 'Track');
    const artist = String(req.query.artist || track?.artist || 'ReyTune');

    // 1. If a static MP3 file exists on disk in /public/audio/tracks/, serve it natively (for both playback AND downloads!)
    const safeBasename = rawParam.replace(/[^a-zA-Z0-9_-]/g, '');
    const staticDiskPath = path.resolve(STATIC_TRACKS_DIR, `${safeBasename}.mp3`);
    if (
      safeBasename &&
      staticDiskPath.startsWith(STATIC_TRACKS_DIR + path.sep) &&
      fs.existsSync(staticDiskPath)
    ) {
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (isDownload) {
        const filename = sanitizeDownloadFilename(title, artist);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      res.sendFile(staticDiskPath);
      return;
    }

    const queryUrl = String(req.query.url || '');
    const targetUrl =
      track && track.audioUrl.startsWith('https://')
        ? track.audioUrl
        : isSafeAudioProxyUrl(queryUrl, APPROVED_STREAM_URLS)
        ? queryUrl
        : rawParam.startsWith('gdrive-')
        ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(rawParam.replace(/^gdrive-/, ''))}&export=download&confirm=t`
        : rawParam.startsWith('jamendo-')
        ? `https://prod-1.storage.jamendo.com/?trackid=${encodeURIComponent(rawParam.replace(/^jamendo-/, ''))}&format=mp32`
        : rawParam.startsWith('audius-')
        ? `https://api.audius.co/v1/tracks/${encodeURIComponent(rawParam.replace(/^audius-/, ''))}/stream?app_name=ReyTune`
        : '';

    if (!targetUrl || !isSafeAudioProxyUrl(targetUrl, APPROVED_STREAM_URLS)) {
      res.status(404).json({ error: 'Track audio not found' });
      return;
    }

    const isInfiniteStream = rawParam.startsWith('radio-') || track?.source === 'radio';

    try {
      await pipeUpstreamAudio(targetUrl, req, res, isDownload, title, artist, isInfiniteStream);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Audio stream failed' });
      }
    }
  });

  // Proxy audio stream (mounted on /api/stream-track.mp3 to bypass any stale Service Worker regex, plus /api/music/audio)
  app.all(['/api/stream-track.mp3', '/api/music/audio'], async (req, res) => {
    const trackId = String(req.query.id || '').trim();
    const indexedTrack = trackId ? ALL_INDEXED_MAP.get(trackId) : undefined;
    const rawUrl = String(
      req.query.url || (indexedTrack?.audioUrl.startsWith('https://') ? indexedTrack.audioUrl : '')
    );
    const isDownload = req.query.download === '1';
    const title = String(req.query.title || indexedTrack?.title || 'Track');
    const artist = String(req.query.artist || indexedTrack?.artist || 'ReyTune');

    if (!isSafeAudioProxyUrl(rawUrl, APPROVED_STREAM_URLS)) {
      res.status(400).json({ error: 'Invalid or unsupported audio URL' });
      return;
    }

    const isInfiniteStream = trackId.startsWith('radio-') || indexedTrack?.source === 'radio';

    try {
      await pipeUpstreamAudio(rawUrl, req, res, isDownload, title, artist, isInfiniteStream);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Audio stream proxy failed' });
      }
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ReyTune server listening on http://localhost:${PORT}`);
    prewarmInitialCatalog().catch(() => undefined);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ReyTune server:', err);
  process.exit(1);
});
