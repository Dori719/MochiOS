/**
 * Build the extension.
 *
 * SillyTavern never installs an extension's dependencies, so React, the YAML
 * parser and the icon set are bundled into `index.js` and committed. The output
 * is an ES module because SillyTavern injects an extension's `js` as
 * `<script type="module">`, which is what lets the extension import SillyTavern's
 * own modules by absolute path.
 *
 * The two `/scripts/*.js` specifiers are the host and stay external. The CSS
 * files load as text: the UI renders inside a Shadow Root, where a
 * document-level stylesheet cannot reach, so the stylesheets are injected into
 * the shadow tree at runtime instead.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

/** The same loaders the extension bundle uses; CSS still arrives as text. */
export const LOADER = { '.css': 'text' };

/** SillyTavern's own modules, resolved by the browser at runtime. */
const ST_MODULES = [
  '/scripts/st-context.js',
  '/scripts/script.js',
  '/scripts/i18n.js',
  '/scripts/slash-commands/SlashCommandParser.js',
  '/scripts/slash-commands/SlashCommand.js',
  '/scripts/slash-commands/SlashCommandArgument.js',
];

const options = {
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(root, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'inline',
  external: ST_MODULES,
  loader: {
    // Stylesheets are injected into the extension's Shadow Root as text.
    '.css': 'text',
  },
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
  },
  logLevel: 'info',
};

async function copyStaticAssets() {
  // Only the launcher button and the shadow host wrapper live in the document;
  // everything inside the panel is styled from within the Shadow Root.
  fs.copyFileSync(path.join(root, 'src', 'st', 'launcher.css'), path.join(root, 'style.css'));
}

if (watch) {
  const context = await esbuild.context(options);
  await copyStaticAssets();
  await context.watch();
  console.log('watching src/ …');
} else {
  await esbuild.build(options);
  await copyStaticAssets();

  const bytes = fs.statSync(path.join(root, 'index.js')).size;
  console.log(`built index.js (${(bytes / 1024).toFixed(0)} kB) and style.css`);
}