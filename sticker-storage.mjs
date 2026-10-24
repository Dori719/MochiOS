// server/sticker-storage.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

// src/st/sticker-format.ts
var STICKER_FOLDER = "stickers";
var MAX_STICKER_BYTES = 10 * 1024 * 1024;
var MAX_STICKER_NAME_LENGTH = 128;
function stickerNameKey(value) {
  return value.normalize("NFKC").trim().toLowerCase();
}
function duplicateNameError(name) {
  return `A sticker named ${JSON.stringify(name)} already exists. Choose a different name.`;
}
function stickerNameError(value, usedNames = []) {
  const name = value.normalize("NFKC").trim();
  if (!name) return "Enter a sticker name.";
  if (name.length > MAX_STICKER_NAME_LENGTH) return `Sticker names must be ${MAX_STICKER_NAME_LENGTH} characters or fewer.`;
  if (/[\p{Cc}\p{Zl}\p{Zp}:]/u.test(name) || /^\[Sticker\]/i.test(name)) {
    return "Sticker names cannot contain colons, control characters, or start with [Sticker].";
  }
  const key = stickerNameKey(name);
  for (const used of usedNames) if (stickerNameKey(used) === key) return duplicateNameError(name);
  return null;
}
function checkedName(value, usedKeys = /* @__PURE__ */ new Set()) {
  const error = stickerNameError(value);
  if (error) throw new Error(error);
  const name = value.normalize("NFKC").trim();
  if (usedKeys.has(stickerNameKey(name))) throw new Error(duplicateNameError(name));
  return name;
}
function namesFor(sticker) {
  return [sticker.name, ...sticker.aliases ?? []];
}
function assertUniqueNames(stickers) {
  const usedKeys = /* @__PURE__ */ new Set();
  for (const sticker of stickers) {
    const ownKeys = /* @__PURE__ */ new Set();
    for (const name of namesFor(sticker)) {
      const key = stickerNameKey(name);
      if (usedKeys.has(key)) throw new Error(duplicateNameError(name));
      ownKeys.add(key);
    }
    for (const key of ownKeys) usedKeys.add(key);
  }
}
async function stickerFileType(blob) {
  if (!blob.size || blob.size > MAX_STICKER_BYTES) throw new Error("Each sticker must be an image under 10 MB.");
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return { mimeType: "image/png", extension: "png" };
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mimeType: "image/gif", extension: "gif" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mimeType: "image/jpeg", extension: "jpg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  throw new Error("Stickers must be PNG, JPEG, GIF, or WebP images.");
}
function validEntry(value) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return typeof entry.id === "string" && /^[\w-]{1,128}$/.test(entry.id) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(entry.id) && typeof entry.name === "string" && typeof entry.fileName === "string" && entry.fileName.startsWith(`${entry.id}.`) && /^[\w-]+\.(png|jpg|gif|webp)$/.test(entry.fileName) && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(entry.mimeType) && (entry.aliases === void 0 || Array.isArray(entry.aliases) && entry.aliases.every((alias) => typeof alias === "string"));
}
function checkedManifest(value) {
  if (!Array.isArray(value) || !value.every(validEntry)) throw new Error("The Mochi sticker library index is invalid.");
  const ids = /* @__PURE__ */ new Set();
  const files = /* @__PURE__ */ new Set();
  const entries = value.map((entry) => {
    const fileKey = entry.fileName.toLowerCase();
    if (ids.has(entry.id) || files.has(fileKey)) throw new Error("The Mochi sticker library contains duplicate image ids.");
    ids.add(entry.id);
    files.add(fileKey);
    return {
      id: entry.id,
      name: checkedName(entry.name),
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      ...entry.aliases ? { aliases: entry.aliases.map((alias) => checkedName(alias)) } : {}
    };
  });
  assertUniqueNames(entries);
  return entries;
}

