import type { Track } from '../types/music';

const DB_NAME = 'reytune_offline_db';
const DB_VERSION = 1;
const STORE_TRACKS = 'offline_tracks';

export interface OfflineTrackRecord {
  id: string;
  track: Track;
  audioBlob: Blob;
  sizeMb: number;
  savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveOfflineTrackBlob(track: Track, audioBlob: Blob): Promise<OfflineTrackRecord> {
  const sizeMb = Math.max(0.1, Math.round((audioBlob.size / (1024 * 1024)) * 10) / 10);
  const record: OfflineTrackRecord = {
    id: track.id,
    track: { ...track, fileSizeMb: sizeMb },
    audioBlob,
    sizeMb,
    savedAt: Date.now(),
  };

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    tx.objectStore(STORE_TRACKS).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to store offline track'));
    };
  });
}

export async function getOfflineTrackRecord(trackId: string): Promise<OfflineTrackRecord | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRACKS, 'readonly');
      const req = tx.objectStore(STORE_TRACKS).get(trackId);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as OfflineTrackRecord | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

export async function getAllOfflineTrackRecords(): Promise<OfflineTrackRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRACKS, 'readonly');
      const req = tx.objectStore(STORE_TRACKS).getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as OfflineTrackRecord[]) ?? []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineTrackRecord(trackId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      tx.objectStore(STORE_TRACKS).delete(trackId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Graceful no-op
  }
}

export async function clearOfflineTrackDatabase(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      tx.objectStore(STORE_TRACKS).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Graceful no-op
  }
}
