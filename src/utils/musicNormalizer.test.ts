import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDriveFileId,
  extractDriveFolderId,
  extractDriveResourceKey,
  isSafeAudioProxyUrl,
  normalizeArchiveTrack,
  normalizeAudiusTrack,
  normalizeDriveTrack,
  normalizeHearthisTrack,
  normalizeItunesTrack,
  normalizeOpenverseTrack,
  parseArchiveDuration,
  parseDriveEmbeddedFolderHtml,
  parseDriveSubfoldersFromHtml,
  parseYouTubeMusicSearchResponse,
  sanitizeDownloadFilename,
} from './musicNormalizer.ts';

test('normalizeAudiusTrack maps full-length track metadata cleanly', () => {
  const track = normalizeAudiusTrack({
    id: '8Y9Al',
    title: '  Cheat Codes - Payback  ',
    genre: 'Electronic',
    duration: 203,
    artwork: { '480x480': 'https://cdn.example.com/art.jpg' },
    user: { name: 'Cheat Codes' },
  });

  assert.ok(track);
  assert.equal(track.id, 'audius-8Y9Al');
  assert.equal(track.title, 'Cheat Codes - Payback');
  assert.equal(track.artist, 'Cheat Codes');
  assert.equal(track.durationSec, 203);
  assert.equal(track.source, 'audius');
  assert.equal(track.isPreview, false);
  assert.ok(track.audioUrl.includes('api.audius.co/v1/tracks/8Y9Al/stream'));
});

test('extractDriveFolderId, extractDriveFileId & extractDriveResourceKey handle all Drive URL formats', () => {
  assert.equal(
    extractDriveFolderId(
      'https://drive.google.com/drive/folders/159K3zTj7LG7EWAn4oukJwRxClm8-1XhF?usp=sharing'
    ),
    '159K3zTj7LG7EWAn4oukJwRxClm8-1XhF'
  );
  assert.equal(
    extractDriveFolderId('159K3zTj7LG7EWAn4oukJwRxClm8-1XhF'),
    '159K3zTj7LG7EWAn4oukJwRxClm8-1XhF'
  );
  assert.equal(
    extractDriveFolderId('https://drive.google.com/open?id=1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6'),
    '1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6'
  );
  assert.equal(
    extractDriveFileId('https://drive.google.com/file/u/0/d/1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6/view'),
    '1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6'
  );
  assert.equal(
    extractDriveFileId('https://drive.google.com/uc?id=1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6&export=download'),
    '1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6'
  );
  assert.equal(
    extractDriveResourceKey('https://drive.google.com/drive/folders/159K3zTj7LG7EWAn4oukJwRxClm8-1XhF?resourcekey=0-abc123_XYZ'),
    '0-abc123_XYZ'
  );
});

test('parseDriveEmbeddedFolderHtml and parseDriveSubfoldersFromHtml extract audio files, icon-only audio & subfolders', () => {
  const sampleHtml = `
    <div class="flip-entry" id="entry-1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6">
      <div class="flip-entry-title">TULUS - Hati-Hati di Jalan.mp3</div>
    </div>
    <div class="flip-entry" id="entry-1AbcDefGhiJkLmNoPqRsTuVwXyZ12345">
      <img src="https://drive-thirdparty.googleusercontent.com/16/type/audio/mpeg" alt="Audio"/>
      <div class="flip-entry-title">Lagu Tanpa Ekstensi</div>
    </div>
    <div class="flip-entry" id="entry-1SubFolderId1234567890abcdef">
      <a href="https://drive.google.com/drive/folders/1SubFolderId1234567890abcdef?usp=drive_web">
        <div class="flip-entry-title">Subfolder Pop</div>
      </a>
    </div>
    <div class="flip-entry" id="entry-1sYmkrOlya44oQzrokpmQIHR_9YPsfzJZ">
      <div class="flip-entry-title">_Lagu Viral Nov 2026.md</div>
    </div>
  `;
  const entries = parseDriveEmbeddedFolderHtml(sampleHtml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].fileId, '1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6');
  assert.equal(entries[1].fileId, '1AbcDefGhiJkLmNoPqRsTuVwXyZ12345');

  const subfolders = parseDriveSubfoldersFromHtml(sampleHtml);
  assert.deepEqual(subfolders, ['1SubFolderId1234567890abcdef']);

  const track = normalizeDriveTrack(entries[0].fileId, entries[0].fileName);
  assert.equal(track.id, 'gdrive-1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6');
  assert.equal(track.artist, 'Tulus');
  assert.equal(track.title, 'Hati-Hati di Jalan');
  assert.equal(track.source, 'gdrive');
  assert.ok(track.audioUrl.includes('drive.usercontent.google.com/download'));
});

