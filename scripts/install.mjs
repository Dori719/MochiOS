/**
 * Install the built extension into a SillyTavern checkout.
 *
 *   node scripts/install.mjs ["D:/path/to/SillyTavern"]
 *
 * SillyTavern resolves third-party extensions from
 * `public/scripts/extensions/third-party/<name>`, so that is where the built
 * files are copied. The default target is the sibling checkout used during
 * development.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const target = process.argv[2] ?? 'D:/Silly Project argon/SillyTavern-1.19.0';
const destination = path.join(target, 'public', 'scripts', 'extensions', 'third-party', 'mochi-os');

/** Files the extension needs at runtime. Everything else is build input. */
const RUNTIME_FILES = ['index.js', 'style.css', 'manifest.json'];

if (!fs.existsSync(path.join(target, 'package.json'))) {
  console.error(`${target} does not look like a SillyTavern checkout (no package.json).`);
  process.exit(1);
}

for (const file of ['index.js', 'style.css']) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`${file} is missing — run "npm run build" first.`);
    process.exit(1);
  }
}

fs.mkdirSync(destination, { recursive: true });
for (const file of RUNTIME_FILES) {
  fs.copyFileSync(path.join(root, file), path.join(destination, file));
}

console.log(`installed ${RUNTIME_FILES.length} files to ${destination}`);