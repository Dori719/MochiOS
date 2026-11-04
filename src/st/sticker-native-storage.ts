import { ctx } from './adapter';
import { checkedManifest, imageDataUrl, StickerStorageConflictError, stickerFileType, type StickerStorage, type StoredSticker } from './sticker-format';

const FOLDER = 'mochi-os-stickers';
const INDEX = 'mochi-os-stickers-library.json';
const INDEX_PATH = `user/files/${INDEX}`;
const IMAGE_PATH = `user/images/${FOLDER}/`;

async function request(route: string, body?: unknown): Promise<Response> {
  const response = await fetch(route, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: ctx().getRequestHeaders(), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Sticker storage request failed (${response.status}).`);
  return response;
}

async function indexText(): Promise<string> {
  const response = await request(`/${INDEX_PATH}`);
  return response.status === 404 ? '' : response.text();
}

function imageName(fileName: string): string { return fileName.replace(/^\./, ''); }

/** Native APIs have no compare-and-swap: preflight catches stale saves, not simultaneous writes. */
export function createNativeStickerStorage(): StickerStorage {
  let revision = '';
  let previous: StoredSticker[] = [];
  let migrations: string[] = [];
  const backend: StickerStorage = {
    location: IMAGE_PATH,
    hasMigration: (id) => migrations.includes(id),
    async read() {
      const text = await indexText();
      const value = text ? JSON.parse(text) : { version: 1, stickers: [], migrations: [] };
      if (value.version !== 1 || !Array.isArray(value.migrations) || !value.migrations.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid Mochi sticker library index.');
      const manifest = checkedManifest(value.stickers);
      const missing: string[] = [];
      const loaded = await Promise.all(manifest.map(async (entry) => {
        const cached = previous.find((record) => record.fileName === entry.fileName);
        const response = cached ? null : await request(`/${IMAGE_PATH}${imageName(entry.fileName)}`);
        if (response?.status === 404) { missing.push(entry.name); return null; }
        const blob = cached?.blob ?? await response!.blob();
        if ((await stickerFileType(blob)).mimeType !== entry.mimeType) throw new Error(`Invalid sticker image: ${entry.name}.`);
        return { ...entry, blob };
      }));
      const records = loaded.filter((record): record is StoredSticker => record !== null);
      backend.warning = missing.length ? `${missing.length} missing sticker image(s) were skipped. Restore a JSON backup or erase all stickers to reset the library.` : undefined;
      revision = text;
      migrations = value.migrations;
      previous = records;
      return records;
    },
    async write(stickers, migrationIds = []) {
      const manifest = checkedManifest(stickers);
      if (await indexText() !== revision) throw new StickerStorageConflictError();
      for (const record of stickers) {
        if (previous.some((old) => old.fileName === record.fileName)) continue;
        const data = await imageDataUrl(record.blob, record.mimeType);
        const filename = imageName(record.fileName);
        const response = await request('/api/images/upload', {
          image: data.slice(data.indexOf(',') + 1), format: filename.split('.').pop(), filename, ch_name: FOLDER,
        });
        if (!response.ok) throw new Error('Could not upload sticker image.');
        const result = await response.json();
        if (result.path !== `${IMAGE_PATH}${filename}`) throw new Error('Unexpected sticker image location.');
      }
      if (await indexText() !== revision) throw new StickerStorageConflictError();
      const nextMigrations = [...new Set([...migrations, ...migrationIds])];
      const text = JSON.stringify({ version: 1, stickers: manifest, migrations: nextMigrations });
      const data = await imageDataUrl(new Blob([text]), 'application/json');
      const saved = await request('/api/files/upload', { name: INDEX, data: data.slice(data.indexOf(',') + 1) });
      if (!saved.ok) throw new Error('Could not save sticker library.');
      const removed = previous.filter((old) => !stickers.some((record) => record.fileName === old.fileName));
      revision = text;
      previous = stickers;
      migrations = nextMigrations;
      const results = await Promise.allSettled(removed.map((record) => request('/api/images/delete', { path: `${IMAGE_PATH}${imageName(record.fileName)}` })));
      backend.warning = results.some((result) => result.status === 'rejected') ? 'Library saved, but some unused images could not be deleted. Uninstall cleanup will retry them.' : undefined;
    },
  };
  return backend;
}

/** List the dedicated folder too, so interrupted uploads are cleaned up on uninstall. */
export async function deleteNativeStickers(): Promise<void> {
  const response = await request('/api/images/list', { folder: FOLDER });
  if (!response.ok) throw new Error('Could not list stickers for uninstall.');
  const names: unknown = await response.json();
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name))) throw new Error('Invalid sticker file list.');
  await Promise.all(names.map((name) => request('/api/images/delete', { path: `${IMAGE_PATH}${name}` })));
  await request('/api/files/delete', { path: INDEX_PATH });
}
