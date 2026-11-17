import { parseLrcLyrics, type SyncedLyricLine } from './musicNormalizer.ts';

export interface ParsedId3Tags {
  title?: string;
  artist?: string;
  album?: string;
  plainLyrics: string;
  syncedLines: SyncedLyricLine[];
}

function readSyncSafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

function readUint24BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function decodeTextSlice(bytes: Uint8Array, encoding: number): string {
  if (bytes.length === 0) return '';
  try {
    if (encoding === 0) {
      return new TextDecoder('iso-8859-1').decode(bytes);
    }
    if (encoding === 1 || encoding === 2) {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
      }
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
      }
      return new TextDecoder(encoding === 2 ? 'utf-16be' : 'utf-16le').decode(bytes);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function findNullTerminator(
  bytes: Uint8Array,
  start: number,
  encoding: number
): { end: number; next: number } {
  const isTwoByte = encoding === 1 || encoding === 2;
  if (isTwoByte) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return { end: i, next: i + 2 };
      }
    }
    return { end: bytes.length, next: bytes.length };
  }
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      return { end: i, next: i + 1 };
    }
  }
  return { end: bytes.length, next: bytes.length };
}

function decodeFrameText(frameData: Uint8Array): string {
  if (frameData.length < 2) return '';
  const encoding = frameData[0];
  return decodeTextSlice(frameData.subarray(1), encoding)
    .replace(/\0+$/g, '')
    .trim();
}

function decodeUnsyncedLyrics(frameData: Uint8Array): string {
  // Format: [encoding:1][language:3][content descriptor\0][lyrics...]
  if (frameData.length < 5) return '';
  const encoding = frameData[0];
  const { next } = findNullTerminator(frameData, 4, encoding);
  return decodeTextSlice(frameData.subarray(next), encoding)
    .replace(/\0+$/g, '')
    .trim();
}

function decodeSyncedLyrics(frameData: Uint8Array): SyncedLyricLine[] {
  // Format: [encoding:1][language:3][timestampFormat:1][contentType:1][descriptor\0]([text\0][timestamp:4])*
  if (frameData.length < 8) return [];
  const encoding = frameData[0];
  const timestampFormat = frameData[4]; // 2 = milliseconds
  const { next } = findNullTerminator(frameData, 6, encoding);
  if (timestampFormat !== 2 && timestampFormat !== 1) return [];

  const lines: SyncedLyricLine[] = [];
  let pos = next;
  while (pos < frameData.length) {
    const term = findNullTerminator(frameData, pos, encoding);
    if (term.next + 4 > frameData.length) break;
    const text = decodeTextSlice(frameData.subarray(pos, term.end), encoding)
      .replace(/\r?\n/g, ' ')
      .trim();
    const rawTime = readUint32BE(frameData, term.next);
    pos = term.next + 4;
    if (text && timestampFormat === 2) {
      lines.push({
        timeSec: Math.round((rawTime / 1000) * 100) / 100,
        text,
      });
    }
  }

  lines.sort((a, b) => a.timeSec - b.timeSec);
  return lines;
}

export function parseId3FromBytes(bytes: Uint8Array): ParsedId3Tags {
  const empty: ParsedId3Tags = { plainLyrics: '', syncedLines: [] };
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x49 || // 'I'
    bytes[1] !== 0x44 || // 'D'
    bytes[2] !== 0x33    // '3'
  ) {
    return empty;
  }

  const majorVersion = bytes[3];
  const flags = bytes[5];
  const tagSize = readSyncSafeInt(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let pos = 10;
  // Skip ID3v2.3 / ID3v2.4 extended header if present
  if ((flags & 0x40) !== 0 && pos + 4 <= tagEnd) {
    const extSize =
      majorVersion >= 4
        ? readSyncSafeInt(bytes, pos)
        : readUint32BE(bytes, pos) + 4;
    if (extSize > 0 && pos + extSize <= tagEnd) {
      pos += extSize;
    }
  }

  const result: ParsedId3Tags = { plainLyrics: '', syncedLines: [] };

  if (majorVersion === 2) {
    while (pos + 6 <= tagEnd) {
      if (bytes[pos] === 0) break;
      const frameId = String.fromCharCode(
        bytes[pos],
        bytes[pos + 1],
        bytes[pos + 2]
      );
      const frameSize = readUint24BE(bytes, pos + 3);
      pos += 6;
      if (frameSize <= 0 || pos + frameSize > tagEnd) break;
      const frameData = bytes.subarray(pos, pos + frameSize);
      pos += frameSize;

      if (frameId === 'TT2') result.title = decodeFrameText(frameData) || result.title;
      else if (frameId === 'TP1') result.artist = decodeFrameText(frameData) || result.artist;
      else if (frameId === 'TAL') result.album = decodeFrameText(frameData) || result.album;
      else if (frameId === 'ULT' && !result.plainLyrics) {
        result.plainLyrics = decodeUnsyncedLyrics(frameData);
      } else if (frameId === 'SLT' && result.syncedLines.length === 0) {
        result.syncedLines = decodeSyncedLyrics(frameData);
      }
    }
  } else if (majorVersion === 3 || majorVersion === 4) {
    while (pos + 10 <= tagEnd) {
      if (bytes[pos] === 0) break;
      const frameId = String.fromCharCode(
        bytes[pos],
        bytes[pos + 1],
        bytes[pos + 2],
        bytes[pos + 3]
      );
      const frameSize =
        majorVersion === 4
          ? readSyncSafeInt(bytes, pos + 4)
          : readUint32BE(bytes, pos + 4);
      pos += 10;
      if (frameSize <= 0 || pos + frameSize > tagEnd) break;
      const frameData = bytes.subarray(pos, pos + frameSize);
      pos += frameSize;

      if (frameId === 'TIT2') result.title = decodeFrameText(frameData) || result.title;
      else if (frameId === 'TPE1') result.artist = decodeFrameText(frameData) || result.artist;
      else if (frameId === 'TALB') result.album = decodeFrameText(frameData) || result.album;
      else if (frameId === 'USLT' && !result.plainLyrics) {
        result.plainLyrics = decodeUnsyncedLyrics(frameData);
      } else if (frameId === 'SYLT' && result.syncedLines.length === 0) {
        result.syncedLines = decodeSyncedLyrics(frameData);
      }
    }
  }

  // If USLT plainLyrics contains LRC timestamps ([mm:ss.xx]), parse them into syncedLines too
  if (result.syncedLines.length === 0 && result.plainLyrics) {
    const lrcFromPlain = parseLrcLyrics(result.plainLyrics);
    if (lrcFromPlain.length > 0) {
      result.syncedLines = lrcFromPlain;
      result.plainLyrics = lrcFromPlain.map((l) => l.text).join('\n');
    }
  }

  if (result.syncedLines.length > 0 && !result.plainLyrics) {
    result.plainLyrics = result.syncedLines.map((l) => l.text).join('\n');
  }

  return result;
}
