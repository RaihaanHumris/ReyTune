import type { Playlist, Track } from '../types/music.ts';
import {
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_DRIVE_FOLDER_URL,
  DRIVE_FOLDER_TRACKS,
} from './driveTracks.ts';
import { YOUTUBE_MUSIC_AND_ONLINE_TRACKS } from './ytMusicTracks.ts';

export {
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_DRIVE_FOLDER_URL,
  DRIVE_FOLDER_TRACKS,
  YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
};

export const LOCAL_BUNDLED_TRACKS: Track[] = [
  {
    id: 'local-midnight-rain',
    title: 'Midnight Rain Over Shibuya',
    artist: 'Kaito Morita',
    album: 'Midnight Echoes',
    genre: 'Chill',
    durationSec: 212,
    fileSizeMb: 4.9,
    coverUrl: '/src/assets/images/cover_midnight_echoes_1794886924153.jpg',
    audioUrl: '/audio/midnight-rain.mp3',
    source: 'local',
    isPreview: false,
  },
  {
    id: 'local-emerald-canopy',
    title: 'Emerald Canopy',
    artist: 'Sora & The Pines',
    album: 'Forest Harmonics',
    genre: 'Chill',
    durationSec: 198,
    fileSizeMb: 4.6,
    coverUrl: '/src/assets/images/cover_emerald_canopy_1794886924947.jpg',
    audioUrl: '/audio/emerald-canopy.mp3',
    source: 'local',
    isPreview: false,
  },
  {
    id: 'local-amber-cassette',
    title: 'Warm Cassette Tape',
    artist: 'Nadia Kusuma',
    album: 'Late Study Loops',
    genre: 'Chill',
    durationSec: 185,
    fileSizeMb: 4.3,
    coverUrl: '/src/assets/images/cover_warm_cassette_1794886926901.jpg',
    audioUrl: '/audio/amber-cassette.mp3',
    source: 'local',
    isPreview: false,
  },
  {
    id: 'local-stylus-groove',
    title: 'Analog Groove No. 4',
    artist: 'Clara Vance',
    album: 'Vinyl Solitude',
    genre: 'Chill',
    durationSec: 204,
    fileSizeMb: 4.8,
    coverUrl: '/src/assets/images/cover_vinyl_solitude_1794886925568.jpg',
    audioUrl: '/audio/stylus-groove.mp3',
    source: 'local',
    isPreview: false,
  },
];

export const CATALOG_TRACKS: Track[] = [
  ...DRIVE_FOLDER_TRACKS,
  ...YOUTUBE_MUSIC_AND_ONLINE_TRACKS,
  ...LOCAL_BUNDLED_TRACKS,
];

export const INITIAL_DOWNLOADED_IDS: string[] = [
  'local-midnight-rain',
  'local-emerald-canopy',
  'local-amber-cassette',
];

export const INITIAL_LIKED_IDS: string[] = [
  'gdrive-1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6', // Tulus - Hati-Hati di Jalan (Full MP3)
  'ytm-ht-3107029', // Nadin Amizah - Sorai (Full MP3)
  'ytm-ht-1779711', // Sheila On 7 - Film Favorit (Full MP3)
  'gdrive-1kGr6fzchzsRNddi6mcUNQsolcloZ8cwi', // Raim Laode - Komang (Full MP3)
  'gdrive-16cLyy8UNVKLnICEz8jmIUs6wcKOkdmM5', // Nadhif Basalamah - penjaga hati (Full MP3)
  'gdrive-1xDR6Tvrur1Lu6PzpC2Q4-XlAgVH0JkaX', // The 1975 - About You (Full MP3)
  'gdrive-1CIK37DR2B1SiDkvE6yEX27KENeEDUAMS', // ROSÉ & Bruno Mars - APT. (Full MP3)
];

