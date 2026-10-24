/** Global Mochi-owned media. Persistence belongs to the extension's server folder. */
import {
  assertUniqueNames, availableName, BACKUP_FORMAT, checkedName, imageDataUrl, namesFor, newStickerId as newId,
  readStickerBackup, STICKER_FOLDER, stickerFileType, stickerNameKey, StickerStorageConflictError,
  type MochiSticker, type StickerStorage, type StickerUpload, type StoredSticker,
} from './sticker-format';
import { extensionStickerStorage } from './sticker-storage';

export * from './sticker-format';
export { exportBrowserStickersJson } from './sticker-storage';

let storagePromise: Promise<StickerStorage> | null = null;
function storage(): Promise<StickerStorage> {
  storagePromise ??= extensionStickerStorage().catch((error) => { storagePromise = null; throw error; });
  return storagePromise;
}

export interface StickerSnapshot {
  list: MochiSticker[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  location: string;
  warning: string | null;
}

/** Kept injectable so persistence and duplicate-name handling are testable offline. */
export function createStickerLibrary(getStorage: () => Promise<StickerStorage>, urls = URL) {
  let snapshot: StickerSnapshot = { list: [], loading: false, loaded: false, error: null, location: STICKER_FOLDER, warning: null };
  const listeners = new Set<() => void>();
  let pending: Promise<void> = Promise.resolve();

  const publish = (patch: Partial<StickerSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const render = (records: StoredSticker[], backend: StickerStorage) => {
    const old = snapshot.list;
    const list = records.map((record) => ({ id: record.id, name: record.name, aliases: record.aliases, url: urls.createObjectURL(record.blob) }));
    publish({ list, location: backend.location, warning: backend.warning ?? null, loaded: true, error: null });
    for (const sticker of old) urls.revokeObjectURL(sticker.url);
  };
  const run = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = pending.then(async () => {
      publish({ loading: true, error: null });
      try {
        for (let attempt = 0; ; attempt++) {
          try { return await operation(); }
          catch (error) {
            // Another device won the compare-and-swap. Re-read and revalidate;
            // never submit the stale full library again or lose someone else's save.
            if (!(error instanceof StickerStorageConflictError) || attempt >= 2) throw error;
          }
        }
      }
      catch (error) {
        publish({ error: error instanceof Error ? error.message : 'The sticker library could not be saved.' });
        throw error;
      } finally { publish({ loading: false }); }
    });
    pending = task.then(() => {}, () => {});
    return task;
  };

  const add = async (inputs: Array<File | StickerUpload>) => {
    if (!inputs.length) return;
    const prepared = await Promise.all(inputs.map(async (input) => {
      const upload = 'file' in input ? input : { file: input };
      return { ...upload, ...await stickerFileType(upload.file) };
    }));
    const backend = await getStorage();
    const records = await backend.read();
    const usedKeys = new Set(records.flatMap(namesFor).map(stickerNameKey));
    for (const upload of prepared) {
      const name = checkedName(upload.name ?? availableName(upload.file.name, usedKeys), usedKeys);
      const aliases = [...new Set((upload.aliases ?? []).map((alias) => checkedName(alias, usedKeys)))].filter((alias) => alias !== name);
      for (const entry of [name, ...aliases]) usedKeys.add(stickerNameKey(entry));
      const id = newId();
      records.push({ id, name, aliases, mimeType: upload.mimeType, fileName: `${id}.${upload.extension}`, blob: upload.file.slice(0, upload.file.size, upload.mimeType) });
    }
    assertUniqueNames(records);
    await backend.write(records);
    render(records, backend);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => run(async () => { const backend = await getStorage(); render(await backend.read(), backend); }),
    add: (inputs: Array<File | StickerUpload>) => run(() => add(inputs)),
    importJson: (source: Blob | string) => run(async () => add(await readStickerBackup(source))),
    exportJson: () => run(async () => {
      const backend = await getStorage();
      const records = await backend.read();
      assertUniqueNames(records);
      const stickers = await Promise.all(records.map(async (record) => {
        const { mimeType } = await stickerFileType(record.blob);
        return { name: record.name, aliases: record.aliases, mimeType, data: await imageDataUrl(record.blob, mimeType) };
      }));
      return JSON.stringify({ format: BACKUP_FORMAT, version: 1, stickers }, null, 2);
    }),
    rename: (id: string, value: string) => run(async () => {
      const backend = await getStorage();
      const records = await backend.read();
      const record = records.find((sticker) => sticker.id === id);
      if (!record) throw new Error('This sticker is no longer saved. Reopen the sticker library and try again.');
      const usedKeys = new Set(records.filter((sticker) => sticker.id !== id).flatMap(namesFor).map(stickerNameKey));
      const name = checkedName(value, usedKeys);
      const aliases = [...new Set([...record.aliases ?? [], record.name])].filter((alias) => alias !== name);
      const next = records.map((sticker) => sticker.id === id ? { ...sticker, name, aliases } : sticker);
      assertUniqueNames(next);
      await backend.write(next);
      render(next, backend);
    }),
    remove: (id: string) => run(async () => {
      const backend = await getStorage();
      const records = (await backend.read()).filter((record) => record.id !== id);
      assertUniqueNames(records);
      await backend.write(records);
      render(records, backend);
    }),
  };
}

const library = createStickerLibrary(storage);
let channel: BroadcastChannel | null = null;
let loadPromise: Promise<void> | null = null;
let watchingFocus = false;

function connectTabs(): void {
  if (!watchingFocus && typeof window !== 'undefined' && window.addEventListener) {
    watchingFocus = true;
    window.addEventListener('focus', () => {
      if (library.getSnapshot().loaded) void loadMochiStickers().catch(() => {});
    });
  }
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('mochi-os-stickers');
  channel.onmessage = () => { void library.load().catch(() => {}); };
}

async function locked<T>(operation: () => Promise<T>, notify = true): Promise<T> {
  connectTabs();
  const result = typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request('mochi-os-stickers', operation)
    : await operation();
  if (notify) channel?.postMessage('updated');
  return result;
}

export const getStickerSnapshot = library.getSnapshot;
export const subscribeStickers = library.subscribe;
export function loadMochiStickers(): Promise<void> {
  connectTabs();
  loadPromise ??= locked(() => library.load(), false).finally(() => { loadPromise = null; });
  return loadPromise;
}
export const importMochiStickers = (uploads: Array<File | StickerUpload>) => locked(() => library.add(uploads));
export const deleteMochiSticker = (id: string) => locked(() => library.remove(id));
export const renameMochiSticker = (id: string, name: string) => locked(() => library.rename(id, name));
export const exportMochiStickersJson = () => locked(() => library.exportJson(), false);
