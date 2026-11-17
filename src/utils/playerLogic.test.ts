import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateStorageStats,
  canPlayTrack,
  cycleRepeatMode,
  filterTracks,
  formatTime,
  getNextTrackIndex,
} from './playerLogic';
import { Track } from '../types/music';

const SAMPLE_TRACKS: Track[] = [
  {
    id: 't1',
    title: 'Midnight Rain',
    artist: 'Kaito Morita',
    album: 'Echoes',
    genre: 'Ambient',
    durationSec: 64,
    fileSizeMb: 5.0,
    coverUrl: '/a.jpg',
    audioUrl: '/a.mp3',
  },
  {
    id: 't2',
    title: 'Emerald Canopy',
    artist: 'Sora',
    album: 'Forest',
    genre: 'Acoustic',
    durationSec: 125,
    fileSizeMb: 10.0,
    coverUrl: '/b.jpg',
    audioUrl: '/b.mp3',
  },
  {
    id: 't3',
    title: 'Concrete Horizon',
    artist: 'Lukas',
    album: 'Monolith',
    genre: 'Techno',
    durationSec: 90,
    fileSizeMb: 6.0,
    coverUrl: '/c.jpg',
    audioUrl: '/c.mp3',
  },
];

test('formatTime formats mm:ss with zero padding and safe bounds', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(5), '00:05');
  assert.equal(formatTime(64), '01:04');
  assert.equal(formatTime(125.9), '02:05');
  assert.equal(formatTime(-10), '00:00');
  assert.equal(formatTime(Number.NaN), '00:00');
});

test('filterTracks filters by query and enforces offline downloaded constraint', () => {
  const downloaded = new Set(['t1', 't3']);

  assert.equal(filterTracks(SAMPLE_TRACKS, '').length, 3);
  assert.deepEqual(
    filterTracks(SAMPLE_TRACKS, 'kaito').map((t) => t.id),
    ['t1']
  );
  assert.deepEqual(
    filterTracks(SAMPLE_TRACKS, '', { offlineOnly: true, downloadedIds: downloaded }).map((t) => t.id),
    ['t1', 't3']
  );
  assert.deepEqual(
    filterTracks(SAMPLE_TRACKS, 'emerald', { offlineOnly: true, downloadedIds: downloaded }),
    []
  );
});

test('calculateStorageStats computes accurate MB and percentage', () => {
  const downloaded = new Set(['t1', 't2']);
  const statsStandard = calculateStorageStats(SAMPLE_TRACKS, downloaded, '192', 100);
  assert.equal(statsStandard.downloadedCount, 2);
  assert.equal(statsStandard.usedMb, 15.0);
  assert.equal(statsStandard.usagePercent, 15.0);

  const statsHigh = calculateStorageStats(SAMPLE_TRACKS, downloaded, '320', 100);
  assert.equal(statsHigh.usedMb, 18.8);
});

test('cycleRepeatMode cycles off -> all -> one -> off', () => {
  assert.equal(cycleRepeatMode('off'), 'all');
  assert.equal(cycleRepeatMode('all'), 'one');
  assert.equal(cycleRepeatMode('one'), 'off');
});

test('canPlayTrack blocks un-downloaded tracks only in offline mode', () => {
  const downloaded = new Set(['t1']);
  assert.equal(canPlayTrack('t2', false, downloaded).allowed, true);
  assert.equal(canPlayTrack('t1', true, downloaded).allowed, true);
  assert.equal(canPlayTrack('t2', true, downloaded).allowed, false);
});

test('getNextTrackIndex handles linear, repeat all, repeat one, and shuffle', () => {
  assert.equal(
    getNextTrackIndex({ currentIndex: 0, queueLength: 3, repeatMode: 'off', shuffle: false, direction: 'next' }),
    1
  );
  assert.equal(
    getNextTrackIndex({ currentIndex: 2, queueLength: 3, repeatMode: 'off', shuffle: false, direction: 'next' }),
    null
  );
  assert.equal(
    getNextTrackIndex({ currentIndex: 2, queueLength: 3, repeatMode: 'all', shuffle: false, direction: 'next' }),
    0
  );
  assert.equal(
    getNextTrackIndex({ currentIndex: 1, queueLength: 3, repeatMode: 'one', shuffle: false, direction: 'next' }),
    1
  );
  assert.equal(
    getNextTrackIndex({ currentIndex: 0, queueLength: 3, repeatMode: 'all', shuffle: false, direction: 'prev' }),
    2
  );
  const shuffled = getNextTrackIndex({
    currentIndex: 1,
    queueLength: 3,
    repeatMode: 'off',
    shuffle: true,
    direction: 'next',
    randomFn: () => 0.1,
  });
  assert.notEqual(shuffled, 1);
  assert.ok(shuffled === 0 || shuffled === 2);
});
