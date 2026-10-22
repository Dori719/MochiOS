/** Global Mochi-owned media. Never calls ST's upload APIs or writes chat metadata. */
export const STICKER_FOLDER = 'mochi-os/stickers';
export const MAX_STICKER_BYTES = 10 * 1024 * 1024;

export interface MochiSticker {
  id: string;
  name: string;
  url: string;
}

export interface StoredSticker {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
}

export interface StickerStorage {
  location: string;
  read(): Promise<StoredSticker[]>;
  write(stickers: StoredSticker[]): Promise<void>;
}

export function stickerName(value: string): string {
  return value.trim().replace(/^\[Sticker\]\s*/i, '').replace(/^(?:sticker)?:([^:]+):$/i, '$1').trim();
}

export function normalizeStickerName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').normalize('NFKC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'sticker';
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

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sticker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ManifestEntry = Omit<StoredSticker, 'blob'>;

function validEntry(value: unknown): value is ManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ManifestEntry;
  return typeof entry.id === 'string' && /^[\w-]+$/.test(entry.id) && typeof entry.name === 'string'
    && typeof entry.fileName === 'string' && /^[\w-]+\.(png|jpg|gif|webp)$/.test(entry.fileName)
    && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(entry.mimeType);
}

/** The browser's origin-private file system has a real, dedicated Mochi folder. */
async function folderStorage(): Promise<StickerStorage> {
  const root = await navigator.storage.getDirectory();
  const mochi = await root.getDirectoryHandle('mochi-os', { create: true });
  const directory = await mochi.getDirectoryHandle('stickers', { create: true });
  let previous: ManifestEntry[] = [];

  return {
    location: STICKER_FOLDER,
    async read() {
      let manifest: ManifestEntry[];
      try {
        const file = await (await directory.getFileHandle('library.json')).getFile();
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed) || !parsed.every(validEntry)) throw new Error('The Mochi sticker library index is invalid.');
        manifest = parsed;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        manifest = [];
      }
      const records = await Promise.all(manifest.map(async (entry) => ({
        ...entry, blob: await (await directory.getFileHandle(entry.fileName)).getFile(),
      })));
      previous = manifest;
      return records;
    },
    async write(stickers) {
      const oldFiles = new Set(previous.map((entry) => entry.fileName));
      const added: string[] = [];
      try {
        for (const sticker of stickers) {
          if (oldFiles.has(sticker.fileName)) continue;
          const stream = await (await directory.getFileHandle(sticker.fileName, { create: true })).createWritable();
          try { await stream.write(sticker.blob); await stream.close(); }
          catch (error) { await stream.abort().catch(() => {}); throw error; }
          added.push(sticker.fileName);
        }
        const manifest = stickers.map(({ blob: _blob, ...entry }) => entry);
        const stream = await (await directory.getFileHandle('library.json', { create: true })).createWritable();
        try { await stream.write(JSON.stringify(manifest)); await stream.close(); }
        catch (error) { await stream.abort().catch(() => {}); throw error; }
        const kept = new Set(manifest.map((entry) => entry.fileName));
        for (const entry of previous) {
          if (!kept.has(entry.fileName)) await directory.removeEntry(entry.fileName).catch(() => {});
        }
        previous = manifest;
      } catch (error) {
        // Roll back only files created by this write; never erase another library.
        await Promise.all(added.map((file) => directory.removeEntry(file).catch(() => {})));
        throw error;
      }
    },
  };
}

/** Firefox/older mobile browsers without OPFS still get a persistent global pack. */
async function databaseStorage(): Promise<StickerStorage> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mochi-os-stickers', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('stickers', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Mochi tabs to open the sticker library.'));
  });
  return {
    location: 'Mochi OS sticker database (folder storage unavailable)',
    read: () => new Promise((resolve, reject) => {
      const transaction = database.transaction('stickers', 'readonly');
      const request = transaction.objectStore('stickers').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    }),
    write: (stickers) => new Promise((resolve, reject) => {
      const transaction = database.transaction('stickers', 'readwrite');
      const store = transaction.objectStore('stickers');
      store.clear();
      for (const sticker of stickers) store.put(sticker);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    }),
  };
}

