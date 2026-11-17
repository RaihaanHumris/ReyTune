import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import {
  DEFAULT_DRIVE_FOLDER_ID,
  DRIVE_FOLDER_TRACKS,
  LOCAL_BUNDLED_TRACKS,
  YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
} from './src/data/tracks.ts';
import type { Track } from './src/types/music.ts';
import {
  extractDriveFolderId,
  isSafeAudioProxyUrl,
  normalizeAudiusTrack,
  normalizeDriveTrack,
  normalizeHearthisTrack,
  parseDriveEmbeddedFolderHtml,
  parseYouTubeMusicSearchResponse,
  sanitizeDownloadFilename,
  type RawAudiusTrack,
  type RawHearthisTrack,
} from './src/utils/musicNormalizer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Cache of synced Google Drive folders (folderId -> { updatedAt, tracks })
const driveFolderCache = new Map<
  string,
  { updatedAt: number; tracks: Track[] }
>();

// Cache of resolved audio URLs for YouTube Music tracks (key -> resolved upstream audio URL)
const ytmAudioUrlCache = new Map<string, string>();

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
      4000
    );
    if (!Array.isArray(rawList)) return [];
    return rawList
      .map(normalizeHearthisTrack)
      .filter((t): t is Track => t !== null);
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
    return indexedMatch.audioUrl;
  }

  const cleanQ = `${artist} ${title}`.replace(/\(.*?\)|\[.*?\]/g, '').trim();

  // 2. Try Hearthis.at full MP3 (strict Artist + Title match)
  try {
    const rawList = await fetchJsonWithTimeout<RawHearthisTrack[]>(
      `https://api-v2.hearthis.at/search?t=${encodeURIComponent(cleanQ)}&page=1&count=6`,
      3800
    );
    if (Array.isArray(rawList)) {
      const titleWords = normTitle.split(/\s+/).filter((w) => w.length > 2);
      const artistWords = normArtist.split(/\s+/).filter((w) => w.length > 2);
      const hit = rawList.find((item) => {
        const d = Number(item.duration || 0);
        const itemTitle = String(item.title || '').toLowerCase();
        const hasTitle =
          titleWords.length === 0 || titleWords.some((w) => itemTitle.includes(w));
        const hasArtist =
          artistWords.length === 0 || artistWords.some((w) => itemTitle.includes(w));
        return d >= 90 && d <= 540 && Boolean(item.stream_url) && hasTitle && hasArtist;
      });
      if (hit?.stream_url) {
        ytmAudioUrlCache.set(cacheKey, hit.stream_url);
        return hit.stream_url;
      }
    }
  } catch {
    // Continue to next tier
  }

  // 3. Try Audius full MP3 stream (minimum 120s full track)
  try {
    const audiusRes = await fetchJsonWithTimeout<{ data?: RawAudiusTrack[] }>(
      `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(cleanQ)}&limit=6&app_name=ReyTune`,
      3800
    );
    const list = audiusRes?.data || [];
    const titleWords = normTitle.split(/\s+/).filter((w) => w.length > 2);
    const hit = list.find((item) => {
      const d = Number(item.duration || 0);
      const itemTitle = String(item.title || '').toLowerCase();
      return (
        d >= 120 &&
        d <= 540 &&
        Boolean(item.id) &&
        titleWords.some((w) => itemTitle.includes(w))
      );
    });
    if (hit?.id) {
      const streamUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(String(hit.id))}/stream?app_name=ReyTune`;
      ytmAudioUrlCache.set(cacheKey, streamUrl);
      return streamUrl;
    }
  } catch {
    // Continue to next tier
  }

  // 4. Fallback to full-length track by same artist from Google Drive or Online Full MP3 catalog
  const artistFullFallback =
    ALL_INDEXED_TRACKS.find((t) =>
      t.artist.toLowerCase().includes(normArtist)
    ) || DRIVE_FOLDER_TRACKS[0];
  return artistFullFallback?.audioUrl || null;
}

async function getDriveFolderTracks(
  rawFolderInput?: string,
  forceRefresh = false
): Promise<{ folderId: string; tracks: Track[]; live: boolean }> {
  const folderId =
    extractDriveFolderId(rawFolderInput || '') || DEFAULT_DRIVE_FOLDER_ID;

  const cached = driveFolderCache.get(folderId);
  const now = Date.now();
  if (!forceRefresh && cached && now - cached.updatedAt < 5 * 60 * 1000) {
    return { folderId, tracks: cached.tracks, live: true };
  }

  try {
    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': 'ReyTune/1.0' },
      signal: AbortSignal.timeout(6500),
    });

    if (!res.ok) {
      throw new Error(`Google Drive folder HTTP ${res.status}`);
    }

    const html = await res.text();
    const entries = parseDriveEmbeddedFolderHtml(html);

    if (entries.length === 0) {
      if (folderId === DEFAULT_DRIVE_FOLDER_ID) {
        return { folderId, tracks: DRIVE_FOLDER_TRACKS, live: true };
      }
      return { folderId, tracks: [], live: false };
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
        const normalized = normalizeDriveTrack(entry.fileId, entry.fileName, i);
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
    }

    driveFolderCache.set(folderId, { updatedAt: now, tracks: finalTracks });
    return { folderId, tracks: finalTracks, live: true };
  } catch {
    if (folderId === DEFAULT_DRIVE_FOLDER_ID) {
      return { folderId, tracks: DRIVE_FOLDER_TRACKS, live: true };
    }
    return { folderId, tracks: cached?.tracks ?? [], live: false };
  }
}

async function fetchAudiusTracks(query: string, limit = 15): Promise<Track[]> {
  try {
    const url =
      query === 'trending'
        ? `https://api.audius.co/v1/tracks/trending?limit=${limit}&app_name=ReyTune`
        : `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=ReyTune`;
    const audiusRes = await fetchJsonWithTimeout<{ data?: RawAudiusTrack[] }>(
      url,
      4000
    );
    if (!audiusRes || !Array.isArray(audiusRes.data)) return [];
    return audiusRes.data
      .map(normalizeAudiusTrack)
      .filter((t): t is Track => t !== null && t.durationSec >= 90);
  } catch {
    return [];
  }
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

