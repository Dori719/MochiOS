# Mochi OS for SillyTavern

Mochi OS is the phone interface from [Dori Engine](../../OpenCodeProjects/Dori-Engine)
— a desktop of apps, a clock and weather widget, Private Chat, Forum, Feed,
Maps, Music, Photos, a Log, Settings, and a home indicator you can drag down to
leave. This is that interface, running inside SillyTavern as a native extension.

It is a hand port, not a lookalike: the interface's own components and
stylesheets are the engine's files, byte for byte. What is written here is the
part the engine had and SillyTavern does not — the storage, the network, the
generation, and the small bits of chat chrome Mochi OS borrowed from the engine's
app shell.

## What you get

- **The whole phone.** Home screen, every app, the settings sheets, the AI data
  editor, the drag-to-dismiss home indicator.
- **Transcripts inside messages.** A roleplay turn that carries a Mochi record
  (`<privatechat_history …>`, `<groupchat_history …>` and their `<environment>`
  block) renders as a real chat widget inside the message, with the prose around
  it untouched.
- **The same data, in SillyTavern's terms.** The phone document lives in the
  chat's metadata, so it travels with export, import and branching. Transcript
  turns stay in the ordinary roleplay messages — no parallel store to keep in
  step.

## Opening it

Three ways, all of them first-class:

| Where | How |
| --- | --- |
| Floating bubble | The phone button at the bottom right of the chat. |
| Wand menu | Extensions (wand) → **Mochi OS**. |
| Quick Reply | A **Mochi OS** set with one `/mochi` button is created on first run. Turn Quick Replies on and it appears in the bar; delete it and it stays deleted. |
| Slash command | `/mochi`, also `/mochios`. |

Escape closes it, as does dragging the home indicator down or clicking **Return
to Roleplay**.

## Installing

The extension is a static folder. SillyTavern never runs a package manager, so
the build output is committed.

```powershell
npm install          # once, to build
npm run build        # bundles, then copies into every SillyTavern it finds
```

`npm run build` looks for `SillyTavern*` next to this folder, and installs into
`public/scripts/extensions/third-party/mochi-os`. Point it somewhere else with:

```powershell
node scripts/install.mjs --target "D:\path\to\SillyTavern"
```

Then reload SillyTavern. The extension shows up under **Extensions** as
*Mochi OS*; it needs no configuration to appear.

## How it maps onto SillyTavern

The engine owned a database, a request pipeline and a model connection.
SillyTavern owns all three, so each one is answered from what SillyTavern already
has:

| Engine | Here |
| --- | --- |
| `GET /chats/:id/messages` and friends | The open chat, read through `getContext().chat`. |
| Engine message ids | Minted once into `message.extra.mochiosId`, so the UI can hold an id across a generation. |
| `data_generation` YAML file | `chat_metadata.mochios.phoneDataYaml`, saved with the chat. |
| Transcript turns | The roleplay messages themselves. |
| Model provider | `generateRaw`, with `{{` escaped so SillyTavern's macros leave it alone. |
| Translation endpoint | SillyTavern's own `/api/backends/translate`. |
| Engine dialogs | SillyTavern's `callGenericPopup`. |
| Engine toasts | `toastr`. |
| Capability packages | Reported as none installed; Mochi OS only asks whether there are any. |

The `@marinara-engine/shared` package is not available outside the engine, so
`src/shared/` stands in for it: the engine's pure helpers (verbatim) plus the
types the interface reads. `src/compat/` does the same for `clsx`,
`tailwind-merge`, `i18next`, `react-i18next` and `sonner`.

## Layout

```
src/
  index.ts                  the launchers, the event bridge, /mochi
  st/                       everything SillyTavern-specific
    adapter.ts              the one place that touches getContext()
    api.ts                  the engine's REST surface, answered from SillyTavern
    mochi-data.ts           phone document storage, transcript generation
    generate.ts             generateRaw, and the {{ escape
    host.tsx                the overlay Mochi OS is mounted into
    inline.tsx              the transcript widgets inside messages
    styles.ts               the stylesheets, in the engine's order
  components/chat/mochi-os/ the engine's interface — MochiOsView and everything it draws
  components/chat/          the four pieces of the engine's app shell Mochi OS borrows
  hooks/, stores/, lib/, shared/, types/, compat/
  styles/port-chrome.css    the chrome the port had to write, plus utility generation output
dist/                       built; this is what SillyTavern loads
```

`src/components/chat/mochi-os/MochiOsView.tsx` and `mochi-os.css` are the engine's
files and are edited by nobody. If a change is needed there, it belongs in the
engine first.

## Working on it

```powershell
npm run typecheck    # tsc across the whole port
npm run dev          # rebuild on save, and keep the installed copy current
npm run build        # one build, installed
npm run install:st   # copy dist/ without rebuilding
npm run tailwind     # regenerate the utility sheet (see below)
```

### The one generated stylesheet

Mochi OS was written against Tailwind, and a handful of its class names are
Tailwind utilities that `mochi-os.css` does not define — including
`w-full h-full relative overflow-clip` on the root element, which is what gives
the phone its size. SillyTavern has no Tailwind, so
`src/styles/tailwind.generated.css` carries exactly those utilities, harvested
from the class names the ported components actually name and compiled by
Tailwind itself.

It is committed, so an ordinary build never needs Tailwind. Regenerate it only
after changing what the ported components render:

```powershell
node scripts/gen-tailwind.mjs
```

That script needs the Tailwind that ships with the engine's client package; point
`TAILWIND_DIR` at any `tailwindcss` package if the path in the script does not
match your checkout.

## Credits

Mochi OS, its design and its stylesheets come from Dori Engine. This repository is
only the SillyTavern binding.
