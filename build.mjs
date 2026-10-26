#!/usr/bin/env node
/**
 * Bundles Mochi OS, and mirrors it into SillyTavern.
 *
 * The output is the extension itself, written next to this file:
 *
 *   manifest.json   what SillyTavern reads first
 *   index.js        the entry point it loads — self-contained
 *   app.js          the phone, fetched on demand by index.js
 *   style.css       the launcher's styles
 *   sticker-storage.mjs  optional SillyTavern server plugin for disk stickers
 *
 * There is deliberately no `chunks/` folder and no `dist/` hop. SillyTavern
 * loads one module and lets the browser resolve whatever that module imports; a
 * file that is missing from the folder therefore breaks the extension with a
 * message that says nothing ("failed to load: [object Event]", because a browser
 * reports it as an Event). `index.js` importing nothing but itself means a
 * partial copy can only ever degrade the phone, which reports it properly.
 *
 *   npm run build              # build and install
 *   npm run dev                # rebuild on change, still installed
 *   node build.mjs --no-install
 */
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

import { installIntoAll } from './scripts/install.mjs';

const ROOT = import.meta.dirname;
const WATCH = process.argv.includes('--watch');
const SKIP_INSTALL = process.argv.includes('--no-install');

/**
 * Packages the ported components were written against that SillyTavern does not
 * have, plus the engine's own shared package, which is served from `src/shared`
 * instead of from a monorepo.
 */
const alias = {
  '@marinara-engine/shared': path.join(ROOT, 'src', 'shared', 'index.ts'),
  clsx: path.join(ROOT, 'src', 'compat', 'clsx.ts'),
  'tailwind-merge': path.join(ROOT, 'src', 'compat', 'tailwind-merge.ts'),
  i18next: path.join(ROOT, 'src', 'compat', 'i18next.ts'),
  'react-i18next': path.join(ROOT, 'src', 'compat', 'react-i18next.ts'),
  sonner: path.join(ROOT, 'src', 'compat', 'sonner.ts'),
};

/** CSS is embedded as text; normalize checkout line endings so a Windows build
 * does not rewrite every bundled stylesheet merely because Git uses CRLF. */
const normalizedCss = {
  name: 'mochi-css-text',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, ({ path }) => ({
      contents: fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
      loader: 'text',
      watchFiles: [path],
    }));
  },
};

/** Shared by both bundles. No code splitting: one file each, nothing to lose. */
const shared = {
  bundle: true,
  format: 'esm',
  splitting: false,
  platform: 'browser',
  target: ['chrome120', 'firefox128', 'safari17.4'],
  jsx: 'automatic',
  // Stylesheets are imported as text, because the extension injects them itself.
  loader: { '.css': 'text' },
  plugins: [normalizedCss],
  alias,
  // SillyTavern's own module is served from its root and must stay an import.
  external: ['/scripts/*', '/script.js'],
  minify: !WATCH,
  sourcemap: WATCH ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  logOverride: {
    // The ported components still carry the engine's `import "./mochi-os.css"`.
    // The stylesheet is read as text by `st/styles.ts` instead, so the bare
    // import is dead — and it stays in the file, untouched, on purpose.
    'ignored-bare-import': 'silent',
  },
};

/**
 * Leaves `import('./app.js')` alone.
 *
 * `app.js` is the other bundle's output, so it does not exist while this one is
 * being built; it is resolved by the browser, next to `index.js`, at runtime.
 */
const appIsExternal = {
  name: 'mochi-os-app-external',
  setup(build) {
    build.onResolve({ filter: /^\.\/app\.js$/ }, () => ({ path: './app.js', external: true }));
  },
};

/** The phone. Big, and only worth loading when it will be shown. */
const appOptions = {
  ...shared,
  entryPoints: [path.join(ROOT, 'src', 'app.ts')],
  outfile: path.join(ROOT, 'app.js'),
};

/** The entry point. Must stay a single self-contained file. */
const entryOptions = {
  ...shared,
  entryPoints: [path.join(ROOT, 'src', 'index.ts')],
  outfile: path.join(ROOT, 'index.js'),
  plugins: [normalizedCss, appIsExternal],
};

/** One dependency-free Node module, also included for manual/plugin installs. */
const stickerOptions = {
  entryPoints: [path.join(ROOT, 'server', 'sticker-storage.mjs')],
  outfile: path.join(ROOT, 'sticker-storage.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'info',
};

/**
 * Refuses to ship an entry point that depends on another file.
 *
 * A future change could reintroduce code splitting without anyone noticing until
 * an install goes wrong, so the build checks the thing that actually matters.
 */
function assertEntryIsSelfContained() {
  const source = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const imported = source.match(/\bfrom\s*["']\.\/[^"']+["']|\bimport\(\s*["']\.\/[^"']+["']\s*\)/g) ?? [];
  const parts = imported.filter((specifier) => !/["']\.\/app\.js["']/.test(specifier));
  if (parts.length > 0) {
    throw new Error(
      `index.js must not import other files, but it imports ${parts.join(', ')}. ` +
        'Keep the entry bundle free of code splitting.',
    );
  }
}

async function buildOnce() {
  await Promise.all([esbuild.build(appOptions), esbuild.build(entryOptions), esbuild.build(stickerOptions)]);
  assertEntryIsSelfContained();
}

async function buildWatched() {
  const contexts = await Promise.all([esbuild.context(appOptions), esbuild.context(entryOptions), esbuild.context(stickerOptions)]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching src/ …');
}

/** The old layout's output, which must not linger next to the new one. */
fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });

await (WATCH ? buildWatched() : buildOnce());

if (!WATCH && !SKIP_INSTALL) {
  // A checkout that is not there is normal; a real failure is reported by
  // `npm run install:st`, which treats it as an error.
  for (const destination of installIntoAll()) {
    console.log(`Mochi OS -> ${destination}`);
  }
}
