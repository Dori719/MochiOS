/**
 * Runs the verification suite.
 *
 *   node tests/run.mjs
 *
 * The suite is written against the TypeScript sources, so it is bundled first —
 * with the same CSS-as-text loader the extension uses — and executed from the
 * temporary build. That way the tests exercise the code that ships, not a
 * parallel copy of it.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The bundle is written inside the project so Node resolves the project's own
// dependencies (`yaml`) from the generated file, exactly as the sources would.
const outDir = path.join(root, 'node_modules', '.cache', 'mochi-os-tests');
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, 'suite.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'tests', 'run.mjs')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  jsx: 'automatic',
  loader: { '.css': 'text', '.mjs': 'ts' },
  // SillyTavern's modules only exist in the browser, and the `yaml` package is
  // CommonJS, so both stay external: the test bundle then loads them the way
  // Node would, without stubbing anything.
  external: ['/scripts/*', 'yaml'],
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"test"' },
  // `yaml` and `react-dom/server` are CommonJS and require Node built-ins. The
  // banner gives the bundled CommonJS a real `require` instead of esbuild's
  // throwing shim.
  banner: {
    js: [
      "import { createRequire as __mochiCreateRequire } from 'node:module';",
      "import { fileURLToPath as __mochiFileURLToPath } from 'node:url';",
      "import { dirname as __mochiDirname } from 'node:path';",
      'const require = __mochiCreateRequire(import.meta.url);',
      'const __filename = __mochiFileURLToPath(import.meta.url);',
      'const __dirname = __mochiDirname(__filename);',
    ].join('\n'),
  },
});

await import(pathToFileURL(outfile).href);