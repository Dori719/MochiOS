/**
 * One-shot import rewriter for the ported Mochi OS widget modules.
 *
 * The widget layer was copied out of the engine, where every relative path and
 * every shared-package import pointed somewhere that does not exist inside a
 * SillyTavern extension. This rewrites those imports in place. Run with:
 *   node scripts/patch-imports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src', 'mochi');

/** @type {Record<string, [string, string][]>} */
const REWRITES = {
  'constants.ts': [['from "./mochi-os.types"', 'from "./types"']],
  'utils.ts': [['from "./mochi-os.types"', 'from "./types"']],
  'app-icons.tsx': [['from "./mochi-os.apps"', 'from "./apps"']],
  'use-theme-mode.ts': [
    ['from "@marinara-engine/shared"', 'from "./schema"'],
    ['from "./mochi-os.color"', 'from "./color"'],
  ],
  'ColorPicker.tsx': [
    ['from "react-i18next"', 'from "../compat/i18n"'],
    ['from "./mochi-os.color"', 'from "./color"'],
  ],
  'PrivateChatWidget.tsx': [
    ['import "./mochi-os.css";', 'import "./styles/mochi-os.css";'],
    ['import "./mochi-private-chat-widget.css";', 'import "./styles/mochi-private-chat-widget.css";'],
    ['from "react-i18next"', 'from "../compat/i18n"'],
    ['from "../../../hooks/use-mochi-os-settings"', 'from "../core/settings"'],
    ['from "../../../hooks/use-conversation-custom-stickers"', 'from "../core/settings"'],
    ['from "../../../hooks/use-mochios-data"', 'from "../core/phone-data"'],
    ['from "../../../stores/chat.store"', 'from "../core/store"'],
    ['from "./mochi-character-color"', 'from "./character-color"'],
    ['from "@marinara-engine/shared"', 'from "./schema"'],
    ['from "./mochi-os.utils"', 'from "./utils"'],
    ['from "./mochi-os.color"', 'from "./color"'],
    ['from "./use-mochi-theme-mode"', 'from "./use-theme-mode"'],
    ['from "./mochi-os.css"', 'from "./styles/mochi-os.css"'],
    ['from "./mochi-private-chat-widget.css"', 'from "./styles/mochi-private-chat-widget.css"'],
  ],
  'GroupChatWidget.tsx': [
    ['import "./mochi-os.css";', 'import "./styles/mochi-os.css";'],
    ['import "./mochi-private-chat-widget.css";', 'import "./styles/mochi-private-chat-widget.css";'],
    ['import "./mochi-group-chat-widget.css";', 'import "./styles/mochi-group-chat-widget.css";'],
    ['from "react-i18next"', 'from "../compat/i18n"'],
    ['from "../../../hooks/use-mochi-os-settings"', 'from "../core/settings"'],
    ['from "../../../hooks/use-conversation-custom-stickers"', 'from "../core/settings"'],
    ['from "./mochi-character-color"', 'from "./character-color"'],
    ['from "@marinara-engine/shared"', 'from "./schema"'],
    ['from "./mochi-os.utils"', 'from "./utils"'],
    ['from "./mochi-os.color"', 'from "./color"'],
    ['from "./use-mochi-theme-mode"', 'from "./use-theme-mode"'],
    ['from "./mochi-os.css"', 'from "./styles/mochi-os.css"'],
    ['from "./mochi-private-chat-widget.css"', 'from "./styles/mochi-private-chat-widget.css"'],
    ['from "./mochi-group-chat-widget.css"', 'from "./styles/mochi-group-chat-widget.css"'],
  ],
};

/** Modules this port supplies itself, so their specifiers are rewritten too. */
const HEADER_REWRITES = {
  'types.ts': [
    [
      'import type { MessageReaction } from "@marinara-engine/shared";',
      `/**
 * Widget view-model types, ported verbatim from the engine's
 * \`components/chat/mochi-os/mochi-os.types.ts\`.
 *
 * The engine's \`MessageReaction\` lives in \`@marinara-engine/shared\`.
 * SillyTavern has no reactions model, so the extension carries its own
 * identical shape.
 */
export interface MessageReaction {
  emoji: string;
  count: number;
  reactors?: string[];
  [key: string]: any;
}`,
    ],
    ['from "@marinara-engine/shared";', 'from "./schema";'],
  ],
};

let changed = 0;
for (const [file, pairs] of Object.entries(REWRITES)) {
  const filePath = path.join(dir, file);
  let text = fs.readFileSync(filePath, 'utf8');
  const before = text;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) {
      console.warn(`  ! ${file}: pattern not found -> ${from}`);
      continue;
    }
    text = text.split(from).join(to);
  }
  if (text !== before) {
    fs.writeFileSync(filePath, text);
    changed++;
  }
}

for (const [file, pairs] of Object.entries(HEADER_REWRITES)) {
  const filePath = path.join(dir, file);
  let text = fs.readFileSync(filePath, 'utf8');
  const before = text;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) {
      console.warn(`  ! ${file}: header pattern not found -> ${from.slice(0, 60)}`);
      continue;
    }
    text = text.replace(from, to);
  }
  if (text !== before) {
    fs.writeFileSync(filePath, text);
    changed++;
  }
}

// No ported module may still reach into the engine's package graph.
const leftovers = [];
for (const file of fs.readdirSync(dir)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const hits = text.match(/@marinara-engine\/shared|\.\.\/\.\.\/\.\.\/|react-i18next|mochi-os\.(types|utils|apps|color)\b/g);
  if (hits) leftovers.push(`${file}: ${[...new Set(hits)].join(', ')}`);
}

console.log(`patched ${changed} files`);
if (leftovers.length) {
  console.error('unresolved engine imports:\n  ' + leftovers.join('\n  '));
  process.exit(1);
}
console.log('no engine imports remain');