let storagePromise: Promise<StickerStorage> | null = null;
function storage(): Promise<StickerStorage> {
  storagePromise ??= (async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
      try { return await folderStorage(); }
      catch (error) {
        // An unreadable/corrupt library is not grounds to silently replace it.
        if (!(error instanceof DOMException && ['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name))) throw error;
      }
    }
    if (typeof indexedDB !== 'undefined') return databaseStorage();
    throw new Error('Persistent sticker storage is unavailable in this browser.');
  })().catch((error) => { storagePromise = null; throw error; });
  return storagePromise;
}

export interface StickerSnapshot {
  list: MochiSticker[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  location: string;
}

/** Kept injectable so persistence and duplicate-name handling are testable offline. */
export function createStickerLibrary(getStorage: () => Promise<StickerStorage>, urls = URL) {
  let snapshot: StickerSnapshot = { list: [], loading: false, loaded: false, error: null, location: STICKER_FOLDER };
  const listeners = new Set<() => void>();
  let pending: Promise<void> = Promise.resolve();

  const publish = (patch: Partial<StickerSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const render = (records: StoredSticker[], location: string) => {
    const old = snapshot.list;
    const list = records.map((record) => ({ id: record.id, name: record.name, url: urls.createObjectURL(record.blob) }));
    publish({ list, location, loaded: true, error: null });
    for (const sticker of old) urls.revokeObjectURL(sticker.url);
  };
  const run = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = pending.then(async () => {
      publish({ loading: true, error: null });
      try { return await operation(); }
      catch (error) {
        publish({ error: error instanceof Error ? error.message : 'The sticker library could not be saved.' });
        throw error;
      } finally { publish({ loading: false }); }
    });
    pending = task.then(() => {}, () => {});
    return task;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => run(async () => { const backend = await getStorage(); render(await backend.read(), backend.location); }),
    add: (files: File[]) => run(async () => {
      if (!files.length) return;
      const prepared = await Promise.all(files.map(async (file) => ({ file, ...await stickerFileType(file) })));
      const backend = await getStorage();
      const records = await backend.read();
      const names = new Set(records.map((record) => record.name.toLowerCase()));
      for (const { file, mimeType, extension } of prepared) {
        const base = normalizeStickerName(file.name);
        let name = base;
        for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base}_${suffix}`;
        names.add(name.toLowerCase());
        const id = newId();
        records.push({ id, name, mimeType, fileName: `${id}.${extension}`, blob: file.slice(0, file.size, mimeType) });
      }
      await backend.write(records);
      render(records, backend.location);
    }),
    remove: (id: string) => run(async () => {
      const backend = await getStorage();
      const records = (await backend.read()).filter((record) => record.id !== id);
      await backend.write(records);
      render(records, backend.location);
    }),
  };
}

const library = createStickerLibrary(storage);
let channel: BroadcastChannel | null = null;
let loadPromise: Promise<void> | null = null;

function connectTabs(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('mochi-os-stickers');
  channel.onmessage = () => { void library.load().catch(() => {}); };
}

async function locked<T>(operation: () => Promise<T>): Promise<T> {
  connectTabs();
  const result = typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request('mochi-os-stickers', operation)
    : await operation();
  channel?.postMessage('updated');
  return result;
}

export const getStickerSnapshot = library.getSnapshot;
export const subscribeStickers = library.subscribe;
export function loadMochiStickers(): Promise<void> {
  connectTabs();
  if (library.getSnapshot().loaded) return Promise.resolve();
  loadPromise ??= library.load().finally(() => { loadPromise = null; });
  return loadPromise;
}
export const importMochiStickers = (files: File[]) => locked(() => library.add(files));
export const deleteMochiSticker = (id: string) => locked(() => library.remove(id));
