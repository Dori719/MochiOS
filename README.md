# Mochi OS for SillyTavern

Mochi OS is a phone simulator: for any roleplay chat, a model generates a phone
with contacts, group chats and apps, and threads those conversations turn by
turn. This repository is that subsystem, running inside SillyTavern as a
third-party extension.

Ported from the Marinara Engine / Dori-Engine project
(`D:\OpenCodeProjects\Dori-Engine`), which is AGPL-3.0. This port keeps the same
licence.

## Install

Build, then copy the three runtime files into
`public/scripts/extensions/third-party/mochi-os/` of your SillyTavern checkout:

```bash
npm install
npm run build
node scripts/install.mjs "D:/path/to/SillyTavern"
```

Restart SillyTavern. A handset button appears in the bottom-right of the page;
click it, or type `/mochios`, to open the phone for the current chat.

## How it maps onto SillyTavern

| In the engine | Here |
| --- | --- |
| `POST /api/mochios-data/:chatId/generate` (Fastify + provider registry) | `generateRaw` on the active connection |
| `phone_data` YAML files under `data/mochios_data/` | `chat_metadata.mochios.phoneDataYaml` |
| Thread turns archived as roleplay chat messages | `chat_metadata.mochios.threads[]` |
| `/api/app-settings/mochi-os-settings` | `extension_settings.mochios_os.settings` |
| Engine connection picker | SillyTavern's active connection |
| React Query + zustand stores | a single store in `src/core/store.ts` |
| Engine `FloatingWindow` / `WindowBubble` | a draggable panel in `src/st/host.ts` |
| `MochiOsView` (8.9k lines) | `src/ui/*`, using the ported thread renderers as-is |

Storage follows the host: `chat_metadata` is written into the first line of the
chat's JSONL, so a phone travels with chat export, import and branching.

## What was ported verbatim

These came across unchanged, because they hold the behaviour rather than the
engine's wiring:

- `src/mochi/constants.ts` — prompt preset, marker vocabulary, format guides
- `src/mochi/utils.ts` — every YAML parser, serializer and bubble helper
- `src/mochi/PrivateChatWidget.tsx`, `GroupChatWidget.tsx` — the thread renderers
- `src/mochi/styles/*.css` — the design system
- `src/core/records.ts` — from the engine's Fastify route, moved to the browser

## Notable differences

- **Macro braces.** SillyTavern substitutes its macros over every message it
  sends, and `{{user}}` is one of them, while the archive format depends on
  `{{user}}: true` staying literal. `core/generate.ts` escapes the opening brace
  on the way out and restores it on the way back.
- **Retention.** The whole archive is replayed into every prompt, so a thread
  keeps at most 40 archived turns (`phone-data.ts`).
- **Apps that needed the engine's backend** — maps, live, music, feed, forum,
  camera, journal, tools, files — remain as named tiles that say why they are
  empty. Everything else works.
- **`imgdesc`, stickers and voice notes** render as their text form: SillyTavern
  has no image generation or sticker library to resolve them against.
- **The engine's `chat_summary` and `agent_data` preset markers** are skipped.
  They carried output from the engine's agent pipeline, which a browser
  extension cannot run.

## Layout

```
manifest.json         extension manifest
build.mjs             esbuild bundle (React + YAML + icons inlined)
src/index.ts          activation, slash command, chat-change handling
src/st/adapter.ts     the only module that talks to SillyTavern
src/st/host.ts        launcher button, draggable panel, Shadow Root
src/core/             store, storage, prompt assembly, generation, records
src/mochi/            ported widget layer (constants, utils, renderers, CSS)
src/ui/               the phone shell built around the ported renderers
src/compat/           i18n shim for the ported components
scripts/              patch-imports, generate-i18n, install, css-rules
tests/                the verification suite (`npm test`)
```

`src/components/`, `src/hooks/`, `src/lib/` and `src/shims/` are the engine-side
sources the port was taken from. They are reference material — nothing that
ships imports them, they still reach for engine-only modules, and they are
outside `npm run typecheck`. `src/mochi/` is their shipped replacement.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | bundle to `index.js` + `style.css` |
| `npm run watch` | rebuild on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | run the verification suite |
| `npm run install-extension` | copy the build into a SillyTavern checkout |
| `npm run i18n` | regenerate `src/compat/i18n-dict.ts` from the engine locale |