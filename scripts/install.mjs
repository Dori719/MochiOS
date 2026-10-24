#!/usr/bin/env node
/**
 * Mirrors the built extension into SillyTavern.
 *
 * SillyTavern only looks for extensions under
 * `public/scripts/extensions/third-party/<folder>`, so the build output has to be
 * copied there. The runtime files and sticker helper are copied every time,
 * so an install can never end up half-present — which is what produces
 * "Extension failed to load: [object Event]".
 *
 *   node scripts/install.mjs                     # every checkout found
 *   node scripts/install.mjs --target D:/ST     # one specific checkout
 *   node scripts/install.mjs --target D:/ST --with-sticker-storage
 *   node scripts/install.mjs --target D:/ST --sticker-storage-only
 *   SILLYTAVERN_DIR=D:/ST node scripts/install.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The folder name SillyTavern serves the extension from. */
const FOLDER = 'mochi-os';

/** Browser runtime files plus the standalone sticker server helper. */
const FILES = ['manifest.json', 'index.js', 'app.js', 'style.css', 'sticker-storage.mjs'];

/** Third-party extension directory inside a SillyTavern checkout. */
const THIRD_PARTY = path.join('public', 'scripts', 'extensions', 'third-party');

/**
 * Checkouts this project knows about.
 *
 * A sibling checkout is found automatically; the second one lives elsewhere in
 * the workspace, so it is named here. `--target` covers anything else.
 */
function candidateRoots() {
  const roots = new Set();
  const explicit = process.env.SILLYTAVERN_DIR;
  if (explicit) roots.add(path.resolve(explicit));

  const workspace = path.resolve(ROOT, '..');
  try {
    for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
      if (entry.isDirectory() && /^SillyTavern/i.test(entry.name)) {
        roots.add(path.join(workspace, entry.name));
      }
    }
  } catch {
    // No workspace folder — `--target` is the only way in.
  }

  roots.add(path.resolve(workspace, '..', 'Silly Project', 'SillyTavern-1.19.0'));
  return [...roots].filter((root) => fs.existsSync(path.join(root, THIRD_PARTY)));
}

/** Fails before copying anything if the build did not produce a whole extension. */
function assertBuilt(files = FILES) {
  const missing = files.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    throw new Error(`Nothing to install — ${missing.join(', ')} missing. Run "npm run build" first.`);
  }
}

/**
 * Updates only our runtime files. In-folder stickers, source checkouts, and
 * unrelated local files must survive an extension update.
 */
function copyRuntime(destination) {
  if (fs.existsSync(destination)) {
    const entries = fs.readdirSync(destination);
    if (entries.length > 0 && !entries.includes('manifest.json')) {
      throw new Error(`${destination} does not look like an extension folder; refusing to replace it`);
    }
    if (entries.includes('manifest.json')) {
      const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
      if (manifest.display_name !== 'Mochi OS' || manifest.js !== 'index.js') {
        throw new Error(`${destination} is not a Mochi OS extension; refusing to overwrite another extension`);
      }
    }
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const file of FILES) {
    const source = path.join(ROOT, file);
    const target = path.join(destination, file);
    if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
  }
}

function extensionFolder(target, requested) {
  if (requested !== undefined) {
    if (!requested || requested === '.' || requested === '..' || /[\\/<>:"|?*\p{Cc}]/u.test(requested) || requested.endsWith('.') || requested.endsWith(' ')) throw new Error('Choose a single extension folder name with --folder.');
    return requested;
  }
  const parent = path.join(target, THIRD_PARTY);
  if (!fs.existsSync(parent)) return FOLDER;
  const matches = fs.readdirSync(parent, { withFileTypes: true }).filter((entry) => {
    if (!entry.isDirectory()) return false;
    try { return JSON.parse(fs.readFileSync(path.join(parent, entry.name, 'manifest.json'), 'utf8')).display_name === 'Mochi OS'; }
    catch { return false; }
  });
  if (matches.length > 1) throw new Error('Several Mochi OS installations exist; choose one with --folder <name>.');
  return matches[0]?.name ?? FOLDER;
}

/** Repairs the backend without replacing browser runtime files or local source work. */
export function installStickerStorage(target) {
  assertBuilt(['sticker-storage.mjs']);
  const plugins = path.join(target, 'plugins');
  const destination = path.join(plugins, 'mochi-os-stickers.mjs');
  fs.mkdirSync(plugins, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'sticker-storage.mjs'), destination);
  return destination;
}

/** Copies runtime files in place; server-plugin installation is explicitly opt-in. */
export function install(target, { folder, withStickerStorage = false } = {}) {
  assertBuilt();
  const destination = path.join(target, THIRD_PARTY, extensionFolder(target, folder));
  copyRuntime(destination);
  if (withStickerStorage) installStickerStorage(target);
  return destination;
}

/**
 * Installs into every checkout it can find.
 *
 * Returns the paths it wrote, so a build can report them without treating a
 * missing checkout as a failure.
 */
export function installIntoAll() {
  const installed = [];
  for (const target of candidateRoots()) {
    try {
      installed.push(install(target));
    } catch (error) {
      console.warn(`Mochi OS was not installed into ${target}: ${error.message}`);
    }
  }
  return installed;
}

function main() {
  const targetIndex = process.argv.indexOf('--target');
  const targets =
    targetIndex !== -1 && process.argv[targetIndex + 1]
      ? [path.resolve(process.argv[targetIndex + 1])]
      : candidateRoots();
  const folderIndex = process.argv.indexOf('--folder');
  const options = { folder: folderIndex === -1 ? undefined : process.argv[folderIndex + 1], withStickerStorage: process.argv.includes('--with-sticker-storage') };
  const stickerStorageOnly = process.argv.includes('--sticker-storage-only');
  if (folderIndex !== -1 && !options.folder) throw new Error('--folder requires an extension folder name.');
  if (stickerStorageOnly && folderIndex !== -1) throw new Error('--sticker-storage-only installs the shared server helper; --folder only applies to browser runtime updates.');

  if (targets.length === 0) {
    console.warn('No SillyTavern checkout found. Pass --target <checkout> to install.');
    return;
  }

  for (const target of targets) {
    try {
      if (stickerStorageOnly) console.log(`Mochi OS sticker plugin -> ${installStickerStorage(target)}`);
      else console.log(`Mochi OS -> ${install(target, options)}`);
      if (stickerStorageOnly || options.withStickerStorage) {
        if (!stickerStorageOnly) console.log(`Mochi OS sticker plugin -> ${path.join(target, 'plugins', 'mochi-os-stickers.mjs')}`);
        console.log('Sticker plugin installed. Set enableServerPlugins: true in this SillyTavern installation\'s active config.yaml and fully restart SillyTavern; the installer does not change configuration or restart the server.');
      } else {
        console.log('Sticker storage requires a separate server plugin. Use --with-sticker-storage, or --sticker-storage-only to preserve browser runtime files; enableServerPlugins alone does not install it.');
      }
    } catch (error) {
      console.error(`Mochi OS could not be installed into ${target}:`, error.message);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