test('parseYouTubeMusicSearchResponse and normalizeHearthisTrack map YouTube Music & Online MP3 tracks', () => {
  const sampleYtmResponse = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            musicResponsiveListItemRenderer: {
              playlistItemData: { videoId: 'hc-8aB0Dkkw' },
              thumbnail: {
                musicThumbnailRenderer: {
                  thumbnail: {
                    thumbnails: [
                      { url: 'https://lh3.googleusercontent.com/abc=w120-h120' },
                    ],
                  },
                },
              },
              flexColumns: [
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: {
                      runs: [{ text: 'Untungnya, Hidup Harus Tetap Berjalan' }],
                    },
                  },
                },
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: {
                      runs: [
                        { text: 'Bernadya' },
                        { text: ' • ' },
                        { text: 'Sialnya, Hidup Harus Tetap Berjalan' },
                        { text: ' • ' },
                        { text: '3:03' },
                      ],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  const parsedYtm = parseYouTubeMusicSearchResponse(sampleYtmResponse);
  assert.equal(parsedYtm.length, 1);
  assert.equal(parsedYtm[0].id, 'ytm-hc-8aB0Dkkw');
  assert.equal(parsedYtm[0].youtubeVideoId, 'hc-8aB0Dkkw');
  assert.equal(parsedYtm[0].artist, 'Bernadya');
  assert.equal(parsedYtm[0].durationSec, 183);
  assert.equal(parsedYtm[0].source, 'ytmusic');

  const htTrack = normalizeHearthisTrack({
    id: '99123',
    title: 'Sheila On 7 - Sephia',
    duration: 294,
    stream_url: 'https://hearthis.app/sample/sephia/listen/',
  });
  assert.ok(htTrack);
  assert.equal(htTrack.artist, 'Sheila On 7');
  assert.equal(htTrack.title, 'Sephia');
  assert.equal(htTrack.durationSec, 294);
  assert.equal(htTrack.source, 'ytmusic');

  const htNative = normalizeHearthisTrack(
    {
      id: '99124',
      title: 'Midnight Groove',
      duration: 215,
      genre: 'Electronic',
      stream_url: 'https://hearthis.at/sample/midnight/listen/',
      user: { username: 'DJ Nova' },
    },
    { source: 'hearthis' }
  );
  assert.ok(htNative);
  assert.equal(htNative.id, 'hearthis-99124');
  assert.equal(htNative.source, 'hearthis');

  const spamTrack = normalizeHearthisTrack({
    id: '99999',
    title: 'SLOT GACOR MAXWIN HARI INI',
    duration: 180,
    stream_url: 'https://hearthis.at/spam/track/listen/',
  });
  assert.equal(spamTrack, null);
});

test('normalizeOpenverseTrack, normalizeArchiveTrack, and normalizeItunesTrack map free music APIs cleanly', () => {
  const ovJamendo = normalizeOpenverseTrack({
    id: 'abc-123',
    title: 'Midnight Breeze',
    creator: 'Luna Sound',
    url: 'https://prod-1.storage.jamendo.com/?trackid=12345&format=mp32',
    thumbnail: 'https://api.openverse.org/v1/audio/abc-123/thumb/',
    duration: 210000,
    source: 'jamendo',
    license: 'by-sa',
    genres: ['Chill'],
    audio_set: { title: 'Night Sessions' },
  });
  assert.ok(ovJamendo);
  assert.equal(ovJamendo.id, 'openverse-abc-123');
  assert.equal(ovJamendo.source, 'jamendo');
  assert.equal(ovJamendo.durationSec, 210);
  assert.equal(ovJamendo.isPreview, false);
  assert.equal(ovJamendo.license, 'CC BY-SA');

  assert.equal(parseArchiveDuration('03:45'), 225);
  assert.equal(parseArchiveDuration('182.4'), 182);

  const archiveTrack = normalizeArchiveTrack(
    'cool-album-2024',
    {
      name: '01 Summer Nights.mp3',
      format: 'VBR MP3',
      title: 'Summer Nights',
      creator: 'Indie Band',
      length: '03:45',
      size: '4500000',
    },
    { creator: 'Indie Band', title: 'Cool Album' }
  );
  assert.ok(archiveTrack);
  assert.equal(archiveTrack.source, 'archive');
  assert.equal(archiveTrack.title, 'Summer Nights');
  assert.equal(archiveTrack.artist, 'Indie Band');
  assert.equal(archiveTrack.durationSec, 225);
  assert.ok(archiveTrack.audioUrl.includes('archive.org/download/cool-album-2024/'));

  const itunesTrack = normalizeItunesTrack({
    trackId: 778899,
    trackName: 'Komang',
    artistName: 'Raim Laode',
    collectionName: 'Komang - Single',
    primaryGenreName: 'Pop',
    previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/sample.m4a',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
    trackTimeMillis: 222000,
  });
  assert.ok(itunesTrack);
  assert.equal(itunesTrack.source, 'itunes');
  assert.equal(itunesTrack.isPreview, true);
  assert.equal(itunesTrack.durationSec, 30);
});

test('isSafeAudioProxyUrl allows trusted https music hosts and blocks untrusted/private/IPv6 URLs', () => {
  assert.equal(
    isSafeAudioProxyUrl('https://api.audius.co/v1/tracks/1/stream'),
    true
  );
  assert.equal(
    isSafeAudioProxyUrl(
      'https://drive.usercontent.google.com/download?id=123&export=download&confirm=t'
    ),
    true
  );
  assert.equal(
    isSafeAudioProxyUrl('https://prod-1.storage.jamendo.com/?trackid=123&format=mp32'),
    true
  );
  assert.equal(
    isSafeAudioProxyUrl('https://archive.org/download/sample/song.mp3'),
    true
  );
  assert.equal(
    isSafeAudioProxyUrl('http://api.audius.co/v1/tracks/1/stream'),
    false
  );
  assert.equal(isSafeAudioProxyUrl('https://localhost:3000/secret'), false);
  assert.equal(isSafeAudioProxyUrl('https://[::1]/secret'), false);
  assert.equal(isSafeAudioProxyUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeAudioProxyUrl('https://evil.example.com/payload.mp3'), false);

  const approved = new Set(['https://custom-radio.example.org/live.mp3']);
  assert.equal(
    isSafeAudioProxyUrl('https://custom-radio.example.org/live.mp3', approved),
    true
  );
});

test('sanitizeDownloadFilename strips invalid path and header characters', () => {
  assert.equal(
    sanitizeDownloadFilename('Song/Name:1?;\r\n', "Artist*'"),
    'Artist - SongName1.mp3'
  );
});

