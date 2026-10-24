/** Shared browser/server validation. Sticker names never become filesystem paths. */
export const STICKER_FOLDER = 'stickers';
export const MAX_STICKER_BYTES = 10 * 1024 * 1024;
export const MAX_STICKER_NAME_LENGTH = 128;
export const BACKUP_FORMAT = 'mochi-os-stickers';

export interface MochiSticker {
  id: string;
  name: string;
  url: string;
  /** Previous names keep already-sent sticker messages readable after a rename. */
  aliases?: string[];
}

export interface StoredSticker {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  aliases?: string[];
}

export interface StickerUpload {
  file: File;
  name?: string;
  aliases?: string[];
}

export type ManifestEntry = Omit<StoredSticker, 'blob'>;

export interface StickerStorage {
  location: string;
  warning?: string;
  read(): Promise<StoredSticker[]>;
  write(stickers: StoredSticker[], migrationIds?: string[]): Promise<void>;
  hasMigration?(id: string): boolean;
}

export class StickerStorageConflictError extends Error {
  constructor(message = 'The sticker library changed on another device. Please try again.') { super(message); }
}

export function newStickerId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sticker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function stickerName(value: string): string {
  return value.trim().replace(/^\[Sticker\]\s*/i, '').replace(/^(?:sticker)?:([^:]+):$/i, '$1').trim();
}

export function normalizeStickerName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').normalize('NFKC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'sticker';
}

export function stickerNameKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function duplicateNameError(name: string): string {
  return `A sticker named ${JSON.stringify(name)} already exists. Choose a different name.`;
}

export function stickerNameError(value: string, usedNames: Iterable<string> = []): string | null {
  const name = value.normalize('NFKC').trim();
  if (!name) return 'Enter a sticker name.';
  if (name.length > MAX_STICKER_NAME_LENGTH) return `Sticker names must be ${MAX_STICKER_NAME_LENGTH} characters or fewer.`;
  if (/[\p{Cc}\p{Zl}\p{Zp}:]/u.test(name) || /^\[Sticker\]/i.test(name)) {
    return 'Sticker names cannot contain colons, control characters, or start with [Sticker].';
  }
  const key = stickerNameKey(name);
  for (const used of usedNames) if (stickerNameKey(used) === key) return duplicateNameError(name);
  return null;
}

export function checkedName(value: string, usedKeys: Set<string> = new Set()): string {
  const error = stickerNameError(value);
  if (error) throw new Error(error);
  const name = value.normalize('NFKC').trim();
  if (usedKeys.has(stickerNameKey(name))) throw new Error(duplicateNameError(name));
  return name;
}

export function availableName(fileName: string, usedKeys: Set<string>): string {
  const base = normalizeStickerName(fileName);
  let name = base;
  for (let suffix = 2; usedKeys.has(stickerNameKey(name)); suffix++) name = `${base}_${suffix}`;
  return name;
}

export function suggestStickerName(fileName: string, usedNames: Iterable<string>): string {
  return availableName(fileName, new Set(Array.from(usedNames, stickerNameKey)));
}

export function namesFor(sticker: { name: string; aliases?: string[] }): string[] {
  return [sticker.name, ...sticker.aliases ?? []];
}

export function assertUniqueNames(stickers: Array<{ name: string; aliases?: string[] }>): void {
  const usedKeys = new Set<string>();
  for (const sticker of stickers) {
    const ownKeys = new Set<string>();
    for (const name of namesFor(sticker)) {
      const key = stickerNameKey(name);
      if (usedKeys.has(key)) throw new Error(duplicateNameError(name));
      ownKeys.add(key);
    }
    for (const key of ownKeys) usedKeys.add(key);
  }
}

