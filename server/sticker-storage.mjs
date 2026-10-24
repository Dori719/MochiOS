/** SillyTavern server plugin. Its only writable scope is a Mochi extension's stickers/. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  checkedManifest, MAX_STICKER_BYTES, namesFor, STICKER_FOLDER, stickerFileType,
} from '../src/st/sticker-format.ts';

export const info = {
  id: 'mochi-os-stickers', name: 'Mochi OS sticker storage',
  description: 'Stores Mochi sticker images and their index inside the installed extension folder.',
};

const pending = new Map();
const stores = new Map();
const directoryKey = (directory) => process.platform === 'win32' ? directory.toLowerCase() : directory;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const missing = (error) => error?.code === 'ENOENT';

function serial(directory, operation) {
  const key = directoryKey(directory);
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, task);
  const cleanup = () => { if (pending.get(key) === task) pending.delete(key); };
  task.then(cleanup, cleanup);
  return task;
}

async function stat(io, file) {
  try {
    const entry = await io.lstat(file);
    if (entry.isSymbolicLink()) throw fail(403, 'STICKER_PATH_FORBIDDEN', 'Sticker storage cannot follow symbolic links.');
    return entry;
  } catch (error) { if (missing(error)) return null; throw error; }
}

function receipts(value) {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && /^(opfs|indexeddb):[\w-]{1,128}$/.test(id))) {
    throw fail(400, 'STICKER_INDEX_INVALID', 'The browser sticker migration receipts are invalid.');
  }
  return [...new Set(value)];
}

async function decodeImage(entry, data) {
  const prefix = `data:${entry.mimeType};base64,`;
  if (typeof data !== 'string' || !data.startsWith(prefix)) throw fail(400, 'STICKER_IMAGE_INVALID', 'Each new sticker must include its base64 image data.');
  const encoded = data.slice(prefix.length);
  if (encoded.length > 4 * Math.ceil(MAX_STICKER_BYTES / 3)) throw fail(400, 'STICKER_IMAGE_INVALID', 'Each sticker must be an image under 10 MB.');
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'STICKER_IMAGE_INVALID', 'The sticker base64 image data is invalid.');
  const bytes = Buffer.from(encoded, 'base64');
  let type;
  try { type = await stickerFileType(new Blob([bytes])); }
  catch (error) { throw fail(400, 'STICKER_IMAGE_INVALID', error.message); }
  if (type.mimeType !== entry.mimeType || !entry.fileName.endsWith(`.${type.extension}`)) {
    throw fail(400, 'STICKER_IMAGE_INVALID', 'The sticker image type or filename does not match its data.');
  }
  return bytes;
}

/** Injectable filesystem keeps atomic writes, rollback, and restart behavior testable. */
export function createDiskStickerStore(extensionDirectory, io = fs) {
  const directory = path.join(path.resolve(extensionDirectory), STICKER_FOLDER);
  // SillyTavern's public static handler ignores dotfiles. Keep both metadata
  // and images private to the authenticated plugin API, even in a global install.
  const index = path.join(directory, '.library.json');
  const imagePath = (fileName) => path.join(directory, `.${fileName}`);
  const location = `${path.basename(extensionDirectory)}/${STICKER_FOLDER}`;

  const readState = async () => {
    const folder = await stat(io, directory);
    if (folder && !folder.isDirectory()) throw fail(500, 'STICKER_INDEX_INVALID', 'The Mochi stickers path is not a folder.');
    const file = folder ? await stat(io, index) : null;
    if (!file) return { version: 1, revision: null, stickers: [], migrations: [], location };
    if (!file.isFile()) throw fail(500, 'STICKER_INDEX_INVALID', 'The Mochi sticker index is not a regular file.');
    const text = await io.readFile(index, 'utf8');
    try {
      const parsed = JSON.parse(text);
      const value = Array.isArray(parsed) ? { version: 1, stickers: parsed, migrations: [] } : parsed;
      if (value?.version !== 1) throw new Error('Unsupported index version.');
      return { version: 1, revision: hash(text), stickers: checkedManifest(value.stickers), migrations: receipts(value.migrations), location };
    } catch (error) {
      throw fail(500, 'STICKER_INDEX_INVALID', `The Mochi sticker index is invalid and was not replaced. ${error.message}`);
    }
  };

  const image = async (entry) => {
    const file = imagePath(entry.fileName);
    const existing = await stat(io, file);
    if (!existing) throw fail(404, 'STICKER_IMAGE_MISSING', 'The saved sticker image is missing. Refresh the library and try again.');
    if (!existing.isFile() || !existing.size || existing.size > MAX_STICKER_BYTES) throw fail(500, 'STICKER_IMAGE_INVALID', 'The saved sticker image is invalid.');
    const bytes = await io.readFile(file);
    const type = await stickerFileType(new Blob([bytes]));
    if (type.mimeType !== entry.mimeType || !entry.fileName.endsWith(`.${type.extension}`)) throw fail(500, 'STICKER_IMAGE_INVALID', 'The saved sticker image type is invalid.');
    return bytes;
  };

  const write = async (input) => {
    const before = await readState();
    if (!input || !(input.revision === null || typeof input.revision === 'string')) throw fail(400, 'STICKER_INDEX_INVALID', 'A sticker library revision is required.');
    if (input.revision !== before.revision) throw fail(409, 'STICKER_LIBRARY_CHANGED', 'The sticker library changed on another device. Refresh it before saving.');
    let manifest;
    try { manifest = checkedManifest(input.stickers); }
    catch (error) { throw fail(400, 'STICKER_INDEX_INVALID', error.message); }
    const migrations = receipts(input.migrations ?? []);
    const old = new Map(before.stickers.map((entry) => [entry.fileName, entry]));
    const oldFiles = new Map(before.stickers.map((entry) => [entry.fileName.toLowerCase(), entry]));
    const byId = new Map(before.stickers.map((entry) => [entry.id, entry]));
    const images = new Map();
    // Validate the complete batch before creating anything on disk.
    for (const [position, entry] of manifest.entries()) {
      const existing = byId.get(entry.id);
      const sameFile = oldFiles.get(entry.fileName.toLowerCase());
      if (sameFile && sameFile.id !== entry.id) throw fail(400, 'STICKER_IMAGE_INVALID', 'Saved sticker image ids cannot be reused with different capitalization.');
      if (existing) {
        if (existing.fileName !== entry.fileName || existing.mimeType !== entry.mimeType) throw fail(400, 'STICKER_IMAGE_INVALID', 'Saved sticker images cannot be replaced during a rename.');
        const retained = new Set(namesFor(entry));
        if (namesFor(existing).some((name) => !retained.has(name))) throw fail(400, 'STICKER_INDEX_INVALID', 'Renamed stickers must retain their previous names as aliases.');
      }
      const data = input.stickers[position].data;
      if (data !== undefined) {
        const bytes = await decodeImage(entry, data);
        if (old.has(entry.fileName)) {
          if (!(await image(existing)).equals(bytes)) throw fail(400, 'STICKER_IMAGE_INVALID', 'Saved sticker image bytes cannot be overwritten.');
        } else images.set(entry.fileName, bytes);
      } else if (!old.has(entry.fileName)) {
        throw fail(400, 'STICKER_IMAGE_INVALID', 'New stickers must include their image data.');
      } else {
        const file = await stat(io, imagePath(entry.fileName));
        if (!file?.isFile()) throw fail(404, 'STICKER_IMAGE_MISSING', 'A saved sticker image is missing; the index was not changed.');
      }
    }

    if (!await stat(io, directory)) await io.mkdir(directory);
    const created = [];
    const temporary = path.join(directory, `.library-${randomUUID()}.tmp`);
    let temporaryCreated = false;
    let committed = false;
    const document = { version: 1, stickers: manifest, migrations: [...new Set([...before.migrations, ...migrations])] };
    const text = JSON.stringify(document, null, 2);
    try {
      for (const [fileName, bytes] of images) {
        const target = imagePath(fileName);
        const existing = await stat(io, target);
        // A prior interrupted save may have left an unindexed image. Reuse it
        // only if identical; never overwrite an unrelated file or symlink.
        if (existing) {
          if (!existing.isFile() || existing.size !== bytes.length || !(await io.readFile(target)).equals(bytes)) throw fail(409, 'STICKER_FILE_EXISTS', 'An unrelated sticker file already uses this image id.');
          continue;
        }
        const handle = await io.open(target, 'wx');
        created.push(target);
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); }
      }
      const handle = await io.open(temporary, 'wx');
      temporaryCreated = true;
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      // Image bytes reach disk first. This is the only point that commits a pack.
      await io.rename(temporary, index);
      committed = true;
    } finally {
      if (!committed && temporaryCreated) await io.unlink(temporary).catch(() => {});
      if (!committed) await Promise.all(created.map((file) => io.unlink(file).catch(() => {})));
    }
    const kept = new Set(manifest.map((entry) => entry.fileName.toLowerCase()));
    await Promise.all(before.stickers.filter((entry) => !kept.has(entry.fileName.toLowerCase()))
      .map((entry) => io.unlink(imagePath(entry.fileName)).catch(() => {})));
    return { ...document, revision: hash(text), location };
  };

  return {
    directory,
    read: () => serial(directory, readState),
    write: (input) => serial(directory, () => write(input)),
    image: (fileName) => serial(directory, async () => {
      const state = await readState();
      const entry = state.stickers.find((record) => record.fileName === fileName);
      if (!entry) throw fail(404, 'STICKER_IMAGE_MISSING', 'This image is not in the saved sticker library.');
      return { bytes: await image(entry), mimeType: entry.mimeType };
    }),
  };
}

