import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDriveFileId,
  extractDriveFolderId,
  extractDriveResourceKey,
  isSafeAudioProxyUrl,
  normalizeAudiusTrack,
  normalizeDriveTrack,
  normalizeHearthisTrack,
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
});

test('isSafeAudioProxyUrl allows https music hosts and blocks private/non-https URLs', () => {
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
    isSafeAudioProxyUrl('http://api.audius.co/v1/tracks/1/stream'),
    false
  );
  assert.equal(isSafeAudioProxyUrl('https://localhost:3000/secret'), false);
});

test('sanitizeDownloadFilename strips invalid path characters', () => {
  assert.equal(
    sanitizeDownloadFilename('Song/Name:1?', 'Artist*'),
    'Artist - SongName1.mp3'
  );
});