// server/sticker-storage.mjs
var info = {
  id: "mochi-os-stickers",
  name: "Mochi OS sticker storage",
  description: "Stores Mochi sticker images and their index inside the installed extension folder."
};
var pending = /* @__PURE__ */ new Map();
var stores = /* @__PURE__ */ new Map();
var directoryKey = (directory) => process.platform === "win32" ? directory.toLowerCase() : directory;
var hash = (text) => createHash("sha256").update(text).digest("hex");
var fail = (status, code, message) => Object.assign(new Error(message), { status, code });
var missing = (error) => error?.code === "ENOENT";
function serial(directory, operation) {
  const key = directoryKey(directory);
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => {
  }).then(operation);
  pending.set(key, task);
  const cleanup = () => {
    if (pending.get(key) === task) pending.delete(key);
  };
  task.then(cleanup, cleanup);
  return task;
}
async function stat(io, file) {
  try {
    const entry = await io.lstat(file);
    if (entry.isSymbolicLink()) throw fail(403, "STICKER_PATH_FORBIDDEN", "Sticker storage cannot follow symbolic links.");
    return entry;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
function receipts(value) {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && /^(opfs|indexeddb):[\w-]{1,128}$/.test(id))) {
    throw fail(400, "STICKER_INDEX_INVALID", "The browser sticker migration receipts are invalid.");
  }
  return [...new Set(value)];
}
async function decodeImage(entry, data) {
  const prefix = `data:${entry.mimeType};base64,`;
  if (typeof data !== "string" || !data.startsWith(prefix)) throw fail(400, "STICKER_IMAGE_INVALID", "Each new sticker must include its base64 image data.");
  const encoded = data.slice(prefix.length);
  if (encoded.length > 4 * Math.ceil(MAX_STICKER_BYTES / 3)) throw fail(400, "STICKER_IMAGE_INVALID", "Each sticker must be an image under 10 MB.");
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, "STICKER_IMAGE_INVALID", "The sticker base64 image data is invalid.");
  const bytes = Buffer.from(encoded, "base64");
  let type;
  try {
    type = await stickerFileType(new Blob([bytes]));
  } catch (error) {
    throw fail(400, "STICKER_IMAGE_INVALID", error.message);
  }
  if (type.mimeType !== entry.mimeType || !entry.fileName.endsWith(`.${type.extension}`)) {
    throw fail(400, "STICKER_IMAGE_INVALID", "The sticker image type or filename does not match its data.");
  }
  return bytes;
}
function createDiskStickerStore(extensionDirectory, io = fs) {
  const directory = path.join(path.resolve(extensionDirectory), STICKER_FOLDER);
  const index = path.join(directory, ".library.json");
  const imagePath = (fileName) => path.join(directory, `.${fileName}`);
  const location = `${path.basename(extensionDirectory)}/${STICKER_FOLDER}`;
  const readState = async () => {
    const folder = await stat(io, directory);
    if (folder && !folder.isDirectory()) throw fail(500, "STICKER_INDEX_INVALID", "The Mochi stickers path is not a folder.");
    const file = folder ? await stat(io, index) : null;
    if (!file) return { version: 1, revision: null, stickers: [], migrations: [], location };
    if (!file.isFile()) throw fail(500, "STICKER_INDEX_INVALID", "The Mochi sticker index is not a regular file.");
    const text = await io.readFile(index, "utf8");
    try {
      const parsed = JSON.parse(text);
      const value = Array.isArray(parsed) ? { version: 1, stickers: parsed, migrations: [] } : parsed;
      if (value?.version !== 1) throw new Error("Unsupported index version.");
      return { version: 1, revision: hash(text), stickers: checkedManifest(value.stickers), migrations: receipts(value.migrations), location };
    } catch (error) {
      throw fail(500, "STICKER_INDEX_INVALID", `The Mochi sticker index is invalid and was not replaced. ${error.message}`);
    }
  };
  const image = async (entry) => {
    const file = imagePath(entry.fileName);
    const existing = await stat(io, file);
    if (!existing) throw fail(404, "STICKER_IMAGE_MISSING", "The saved sticker image is missing. Refresh the library and try again.");
    if (!existing.isFile() || !existing.size || existing.size > MAX_STICKER_BYTES) throw fail(500, "STICKER_IMAGE_INVALID", "The saved sticker image is invalid.");
    const bytes = await io.readFile(file);
    const type = await stickerFileType(new Blob([bytes]));
    if (type.mimeType !== entry.mimeType || !entry.fileName.endsWith(`.${type.extension}`)) throw fail(500, "STICKER_IMAGE_INVALID", "The saved sticker image type is invalid.");
    return bytes;
  };
  const write = async (input) => {
    const before = await readState();
    if (!input || !(input.revision === null || typeof input.revision === "string")) throw fail(400, "STICKER_INDEX_INVALID", "A sticker library revision is required.");
    if (input.revision !== before.revision) throw fail(409, "STICKER_LIBRARY_CHANGED", "The sticker library changed on another device. Refresh it before saving.");
    let manifest;
    try {
      manifest = checkedManifest(input.stickers);
    } catch (error) {
      throw fail(400, "STICKER_INDEX_INVALID", error.message);
    }
    const migrations = receipts(input.migrations ?? []);
    const old = new Map(before.stickers.map((entry) => [entry.fileName, entry]));
    const oldFiles = new Map(before.stickers.map((entry) => [entry.fileName.toLowerCase(), entry]));
    const byId = new Map(before.stickers.map((entry) => [entry.id, entry]));
    const images = /* @__PURE__ */ new Map();
    for (const [position, entry] of manifest.entries()) {
      const existing = byId.get(entry.id);
      const sameFile = oldFiles.get(entry.fileName.toLowerCase());
      if (sameFile && sameFile.id !== entry.id) throw fail(400, "STICKER_IMAGE_INVALID", "Saved sticker image ids cannot be reused with different capitalization.");
      if (existing) {
        if (existing.fileName !== entry.fileName || existing.mimeType !== entry.mimeType) throw fail(400, "STICKER_IMAGE_INVALID", "Saved sticker images cannot be replaced during a rename.");
        const retained = new Set(namesFor(entry));
        if (namesFor(existing).some((name) => !retained.has(name))) throw fail(400, "STICKER_INDEX_INVALID", "Renamed stickers must retain their previous names as aliases.");
      }
      const data = input.stickers[position].data;
      if (data !== void 0) {
        const bytes = await decodeImage(entry, data);
        if (old.has(entry.fileName)) {
          if (!(await image(existing)).equals(bytes)) throw fail(400, "STICKER_IMAGE_INVALID", "Saved sticker image bytes cannot be overwritten.");
        } else images.set(entry.fileName, bytes);
      } else if (!old.has(entry.fileName)) {
        throw fail(400, "STICKER_IMAGE_INVALID", "New stickers must include their image data.");
      } else {
        const file = await stat(io, imagePath(entry.fileName));
        if (!file?.isFile()) throw fail(404, "STICKER_IMAGE_MISSING", "A saved sticker image is missing; the index was not changed.");
      }
    }
    if (!await stat(io, directory)) await io.mkdir(directory);
    const created = [];
    const temporary = path.join(directory, `.library-${randomUUID()}.tmp`);
    let temporaryCreated = false;
    let committed = false;
    const document = { version: 1, stickers: manifest, migrations: [.../* @__PURE__ */ new Set([...before.migrations, ...migrations])] };
    const text = JSON.stringify(document, null, 2);
    try {
      for (const [fileName, bytes] of images) {
        const target = imagePath(fileName);
        const existing = await stat(io, target);
        if (existing) {
          if (!existing.isFile() || existing.size !== bytes.length || !(await io.readFile(target)).equals(bytes)) throw fail(409, "STICKER_FILE_EXISTS", "An unrelated sticker file already uses this image id.");
          continue;
        }
        const handle2 = await io.open(target, "wx");
        created.push(target);
        try {
          await handle2.writeFile(bytes);
          await handle2.sync();
        } finally {
          await handle2.close();
        }
      }
      const handle = await io.open(temporary, "wx");
      temporaryCreated = true;
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await io.rename(temporary, index);
      committed = true;
    } finally {
      if (!committed && temporaryCreated) await io.unlink(temporary).catch(() => {
      });
      if (!committed) await Promise.all(created.map((file) => io.unlink(file).catch(() => {
      })));
    }
    const kept = new Set(manifest.map((entry) => entry.fileName.toLowerCase()));
    await Promise.all(before.stickers.filter((entry) => !kept.has(entry.fileName.toLowerCase())).map((entry) => io.unlink(imagePath(entry.fileName)).catch(() => {
    })));
    return { ...document, revision: hash(text), location };
  };
  return {
    directory,
    read: () => serial(directory, readState),
    write: (input) => serial(directory, () => write(input)),
    image: (fileName) => serial(directory, async () => {
      const state = await readState();
      const entry = state.stickers.find((record) => record.fileName === fileName);
      if (!entry) throw fail(404, "STICKER_IMAGE_MISSING", "This image is not in the saved sticker library.");
      return { bytes: await image(entry), mimeType: entry.mimeType };
    })
  };
}
async function resolveExtension(request, serverRoot) {
  if (!request.user?.profile || !request.user?.directories) throw fail(403, "STICKER_AUTH_REQUIRED", "Sign in to SillyTavern before using saved stickers.");
  const name = request.query?.extension;
  if (typeof name !== "string" || !name || name.length > 128 || name === "." || name === ".." || /[\\/<>:"|?*\p{Cc}]/u.test(name) || name.endsWith(".") || name.endsWith(" ")) throw fail(400, "STICKER_PATH_FORBIDDEN", "A valid Mochi OS extension folder name is required.");
  const roots = [
    { directory: request.user.directories.extensions, global: false },
    { directory: path.join(serverRoot, "public", "scripts", "extensions", "third-party"), global: true }
  ];
  for (const root of roots) {
    if (typeof root.directory !== "string") continue;
    const candidate = path.join(root.directory, name);
    const entry = await stat(fs, candidate);
    if (!entry) continue;
    if (!entry.isDirectory()) throw fail(400, "STICKER_PATH_FORBIDDEN", "The Mochi extension path is not a folder.");
    const [parent, extension] = await Promise.all([fs.realpath(root.directory), fs.realpath(candidate)]);
    const relative = path.relative(parent, extension);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw fail(403, "STICKER_PATH_FORBIDDEN", "The Mochi extension must be inside a SillyTavern extension directory.");
    let manifest;
    try {
      const file = path.join(extension, "manifest.json");
      if (!(await stat(fs, file))?.isFile()) throw new Error();
      manifest = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      throw fail(400, "STICKER_PATH_FORBIDDEN", "This folder is not an installed Mochi OS extension.");
    }
    if (manifest.display_name !== "Mochi OS" || manifest.js !== "index.js") throw fail(400, "STICKER_PATH_FORBIDDEN", "Sticker storage is restricted to the Mochi OS extension folder.");
    if (root.global && request.method !== "GET" && !request.user.profile.admin) throw fail(403, "STICKER_ADMIN_REQUIRED", "Only SillyTavern admins can change stickers in a globally installed extension. Install Mochi OS for your user to manage a personal library.");
    return extension;
  }
  throw fail(404, "STICKER_EXTENSION_MISSING", "The installed Mochi OS extension folder could not be found.");
}
function registerStickerRoutes(router, { serverRoot = process.cwd() } = {}) {
  const handle = (operation) => async (request, response) => {
    try {
      response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      const extension = await resolveExtension(request, serverRoot);
      const key = directoryKey(extension);
      if (!stores.has(key)) stores.set(key, createDiskStickerStore(extension));
      await operation(stores.get(key), request, response);
    } catch (error) {
      if (!error.status) console.error("Mochi sticker storage:", error);
      response.status(error.status ?? 500).json({
        code: error.status ? error.code : "STICKER_STORAGE_FAILED",
        error: error.status ? error.message : "Mochi could not save or read the extension sticker folder. Check SillyTavern folder permissions and server logs. No browser-storage fallback was used."
      });
    }
  };
  router.get("/library", handle(async (store, _request, response) => response.json(await store.read())));
  router.post("/library", handle(async (store, request, response) => response.json(await store.write(request.body))));
  router.get("/images/:fileName", handle(async (store, request, response) => {
    const image = await store.image(request.params.fileName);
    response.set("Content-Type", image.mimeType).send(image.bytes);
  }));
}
async function init(router) {
  registerStickerRoutes(router);
}
async function exit() {
  await Promise.allSettled([...pending.values()]);
}
export {
  createDiskStickerStore,
  exit,
  info,
  init,
  registerStickerRoutes
};
