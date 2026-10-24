import { ctx } from './adapter';
import {
  BACKUP_FORMAT, checkedManifest, imageDataUrl, namesFor, newStickerId, STICKER_FOLDER,
  stickerFileType, stickerNameKey, StickerStorageConflictError,
  type ManifestEntry, type StickerStorage, type StoredSticker,
} from './sticker-format';

const API = '/api/plugins/mochi-os-stickers';
const SETUP_ERROR = 'Extension-folder sticker storage is unavailable. Install the Mochi OS sticker server plugin, enable enableServerPlugins in SillyTavern config.yaml, and restart SillyTavern. No stickers were saved to browser storage.';

/** The runtime folder can be MochiOS, mochi-os, or the name chosen at installation. */
export function stickerExtensionFolder(moduleUrl = import.meta.url): string {
  const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(new URL(moduleUrl).pathname);
  return match ? decodeURIComponent(match[1]) : 'mochi-os';
}

/** Only the server persists bytes. Object URLs and this cache are session memory. */
export function createServerStickerStorage(
  extension: string,
  fetcher: typeof fetch = fetch,
  headers: () => HeadersInit = () => ctx().getRequestHeaders(),
): StickerStorage {
  const query = `?extension=${encodeURIComponent(extension)}`;
  let revision: string | null = null;
  let migrations = new Set<string>();
  let previous = new Map<string, StoredSticker>();

  const request = async (route: string, body?: unknown): Promise<Response> => {
    const response = await fetcher(`${API}${route}${query}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return response;
    const error = await response.json().catch(() => ({})) as { code?: string; error?: string };
    if (error.code === 'STICKER_LIBRARY_CHANGED') throw new StickerStorageConflictError();
    if (error.code === 'STICKER_IMAGE_MISSING') throw new StickerStorageConflictError(error.error || 'A saved sticker image is missing. Restore its JSON backup or remove the unavailable sticker.');
    if (response.status === 404 && !error.code) throw new Error(SETUP_ERROR);
    throw new Error(error.error || `Extension-folder sticker storage failed (${response.status}).`);
  };

  const acceptState = (value: { version?: unknown; revision?: unknown; migrations?: unknown; location?: unknown }) => {
    if (value.version !== 1 || !(value.revision === null || typeof value.revision === 'string')
      || !Array.isArray(value.migrations) || !value.migrations.every((id) => typeof id === 'string')) {
      throw new Error('The Mochi sticker server returned an invalid library index.');
    }
    revision = value.revision;
    migrations = new Set(value.migrations);
    if (typeof value.location === 'string') backend.location = value.location;
  };

  const backend: StickerStorage = {
    location: `${extension}/${STICKER_FOLDER}`,
    hasMigration: (id) => migrations.has(id),
    async read() {
      const value = await (await request('/library')).json();
      if (!value || typeof value !== 'object') throw new Error('The Mochi sticker server returned an invalid library index.');
      const manifest = checkedManifest(value.stickers);
      const records = await Promise.all(manifest.map(async (entry) => {
        const cached = previous.get(entry.fileName);
        const blob = cached?.mimeType === entry.mimeType ? cached.blob : await (await request(`/images/${encodeURIComponent(entry.fileName)}`)).blob();
        const type = await stickerFileType(blob);
        if (type.mimeType !== entry.mimeType) throw new Error(`The saved image for ${JSON.stringify(entry.name)} is invalid.`);
        return { ...entry, blob };
      }));
      acceptState(value);
      previous = new Map(records.map((record) => [record.fileName, record]));
      return records;
    },
    async write(stickers, migrationIds = []) {
      const manifest = checkedManifest(stickers);
      const entries = await Promise.all(manifest.map(async (entry, index) => ({
        ...entry,
        ...(!previous.has(entry.fileName) ? { data: await imageDataUrl(stickers[index].blob, entry.mimeType) } : {}),
      })));
      acceptState(await (await request('/library', { revision, stickers: entries, migrations: migrationIds })).json());
      previous = new Map(stickers.map((record) => [record.fileName, record]));
    },
  };
  return backend;
}

export interface BrowserStickerPack {
  source: 'opfs' | 'indexeddb';
  records: StoredSticker[];
}

function missingFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

/** Read-only recovery of the previous version's origin-private library. */
async function readBrowserFolder(): Promise<BrowserStickerPack | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return null;
  let folder: FileSystemDirectoryHandle;
  let manifest: ManifestEntry[];
  try {
    const root = await navigator.storage.getDirectory();
    const mochi = await root.getDirectoryHandle('mochi-os');
    folder = await mochi.getDirectoryHandle('stickers');
    const file = await (await folder.getFileHandle('library.json')).getFile();
    manifest = checkedManifest(JSON.parse(await file.text()));
  } catch (error) {
    if (missingFile(error) || (error instanceof DOMException && ['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name))) return null;
    throw error;
  }
  const records = await Promise.all(manifest.map(async (entry) => ({
    ...entry, blob: await (await folder.getFileHandle(entry.fileName)).getFile(),
  })));
  return { source: 'opfs', records };
}

/** Opening a missing legacy database is aborted; migration creates no browser store. */
async function readBrowserDatabase(): Promise<BrowserStickerPack | null> {
  if (typeof indexedDB === 'undefined') return null;
  if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some((db) => db.name === 'mochi-os-stickers')) return null;
  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    let absent = false;
    let abandoned = false;
    const request = indexedDB.open('mochi-os-stickers');
    request.onupgradeneeded = () => { absent = true; request.transaction?.abort(); };
    request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onblocked = () => { abandoned = true; reject(new Error('Close older Mochi tabs to migrate browser stickers.')); };
  });
  if (!database) return null;
  try {
    if (!database.objectStoreNames.contains('stickers')) return null;
    const saved = await new Promise<StoredSticker[]>((resolve, reject) => {
      const transaction = database.transaction('stickers', 'readonly');
      const request = transaction.objectStore('stickers').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    const manifest = checkedManifest(saved);
    if (saved.some((entry) => !(entry.blob instanceof Blob))) throw new Error('The old browser sticker images are invalid.');
    return { source: 'indexeddb', records: manifest.map((entry, index) => ({ ...entry, blob: saved[index].blob })) };
  } finally { database.close(); }
}

export async function readBrowserStickerPacks(): Promise<BrowserStickerPack[]> {
  const packs = await Promise.all([readBrowserFolder(), readBrowserDatabase()]);
  return packs.filter((pack): pack is BrowserStickerPack => Boolean(pack?.records.length));
}

async function sameImage(left: StoredSticker, right: StoredSticker): Promise<boolean> {
  if (left.mimeType !== right.mimeType || left.blob.size !== right.blob.size) return false;
  const [a, b] = await Promise.all([left.blob.arrayBuffer(), right.blob.arrayBuffer()]);
  const bytes = new Uint8Array(b);
  return new Uint8Array(a).every((byte, index) => byte === bytes[index]);
}

/** Identical packs from another browser merge; conflicting images never overwrite. */
export async function mergeBrowserStickers(saved: StoredSticker[], incoming: StoredSticker[]): Promise<StoredSticker[]> {
  checkedManifest(saved); checkedManifest(incoming);
  const merged = [...saved];
  for (const record of incoming) {
    const type = await stickerFileType(record.blob);
    if (type.mimeType !== record.mimeType) throw new Error(`The browser image for ${JSON.stringify(record.name)} is invalid.`);
    const keys = new Set(namesFor(record).map(stickerNameKey));
    const matches = merged.filter((entry) => namesFor(entry).some((name) => keys.has(stickerNameKey(name))));
    if (matches.length) {
      if (matches.length !== 1 || !await sameImage(matches[0], record)) {
        throw new Error(`The browser sticker ${JSON.stringify(record.name)} conflicts with a sticker already saved in the extension folder.`);
      }
      const existing = matches[0];
      merged[merged.indexOf(existing)] = { ...existing,
        aliases: [...new Set([...existing.aliases ?? [], ...namesFor(record)])].filter((name) => name !== existing.name),
      };
    } else {
      const id = merged.some((entry) => entry.id === record.id || entry.fileName.toLowerCase() === record.fileName.toLowerCase())
        ? newStickerId() : record.id;
      merged.push({ ...record, id, fileName: `${id}.${type.extension}` });
    }
    checkedManifest(merged);
  }
  return merged;
}

/** Receipts live on disk, so deleting a migrated sticker cannot resurrect it on reload. */
export async function migrateBrowserStickerPacks(backend: StickerStorage, packs: BrowserStickerPack[]): Promise<void> {
  const saved = await backend.read();
  for (const pack of packs) checkedManifest(pack.records);
  const pending = packs.flatMap((pack) => pack.records.map((record) => ({ record, receipt: `${pack.source}:${record.id}` })))
    .filter((entry) => !backend.hasMigration?.(entry.receipt));
  if (!pending.length) return;
  let records = saved;
  // Validate each pack separately: the same old UUID may exist in both legacy stores.
  for (const entry of pending) records = await mergeBrowserStickers(records, [entry.record]);
  await backend.write(records, pending.map((entry) => entry.receipt));
}

export async function exportBrowserStickersJson(): Promise<string> {
  // A recovery backup must include conflicting packs too. Import's editable
  // review can resolve their names; exporting must not make those bytes unreachable.
  const records = (await readBrowserStickerPacks()).flatMap((pack) => pack.records);
  if (!records.length) throw new Error('There are no saved browser stickers to export.');
  const stickers = await Promise.all(records.map(async (record) => ({
    name: record.name, aliases: record.aliases, mimeType: record.mimeType,
    data: await imageDataUrl(record.blob, record.mimeType),
  })));
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, stickers }, null, 2);
}

export async function extensionStickerStorage(): Promise<StickerStorage> {
  const backend = createServerStickerStorage(stickerExtensionFolder());
  // Verify server availability first; never fall back to writing in the browser.
  await backend.read();
  try { await migrateBrowserStickerPacks(backend, await readBrowserStickerPacks()); }
  catch (error) {
    backend.warning = `${error instanceof Error ? error.message : 'Browser stickers could not be migrated.'} The original browser library is untouched. Export browser JSON and import it with different names to resolve conflicts.`;
  }
  return backend;
}