export const INITIAL_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-ytmusic-hits',
    name: 'Hits Indonesia Full MP3 (Sheila On 7, Dewa 19, Nadin Amizah)',
    trackIds: YOUTUBE_MUSIC_AND_ONLINE_TRACKS.slice(0, 15).map((t) => t.id),
    createdAt: 1794860000000,
  },
  {
    id: 'pl-drive-viral-2026',
    name: 'Lagu Viral TikTok 2026 (Drive Full MP3)',
    trackIds: [
      'gdrive-1C_Bt9aK_2oXN-3G13p7W_YGpH6LiN5cz', // eńau feat. Ari Lesmana - Sesi Potret
      'gdrive-1qzExhqAEscAZ-gHAJBtZN6la8paBb2_K', // DJ Astaga Bercanda
      'gdrive-1aLUJWOt2b9MgRNiUqUk7CkTWlNlcMqWP', // Overnight - Kita Lewati Berdua
      'gdrive-1W30oHIMKXlQMwc72pSTy7IRFTF3Oqa11', // Tulus - Jatuh Suka
      'gdrive-1MkS_nZp6EnJW1Aa7WqNxYovTpQ3Q0NOX', // Idgitaf - Sedia Aku Sebelum Hujan
      'gdrive-1XZAnkS5_gKnZb-AXhV2fS19gsPZI9CcT', // Nadhif Basalamah - Kota Ini Tak Sama Tanpamu
      'gdrive-1PkxCiRGMWkHK8VVo6BwKBEmvpYP18hcs', // Denny Caknan - Negoro Angin
      'gdrive-1binKL3sYC03WTHPjZB1HQ10R6__FqkfA', // Katy Perry - The One That Got Away
      'gdrive-1CIK37DR2B1SiDkvE6yEX27KENeEDUAMS', // ROSÉ & Bruno Mars - APT.
      'gdrive-1P850U1B52fj3UDTrDBNkGF25xmwAs5fT', // Gigi Perez - Sailor Song
    ],
    createdAt: 1794800000000,
  },
  {
    id: 'pl-top-hits-indonesia',
    name: 'Top Hits Indonesia Lengkap (Full MP3)',
    trackIds: [
      'gdrive-1WXDFZVgemjM-cVXAmCPjwaxFh6mKsCU6', // Tulus - Hati-Hati di Jalan
      'gdrive-1kGr6fzchzsRNddi6mcUNQsolcloZ8cwi', // Raim Laode - Komang
      'gdrive-16cLyy8UNVKLnICEz8jmIUs6wcKOkdmM5', // Nadhif Basalamah - penjaga hati
      'gdrive-1nlWMlbT7I0-lkqn9V2E30nAr6nzBOQ-R', // Juicy Luicy - Lantas
      'gdrive-1JkgzyO4Yc2JUZbOy5sw4oTXnv9dfEPK9', // Juicy Luicy - Lampu Kuning
      'gdrive-1cFA8znr04fuFmZOxR49jy_Of-AvJHJTb', // Sal Priadi - Kita usahakan rumah itu
      'gdrive-1mALAZ8UUONJpqR9EWgluxU0SKqciRKw4', // Tulus - Monokrom
      'gdrive-1QmSFw4a-Zg_IzK5QSyoygbqmsNifDcal', // Tulus - Interaksi
      'gdrive-1LprGnxkJzE1wT7gqhCSJh9G-ET1vkfav', // Raim Laode - Lesung Pipi
    ],
    createdAt: 1794830000000,
  },
  {
    id: 'pl-barat-hits-drive',
    name: 'Barat Hits & Favorit (Full MP3)',
    trackIds: [
      'gdrive-1xDR6Tvrur1Lu6PzpC2Q4-XlAgVH0JkaX', // The 1975 - About You
      'gdrive-1TsV3RQJ1EFDxZHlQGUjv3slBxmhP-i-9', // Bruno Mars - When I Was Your Man
      'gdrive-1AcfG_wiq7Lo2DOuv_UriyL0xakmLPZqn', // Rex Orange County - Happiness
      'gdrive-1RIiKew3zo_ExhZBh5ZhPrlN-tNIY4q_k', // Arctic Monkeys - I Wanna Be Yours
      'gdrive-1ydyxI_7wfcFrrTv2oW1AlX9PLPY5Bt3E', // Coldplay - Viva La Vida
      'gdrive-1LMOqvOuAafWV2LxxbIygvYf4gxGZuaf6', // Radiohead - Let Down
    ],
    createdAt: 1794850000000,
  },
];
