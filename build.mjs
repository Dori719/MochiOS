#!/usr/bin/env node
/**
 * Bundles Mochi OS into `dist/`, and mirrors it into SillyTavern.
 *
 * SillyTavern loads an extension's `index.js` as one ES module from a static
 * folder: it never runs a package manager there, so everything the interface
 * needs has to be inside the bundle. This script produces that bundle, plus the
 * two static files beside it, and then copies all three into every checkout it
 * can find.
 *
 *   npm run build              # build and install
 *   npm run dev                # rebuild on change, still installed
 *   node build.mjs --no-install
 *
 * The interface is a separate chunk: `index.js` is only the launchers, and the
 * phone (React, the stylesheet, the components) is fetched the first time
 * someone opens it.
 */
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

import { installIntoAll } from './scripts/install.mjs';

const ROOT = import.meta.dirname;
const DIST = path.join(ROOT, 'dist');
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

/** Copies the extension's static files next to the bundle. */
const staticFiles = {
  name: 'mochi-os-static',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      for (const file of ['manifest.json', 'style.css']) {
        fs.copyFileSync(path.join(ROOT, file), path.join(DIST, file));
      }

      if (SKIP_INSTALL) return;
      // A checkout that is not there is normal; a real failure is reported by
      // `npm run install:st`, which treats it as an error.
      for (const destination of installIntoAll()) {
        console.log(`Mochi OS -> ${destination}`);
      }
    });
  },
};

const options = {
  entryPoints: [path.join(ROOT, 'src', 'index.ts')],
  outdir: DIST,
  entryNames: 'index',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: ['chrome120', 'firefox128', 'safari17.4'],
  jsx: 'automatic',
  // Stylesheets are imported as text, because the extension injects and removes
  // them itself instead of letting a bundler append to `<head>` once.
  loader: { '.css': 'text' },
  alias,
  // SillyTavern's own modules are served from its root and must stay imports.
  external: ['/scripts/*'],
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
  plugins: [staticFiles],
};

if (!WATCH) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const context = await esbuild.context(options);

if (WATCH) {
  await context.watch();
  console.log('Watching src/ …');
} else {
  await context.rebuild();
  await context.dispose();
}