/** Raster formats only; a renamed SVG/HTML file must not enter the library. */
export async function stickerFileType(blob: Blob): Promise<{ mimeType: string; extension: string }> {
  if (!blob.size || blob.size > MAX_STICKER_BYTES) throw new Error('Each sticker must be an image under 10 MB.');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return { mimeType: 'image/png', extension: 'png' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mimeType: 'image/gif', extension: 'gif' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  throw new Error('Stickers must be PNG, JPEG, GIF, or WebP images.');
}

export async function imageDataUrl(blob: Blob, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  }
  return `data:${mimeType};base64,${btoa(chunks.join(''))}`;
}

/** A portable backup embeds image bytes, never temporary blob URLs or file paths. */
export async function readStickerBackup(source: Blob | string): Promise<StickerUpload[]> {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof source === 'string' ? source : await source.text()); }
  catch { throw new Error('Choose a valid Mochi OS sticker JSON backup.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('The sticker JSON backup is invalid.');
  const backup = parsed as { format?: unknown; version?: unknown; stickers?: unknown };
  if (backup.format !== BACKUP_FORMAT || backup.version !== 1) throw new Error('This sticker backup format or version is not supported.');
  if (!Array.isArray(backup.stickers)) throw new Error('The sticker JSON backup must contain a stickers array.');
  const uploads: StickerUpload[] = [];
  for (const item of backup.stickers) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.mimeType !== 'string' || typeof item.data !== 'string'
      || (item.aliases !== undefined && (!Array.isArray(item.aliases) || !item.aliases.every((alias: unknown) => typeof alias === 'string')))) {
      throw new Error('Each backup sticker must include a name, image type, and base64 image data.');
    }
    const name = checkedName(item.name);
    const aliases = item.aliases?.map((alias: string) => checkedName(alias)) as string[] | undefined;
    const prefix = `data:${item.mimeType};base64,`;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.mimeType) || !item.data.startsWith(prefix)) {
      throw new Error(`The image data for ${JSON.stringify(name)} is invalid.`);
    }
    const encoded = item.data.slice(prefix.length);
    if (encoded.length > 4 * Math.ceil(MAX_STICKER_BYTES / 3)) throw new Error('Each sticker must be an image under 10 MB.');
    let binary: string;
    try {
      if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error();
      binary = atob(encoded);
    } catch { throw new Error(`The base64 image data for ${JSON.stringify(name)} is invalid.`); }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const blob = new Blob([bytes], { type: item.mimeType });
    const type = await stickerFileType(blob);
    if (type.mimeType !== item.mimeType) throw new Error(`The image type for ${JSON.stringify(name)} does not match its data.`);
    uploads.push({ name, aliases, file: new File([blob], `${name}.${type.extension}`, { type: type.mimeType }) });
  }
  return uploads;
}

function validEntry(value: unknown): value is ManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ManifestEntry;
  return typeof entry.id === 'string' && /^[\w-]{1,128}$/.test(entry.id)
    && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(entry.id) && typeof entry.name === 'string'
    && typeof entry.fileName === 'string' && entry.fileName.startsWith(`${entry.id}.`)
    && /^[\w-]+\.(png|jpg|gif|webp)$/.test(entry.fileName)
    && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(entry.mimeType)
    && (entry.aliases === undefined || (Array.isArray(entry.aliases) && entry.aliases.every((alias) => typeof alias === 'string')));
}

/** Whitelist metadata and reject duplicate names, ids, and Windows filenames. */
export function checkedManifest(value: unknown): ManifestEntry[] {
  if (!Array.isArray(value) || !value.every(validEntry)) throw new Error('The Mochi sticker library index is invalid.');
  const ids = new Set<string>();
  const files = new Set<string>();
  const entries = value.map((entry) => {
    const fileKey = entry.fileName.toLowerCase();
    if (ids.has(entry.id) || files.has(fileKey)) throw new Error('The Mochi sticker library contains duplicate image ids.');
    ids.add(entry.id); files.add(fileKey);
    return { id: entry.id, name: checkedName(entry.name), fileName: entry.fileName, mimeType: entry.mimeType,
      ...(entry.aliases ? { aliases: entry.aliases.map((alias) => checkedName(alias)) } : {}) };
  });
  assertUniqueNames(entries);
  return entries;
}
