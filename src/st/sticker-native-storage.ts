import { ctx } from './adapter';
import {
  checkedManifest, imageDataUrl, namesFor, suggestStickerName, StickerStorageConflictError, stickerFileType,
  type StickerStorage, type StoredSticker,
} from './sticker-format';

const FOLDER = 'mochi-os-stickers';
const INDEX = 'mochi-os-stickers-library.json';
const INDEX_PATH = `user/files/${INDEX}`;
const IMAGE_PATH = `user/images/${FOLDER}/`;

/** ST's clientRelativePath may retain the separator after the user root. */
function isExpectedUploadPath(actual: unknown, expected: string): boolean {
  return actual === expected || actual === `/${expected}`;
}

function nativeRequest(fetcher: typeof fetch, headers: () => HeadersInit) {
  return async (route: string, body?: unknown): Promise<Response> => {
    const response = await fetcher(route, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok && !(response.status === 404 && (body === undefined || route.endsWith('/delete')))) {
      throw new Error(`Sticker storage request failed (${response.status}): ${route}.`);
    }
    return response;
  };
}

type NativeRequest = ReturnType<typeof nativeRequest>;

async function indexText(request: NativeRequest): Promise<string> {
  const response = await request(`/${INDEX_PATH}`);
  return response.status === 404 ? '' : response.text();
}

function safeFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value !== '.' && value !== '..'
    && !/[\\/<>:"|?*\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && !/[. ]$/.test(value);
}

async function imageNames(request: NativeRequest): Promise<string[]> {
  const response = await request('/api/images/list', { folder: FOLDER });
  const names: unknown = await response.json();
  if (!Array.isArray(names) || !names.every(safeFileName)) throw new Error('Invalid sticker file list.');
  return [...new Set(names)].sort();
}

