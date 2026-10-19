#!/usr/bin/env node
/**
 * Generates `src/styles/tailwind.generated.css`.
 *
 * Mochi OS was written against Tailwind, and a few of its class names are
 * Tailwind utilities that the engine's own stylesheet (`mochi-os.css`) does not
 * cover — `w-full h-full relative overflow-clip` on the Mochi OS root, the
 * translation box under a bubble, and two hover accents. SillyTavern has no
 * Tailwind, so those utilities have to be shipped.
 *
 * This script produces exactly the utilities the port uses, and nothing else:
 *
 *   1. every class name the ported components name is collected — from
 *      `className="…"`, `className={…}`, `className: "…"`, and from the arrays
 *      and template literals those reference;
 *   2. Tailwind's own compiler is asked for those candidates, and silently
 *      ignores the ones that are not utilities;
 *   3. the result is unwrapped from Tailwind's `@layer`s and its theme is
 *      scoped to `.mochi-scope`, so nothing reaches SillyTavern's own markup.
 *      SillyTavern's unlayered CSS beat these utilities in the engine too,
 *      because Tailwind emits utilities inside a cascade layer.
 *
 * Run it after changing what the ported components render:
 *
 *   node scripts/gen-tailwind.mjs
 *
 * It needs the Tailwind that already ships with the engine's client package.
 * The generated file is committed, so an ordinary build never runs this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(SRC, 'styles', 'tailwind.generated.css');

/* ── Locate Tailwind ─────────────────────────────────────────────────────── */

const TAILWIND_CANDIDATES = [
  process.env.TAILWIND_DIR,
  'D:/OpenCodeProjects/Dori-Engine/packages/client/node_modules/tailwindcss',
  path.join(ROOT, 'node_modules', 'tailwindcss'),
].filter(Boolean);

const tailwindDir = TAILWIND_CANDIDATES.find((dir) =>
  fs.existsSync(path.join(dir, 'dist', 'lib.mjs')),
);

if (!tailwindDir) {
  console.error(
    'Tailwind was not found. Install it, or point TAILWIND_DIR at a tailwindcss package.',
  );
  process.exit(1);
}

/* ── The candidate class names ───────────────────────────────────────────── */

const CLASS_TOKEN = /^[A-Za-z0-9!()[\].,%/:_#&*-]+$/;

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Index just past the string or template literal that starts at `i`. */
function skipString(text, i) {
  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Index of the `}` that closes the `{` at `start`.
 *
 * Strings are stepped over as units, because a brace inside one would otherwise
 * be counted: `className={cond ? "{" : "}"}` would end the block early and let
 * the scan run on into unrelated code.
 */
function closeBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) return text.length;
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** Index of the `;` that ends the statement starting at `from`, skipping nesting. */
function statementEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i) - 1;
      continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ';' && depth === 0) return i;
  }
  return text.length;
}

/** Drops comments, so a class named in prose is not mistaken for one in use. */
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Every string literal in `text`, including literals nested one level deeper. */
function literalsIn(text) {
  const out = [];
  for (const match of text.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []) {
    out.push(match.slice(1, -1));
    for (const nested of match.match(/"[^"\n]*"|'[^'\n]*'/g) ?? []) {
      out.push(nested.slice(1, -1));
    }
  }
  return out;
}

/**
 * Class names are read only from the places a component names them: reading
 * every string in the tree instead would hand Tailwind ordinary words, and a
 * state named `hidden` would emit `.hidden { display: none }` — a class
 * SillyTavern's own markup uses.
 */
/** 1-based line number of `offset` in the file at `file`. */
const lineCache = new Map();
function lineOf(file, offset) {
  let text = lineCache.get(file);
  if (text === undefined) {
    text = fs.readFileSync(file, 'utf8');
    lineCache.set(file, text);
  }
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function collectCandidates() {
  const candidates = new Map();

  const add = (file, text, offset) => {
    for (const literal of literalsIn(stripComments(text))) {
      for (const token of literal.split(/[\s${}]+/)) {
        if (!token || token.length > 80) continue;
        if (!CLASS_TOKEN.test(token)) continue;
        if (!candidates.has(token)) candidates.set(token, new Set());
        candidates.get(token).add(`${path.relative(SRC, file).split(path.sep).join('/')}:${lineOf(file, offset)}`);
      }
    }
  };

  for (const file of listSourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /\bclassName\s*[:=]\s*/g;
    let match;

    while ((match = re.exec(text))) {
      const start = match.index + match[0].length;
      const ch = text[start];

      if (ch === '{') {
        const end = closeBrace(text, start);
        const block = text.slice(start + 1, end);
        add(file, block, start + 1);

        // `className={someIdentifier}` — follow it to its declaration.
        const identifier = block.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(identifier)) {
          const declaration = new RegExp(`\\b(?:const|let|var)\\s+${identifier}\\s*=\\s*`, 'g');
          const found = declaration.exec(text);
          if (found) {
            const from = found.index + found[0].length;
            add(file, text.slice(from, statementEnd(text, from)), from);
          }
        }
        re.lastIndex = end + 1;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        const end = skipString(text, start);
        add(file, text.slice(start, end), start);
        re.lastIndex = end;
      }
    }
  }

  if (process.env.TRACE) {
    const wanted = new Set(process.env.TRACE.split(','));
    for (const [token, files] of candidates) {
      if (!wanted.has(token)) continue;
      console.log(
        `  ${token} <- ${[...files]
          .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
          .join(', ')}`,
      );
    }
  }

  return [...candidates.keys()];
}