async function pipeUpstreamAudio(
  rawUrl: string,
  req: express.Request,
  res: express.Response,
  isDownload: boolean,
  title: string,
  artist: string
) {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
  if (typeof req.headers.range === 'string') {
    headers.Range = req.headers.range;
  }

  const upstream = await fetch(rawUrl, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });

  if (!upstream.ok && upstream.status !== 206) {
    res
      .status(upstream.status)
      .json({ error: 'Failed to fetch upstream audio' });
    return;
  }

  const rawContentType = upstream.headers.get('content-type') || '';
  const contentType =
    rawContentType.includes('audio/') || rawContentType.includes('mpeg')
      ? rawContentType
      : 'audio/mpeg';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

  res.status(upstream.status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

  if (isDownload) {
    const filename = sanitizeDownloadFilename(title, artist);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(
    upstream.body as Parameters<typeof Readable.fromWeb>[0]
  );
  nodeStream.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else res.end();
  });
  nodeStream.pipe(res);
}

async function startServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'ReyTune',
      defaultDriveFolderId: DEFAULT_DRIVE_FOLDER_ID,
      driveTracksCount: DRIVE_FOLDER_TRACKS.length,
      ytMusicTracksCount: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
      totalCatalogCount: ALL_INDEXED_TRACKS.length,
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
    });
  });

  // Direct YouTube Music search & trending API endpoint
  app.get('/api/music/ytmusic', async (req, res) => {
    const q = String(
      req.query.q || 'Lagu Pop Indonesia Terpopuler Viral'
    ).trim();
    const liveYtm = await searchYouTubeMusicApi(q, 25);
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

  // Smart Audio Stream Resolver for YouTube Music tracks
  app.get('/api/music/ytm-audio', async (req, res) => {
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
      if (!resolvedUrl || !isSafeAudioProxyUrl(resolvedUrl)) {
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

  // Discover complete music catalog (Google Drive + YouTube Music + Online Full Streams)
  app.get('/api/music/discover', async (req, res) => {
    const genre = String(req.query.genre || 'all')
      .trim()
      .toLowerCase();
    const folderInput = String(
      req.query.folder || DEFAULT_DRIVE_FOLDER_ID
    ).trim();
    const refresh = req.query.refresh === '1';

    try {
      const driveResult = await getDriveFolderTracks(folderInput, refresh);
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

      const combined = dedupeTracks([...onlineExtras, ...filtered]);
      res.json({
        folderId: driveResult.folderId,
        totalDriveTracks: driveResult.tracks.length,
        totalYtMusicTracks: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.length,
        tracks: combined,
        live: true,
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
        tracks: fallback,
        live: true,
      });
    }
  });

  // Search full-length tracks across Google Drive + YouTube Music API + Hearthis.at + Audius
  app.get('/api/music/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const folderInput = String(
      req.query.folder || DEFAULT_DRIVE_FOLDER_ID
    ).trim();

    if (!q) {
      res.json({
        tracks: dedupeTracks([
          ...DRIVE_FOLDER_TRACKS,
          ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
        ]),
        live: true,
      });
      return;
    }

    const normalizedQ = q.toLowerCase();

    try {
      const [driveResult, ytmLiveTracks, hearthisTracks, audiusTracks] =
        await Promise.all([
          getDriveFolderTracks(folderInput, false),
          searchYouTubeMusicApi(q, 18),
          searchHearthisTracks(q, 10),
          fetchAudiusTracks(q, 10),
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

      const combined = dedupeTracks([
        ...driveMatches,
        ...indexedYtmMatches,
        ...hearthisTracks,
        ...ytmLiveTracks,
        ...localMatches,
        ...audiusTracks,
      ]);

      res.json({
        tracks: combined,
        driveMatchCount: driveMatches.length,
        ytMusicMatchCount: indexedYtmMatches.length + ytmLiveTracks.length,
        live: true,
      });
    } catch {
      const fallbackMatches = ALL_INDEXED_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(normalizedQ) ||
          t.artist.toLowerCase().includes(normalizedQ) ||
          t.album.toLowerCase().includes(normalizedQ)
      );
      res.json({ tracks: fallbackMatches, live: true });
    }
  });

  // Proxy audio stream (supports Google Drive direct downloads, Hearthis.at, iTunes, Range requests, and Audius streams)
  app.get('/api/music/audio', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    const isDownload = req.query.download === '1';
    const title = String(req.query.title || 'Track');
    const artist = String(req.query.artist || 'ReyTune');

    if (!isSafeAudioProxyUrl(rawUrl)) {
      res.status(400).json({ error: 'Invalid or unsupported audio URL' });
      return;
    }

    try {
      await pipeUpstreamAudio(rawUrl, req, res, isDownload, title, artist);
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
  });
}

startServer();
