/**
 * Development helper: print the CSS rules for a set of selectors out of the
 * ported stylesheets, so the ported class vocabulary can be reused instead of
 * reinvented.
 *
 *   node scripts/css-rules.mjs screen apps app dock tile widget c-body
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/mochi/styles/mochi-os.css',
  'src/mochi/styles/mochi-private-chat-widget.css',
  'src/mochi/styles/mochi-group-chat-widget.css',
];

const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error('usage: node scripts/css-rules.mjs <selector> [...]');
  process.exit(1);
}

for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(text)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector.includes('{')) {
      const hits = wanted.filter((needle) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => part === needle || part.startsWith(`${needle}:`) || part.startsWith(`${needle} `)),
      );
      if (hits.length) {
        console.log(`${path.basename(file)}  ${selector}\n    ${match[2].replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
}