/* ── Ask Tailwind for them ───────────────────────────────────────────────── */

const { compile } = await import(
  pathToFileURL(path.join(tailwindDir, 'dist', 'lib.mjs')).href
);

const loadStylesheet = async (id, base) => {
  const read = (file) => ({
    path: file,
    base: path.dirname(file),
    content: fs.readFileSync(file, 'utf8'),
  });
  if (id === 'tailwindcss') return read(path.join(tailwindDir, 'index.css'));
  if (id.startsWith('tailwindcss/')) {
    return read(path.join(tailwindDir, id.slice('tailwindcss/'.length)));
  }
  const resolved = path.resolve(base, id);
  for (const candidate of [resolved, `${resolved}.css`, path.join(resolved, 'index.css')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return read(candidate);
  }
  throw new Error(`Cannot resolve stylesheet ${id} from ${base}`);
};

// Only the theme and the utilities. Tailwind's preflight is left out on purpose:
// it resets every element, which would restyle SillyTavern's whole interface.
const compiler = await compile(
  [
    '@layer theme, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
  ].join('\n'),
  {
    base: tailwindDir,
    onDependency() {},
    loadStylesheet,
    loadModule() {
      throw new Error('This stylesheet uses no plugins.');
    },
  },
);

const candidates = collectCandidates();
const raw = compiler.build(candidates);

/* ── Flatten it ──────────────────────────────────────────────────────────── */

/** Body of the block whose `{` is at `openBraceIndex`, and the index after its `}`. */
function readBlock(css, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: css.slice(openBraceIndex + 1, i), end: i + 1 };
    }
  }
  throw new Error('Unbalanced block');
}

/** Splits a selector list on the commas that are not inside `[]` or `()`. */
function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Confines every rule to the Mochi OS scope.
 *
 * Each selector is emitted twice — `.mochi-scope .w-full` for descendants and
 * `.mochi-scope.w-full` for the Mochi OS root itself, which carries the layout
 * utilities. Both are needed, and both sit in front of the engine's own
 * stylesheet in the bundle, so `mochi-os.css` still wins where the two overlap,
 * exactly as it did in the engine (Tailwind emits its utilities inside a
 * cascade layer, and the engine's stylesheet was unlayered).
 */
function scopeSelectors(css) {
  let out = '';
  let index = 0;

  while (index < css.length) {
    const brace = css.indexOf('{', index);
    if (brace === -1) {
      out += css.slice(index);
      break;
    }

    const prelude = css.slice(index, brace);
    const { body, end } = readBlock(css, brace);
    const atRule = prelude.trim().match(/^@([\w-]+)/)?.[1];

    if (atRule === 'media' || atRule === 'supports' || atRule === 'container') {
      out += `${prelude}{${scopeSelectors(body)}}`;
    } else if (atRule) {
      // `@property` and friends declare no selectors.
      out += `${prelude}{${body}}`;
    } else {
      const scoped = splitSelectors(prelude)
        .map((selector) => {
          if (selector === '.mochi-scope') return selector;
          const inner = `.mochi-scope ${selector}`;
          const self = selector.startsWith('.') ? `.mochi-scope${selector}` : null;
          return self ? `${inner}, ${self}` : inner;
        })
        .join(', ');
      out += `${scoped}{${body}}`;
    }

    index = end;
  }

  return out;
}

function flatten(css) {
  // The licence banner is re-attached by the caller.
  let out = css.replace(/\/\*![\s\S]*?\*\//, '');

  // `@layer a, b;` only declares an order, which no longer applies once unwrapped.
  out = out.replace(/@layer\s+[^{;]+;/g, '');

  // Tailwind's compatibility fallback declares the `--tw-*` properties on every
  // element for browsers without `@property`. Those names are Tailwind's own and
  // `@property` is supported everywhere SillyTavern runs, so the fallback is
  // dropped rather than injected into SillyTavern's global `*` selector.
  const fallback = out.indexOf('@layer properties {');
  if (fallback !== -1) {
    out = out.slice(0, fallback) + out.slice(readBlock(out, out.indexOf('{', fallback)).end);
  }

  // Unwrap what is left, so SillyTavern's unlayered stylesheets do not outrank it.
  for (;;) {
    const match = /@layer\s+[^{;]+\{/.exec(out);
    if (!match) break;
    const { body, end } = readBlock(out, match.index + match[0].length - 1);
    out = out.slice(0, match.index) + body + out.slice(end);
  }

  // The theme's custom properties are only needed inside the Mochi OS scope.
  out = out.replace(/:root\s*,\s*:host/g, '.mochi-scope').replace(/:root\b/g, '.mochi-scope');

  return scopeSelectors(out).replace(/\n{3,}/g, '\n\n').trim();
}

const flattened = flatten(raw);

const header = `/* ════════════════════════════════════════════════════════════════════════
   Tailwind utilities used by the Mochi OS port — GENERATED, do not edit.

   Regenerate with \`node scripts/gen-tailwind.mjs\` after changing what the
   ported components render. See that script for why this file exists.
   ════════════════════════════════════════════════════════════════════════ */

`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${header}${flattened}\n`);

console.log(`candidates : ${candidates.length}`);
console.log(`written    : ${path.relative(ROOT, OUT).split(path.sep).join('/')} (${flattened.length} bytes)`);