async function resolveExtension(request, serverRoot) {
  if (!request.user?.profile || !request.user?.directories) throw fail(403, 'STICKER_AUTH_REQUIRED', 'Sign in to SillyTavern before using saved stickers.');
  const name = request.query?.extension;
  if (typeof name !== 'string' || !name || name.length > 128 || name === '.' || name === '..'
    || /[\\/<>:"|?*\p{Cc}]/u.test(name) || name.endsWith('.') || name.endsWith(' ')) throw fail(400, 'STICKER_PATH_FORBIDDEN', 'A valid Mochi OS extension folder name is required.');
  const roots = [
    { directory: request.user.directories.extensions, global: false },
    { directory: path.join(serverRoot, 'public', 'scripts', 'extensions', 'third-party'), global: true },
  ];
  for (const root of roots) {
    if (typeof root.directory !== 'string') continue;
    const candidate = path.join(root.directory, name);
    const entry = await stat(fs, candidate);
    if (!entry) continue;
    if (!entry.isDirectory()) throw fail(400, 'STICKER_PATH_FORBIDDEN', 'The Mochi extension path is not a folder.');
    const [parent, extension] = await Promise.all([fs.realpath(root.directory), fs.realpath(candidate)]);
    const relative = path.relative(parent, extension);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw fail(403, 'STICKER_PATH_FORBIDDEN', 'The Mochi extension must be inside a SillyTavern extension directory.');
    let manifest;
    try {
      const file = path.join(extension, 'manifest.json');
      if (!(await stat(fs, file))?.isFile()) throw new Error();
      manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { throw fail(400, 'STICKER_PATH_FORBIDDEN', 'This folder is not an installed Mochi OS extension.'); }
    if (manifest.display_name !== 'Mochi OS' || manifest.js !== 'index.js') throw fail(400, 'STICKER_PATH_FORBIDDEN', 'Sticker storage is restricted to the Mochi OS extension folder.');
    if (root.global && request.method !== 'GET' && !request.user.profile.admin) throw fail(403, 'STICKER_ADMIN_REQUIRED', 'Only SillyTavern admins can change stickers in a globally installed extension. Install Mochi OS for your user to manage a personal library.');
    return extension;
  }
  throw fail(404, 'STICKER_EXTENSION_MISSING', 'The installed Mochi OS extension folder could not be found.');
}

/** Mounted after SillyTavern's login and CSRF middleware, never a general file API. */
export function registerStickerRoutes(router, { serverRoot = process.cwd() } = {}) {
  const handle = (operation) => async (request, response) => {
    try {
      response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const extension = await resolveExtension(request, serverRoot);
      const key = directoryKey(extension);
      if (!stores.has(key)) stores.set(key, createDiskStickerStore(extension));
      await operation(stores.get(key), request, response);
    } catch (error) {
      if (!error.status) console.error('Mochi sticker storage:', error);
      response.status(error.status ?? 500).json({
        code: error.status ? error.code : 'STICKER_STORAGE_FAILED',
        error: error.status ? error.message : 'Mochi could not save or read the extension sticker folder. Check SillyTavern folder permissions and server logs. No browser-storage fallback was used.',
      });
    }
  };
  router.get('/library', handle(async (store, _request, response) => response.json(await store.read())));
  router.post('/library', handle(async (store, request, response) => response.json(await store.write(request.body))));
  router.get('/images/:fileName', handle(async (store, request, response) => {
    const image = await store.image(request.params.fileName);
    response.set('Content-Type', image.mimeType).send(image.bytes);
  }));
}

export async function init(router) { registerStickerRoutes(router); }
export async function exit() { await Promise.allSettled([...pending.values()]); }