/** Deterministic ids let a recovered, unindexed image be renamed before its first save. */
async function recoveredId(fileName: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fileName));
  return `recovered-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

/** Native APIs have no compare-and-swap: preflight catches stale saves, not simultaneous writes. */
export function createNativeStickerStorage(
  fetcher: typeof fetch = fetch,
  headers: () => HeadersInit = () => ctx().getRequestHeaders(),
): StickerStorage {
  const request = nativeRequest(fetcher, headers);
  let revision = '';
  let previous: StoredSticker[] = [];
  let migrations: string[] = [];
  let sources = new Map<string, string>();
  let deletedFiles: string[] = [];
  const backend: StickerStorage = {
    location: IMAGE_PATH,
    hasMigration: (id) => migrations.includes(id),
    async read() {
      const text = await indexText(request);
      let value;
      try {
        const parsed = text ? JSON.parse(text) : { version: 1, stickers: [] };
        value = Array.isArray(parsed) ? { version: 1, stickers: parsed } : parsed;
        if (value?.version !== 1) throw new Error();
        value.migrations ??= [];
        value.deletedFiles ??= [];
        value.imageFiles ??= {};
        if (!Array.isArray(value.migrations) || !value.migrations.every((id: unknown) => typeof id === 'string')
          || !Array.isArray(value.deletedFiles) || !value.deletedFiles.every(safeFileName)
          || !value.imageFiles || typeof value.imageFiles !== 'object' || Array.isArray(value.imageFiles)
          || !Object.values(value.imageFiles).every(safeFileName)) throw new Error();
      } catch { throw new Error('The Mochi sticker library index is invalid and was not replaced. Restore a JSON backup.'); }
      const manifest = checkedManifest(value.stickers);
      const files = await imageNames(request);
      const byName = new Map(files.map((file) => [file.toLowerCase(), file]));
      const claimed = new Set<string>();
      const nextSources = new Map<string, string>();
      const missing: string[] = [];
      const invalid: string[] = [];
      const loaded = await Promise.all(manifest.map(async (entry) => {
        const source = value.imageFiles[entry.fileName] ?? entry.fileName;
        const file = byName.get(source.toLowerCase()) ?? source;
        claimed.add(file);
        nextSources.set(entry.fileName, file);
        const cached = sources.get(entry.fileName) === file ? previous.find((record) => record.fileName === entry.fileName && record.mimeType === entry.mimeType) : null;
        const response = cached && files.includes(file) ? null : await request(`/${IMAGE_PATH}${encodeURIComponent(file)}`);
        if (response?.status === 404) { missing.push(entry.name); return null; }
        const blob = response ? await response.blob() : cached!.blob;
        try {
          if ((await stickerFileType(blob)).mimeType !== entry.mimeType) throw new Error();
        } catch { invalid.push(entry.name); return null; }
        return { ...entry, blob };
      }));
      const records = loaded.filter((record): record is StoredSticker => record !== null);
      const usedNames = manifest.flatMap(namesFor);
      const usedIds = new Set(manifest.map((entry) => entry.id));
      const deleted = new Set(value.deletedFiles.map((file: string) => file.toLowerCase()));
      let recovered = 0;
      // The index is metadata, not proof that an image exists. Interrupted uploads,
      // a lost index, and manually restored files must not make this folder invisible.
      for (const file of files) {
        if (claimed.has(file) || deleted.has(file.toLowerCase()) || !/\.(png|jpe?g|gif|webp)$/i.test(file)) continue;
        const response = await request(`/${IMAGE_PATH}${encodeURIComponent(file)}`);
        if (response.status === 404) continue;
        const blob = await response.blob();
        let type;
        try { type = await stickerFileType(blob); }
        catch { invalid.push(file); continue; }
        const stem = file.replace(/\.[^.]+$/, '');
        let id = /^[\w-]{1,128}$/.test(stem) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem) ? stem : await recoveredId(file);
        if (usedIds.has(id)) id = await recoveredId(file);
        const fileName = `${id}.${type.extension}`;
        const name = suggestStickerName(file, usedNames);
        usedNames.push(name); usedIds.add(id);
        nextSources.set(fileName, file);
        records.push({ id, name, fileName, mimeType: type.mimeType, blob });
        recovered++;
      }
      checkedManifest(records);
      const warnings = [
        recovered && `Recovered ${recovered} saved sticker image(s) from the folder. Names came from filenames; use Manage to rename them or restore original names from a JSON backup.`,
        missing.length && `${missing.length} indexed sticker image(s) are missing. Restore their image files or a JSON backup, then refresh.`,
        invalid.length && `${invalid.length} invalid sticker image(s) were skipped. Other saved stickers are still available.`,
      ].filter(Boolean);
      backend.warning = warnings.length ? warnings.join(' ') : undefined;
      revision = text;
      migrations = value.migrations;
      deletedFiles = value.deletedFiles;
      sources = nextSources;
      previous = records.map((record) => ({ ...record }));
      return records;
    },
    async write(stickers, migrationIds = []) {
      const manifest = checkedManifest(stickers);
      if (await indexText(request) !== revision) throw new StickerStorageConflictError();
      const nextSources = new Map<string, string>();
      for (const record of stickers) {
        const source = sources.get(record.fileName) ?? record.fileName;
        nextSources.set(record.fileName, source);
        if (previous.some((old) => old.fileName === record.fileName)) continue;
        const data = await imageDataUrl(record.blob, record.mimeType);
        const filename = record.fileName;
        const response = await request('/api/images/upload', {
          image: data.slice(data.indexOf(',') + 1), format: filename.split('.').pop(), filename, ch_name: FOLDER,
        });
        if (!response.ok) throw new Error('Could not upload sticker image.');
        const result = await response.json();
        if (!isExpectedUploadPath(result.path, `${IMAGE_PATH}${filename}`)) throw new Error('Unexpected sticker image location.');
      }
      if (await indexText(request) !== revision) throw new StickerStorageConflictError();
      const keptFiles = new Set(nextSources.values());
      const removedFiles = [...sources.values()].filter((file) => !keptFiles.has(file));
      const nextDeletedFiles = [...new Set([...deletedFiles, ...removedFiles])].filter((file) => !keptFiles.has(file));
      const nextMigrations = [...new Set([...migrations, ...migrationIds])];
      const imageFiles = Object.fromEntries([...nextSources].filter(([fileName, source]) => fileName !== source));
      const text = JSON.stringify({ version: 1, stickers: manifest, migrations: nextMigrations, imageFiles, deletedFiles: nextDeletedFiles });
      const data = await imageDataUrl(new Blob([text]), 'application/json');
      const saved = await request('/api/files/upload', { name: INDEX, data: data.slice(data.indexOf(',') + 1) });
      if (!isExpectedUploadPath((await saved.json()).path, INDEX_PATH)) throw new Error('Unexpected sticker index location.');
      revision = text;
      previous = stickers.map((record) => ({ ...record }));
      migrations = nextMigrations;
      sources = nextSources;
      deletedFiles = nextDeletedFiles;
      // Tombstones are saved first: a failed delete must not resurrect an image
      // when the next read reconciles the directory with the index.
      const results = await Promise.allSettled(removedFiles.map((file) => request('/api/images/delete', { path: `${IMAGE_PATH}${file}` })));
      backend.warning = results.some((result) => result.status === 'rejected') ? 'Library saved, but some unused images could not be deleted. Uninstall cleanup will retry them.' : undefined;
    },
  };
  return backend;
}

/** List the dedicated folder too, so interrupted uploads are cleaned up on uninstall. */
export async function deleteNativeStickers(): Promise<void> {
  const request = nativeRequest(fetch, () => ctx().getRequestHeaders());
  const names = await imageNames(request);
  await Promise.all(names.map((name) => request('/api/images/delete', { path: `${IMAGE_PATH}${name}` })));
  await request('/api/files/delete', { path: INDEX_PATH });
}
