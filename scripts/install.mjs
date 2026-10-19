#!/usr/bin/env node
/**
 * Mirrors the built extension into SillyTavern.
 *
 * SillyTavern only looks for extensions under
 * `public/scripts/extensions/third-party/<folder>`, so the build output has to be
 * copied there. The extension is four files, and all four are copied every time,
 * so an install can never end up half-present — which is what produces
 * "Extension failed to load: [object Event]".
 *
 *   node scripts/install.mjs                     # every checkout found
 *   node scripts/install.mjs --target D:/ST     # one specific checkout
 *   SILLYTAVERN_DIR=D:/ST node scripts/install.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The folder name SillyTavern serves the extension from. */
const FOLDER = 'mochi-os';

/** Everything SillyTavern needs, named in `manifest.json`. */
const FILES = ['manifest.json', 'index.js', 'app.js', 'style.css'];

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
function assertBuilt() {
  const missing = FILES.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    throw new Error(`Nothing to install — ${missing.join(', ')} missing. Run "npm run build" first.`);
  }
}

/**
 * Replaces what is in `destination`.
 *
 * The previous version of this extension may be there, and it has to go — a
 * leftover `chunks/` from an older build would be served alongside the new files.
 * Only a folder that is empty or holds an extension manifest is removed.
 */
function replace(destination) {
  if (fs.existsSync(destination)) {
    const entries = fs.readdirSync(destination);
    if (entries.length > 0 && !entries.includes('manifest.json')) {
      throw new Error(`${destination} does not look like an extension folder; refusing to replace it`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const file of FILES) {
    fs.copyFileSync(path.join(ROOT, file), path.join(destination, file));
  }
}

/** Copies the four files into one SillyTavern checkout. Returns the path written. */
export function install(target) {
  assertBuilt();
  const destination = path.join(target, THIRD_PARTY, FOLDER);
  replace(destination);
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

  if (targets.length === 0) {
    console.warn('No SillyTavern checkout found. Pass --target <checkout> to install.');
    return;
  }

  for (const target of targets) {
    try {
      console.log(`Mochi OS -> ${install(target)}`);
    } catch (error) {
      console.error(`Mochi OS could not be installed into ${target}:`, error.message);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
