# Mochi OS for SillyTavern

Mochi OS is the phone interface from [Dori Engine](../../OpenCodeProjects/Dori-Engine)
— a desktop of apps, a clock and weather widget, Private Chat, Forum, Feed,
Maps, Music, Photos, a Log, and Settings. Floating close and move buttons control
the popup. This interface runs inside SillyTavern as a native extension.

It is a hand port, not a lookalike: the interface's own components and
stylesheets come from the engine, adapted for SillyTavern. What is written here is the
part the engine had and SillyTavern does not — the storage, the network, the
generation, and the small bits of chat chrome Mochi OS borrowed from the engine's
app shell.

## What you get

- **The whole phone.** Home screen, every app, the settings sheets, the AI data
  editor, and translucent close and move controls.
- **API selection.** Settings → **API** offers the current SillyTavern connection
  or a supported saved Connection Manager profile. This selection applies to data
  generation, private replies, and group replies without changing the host's API.
- **Roleplay persona.** The phone initially follows the selected SillyTavern
  persona. The picker shows **Name (persona title)**; a manual phone choice is
  remembered for this chat only.
- **Transcripts inside messages.** A roleplay turn that carries a Mochi record
  (`<privatechat_history …>`, `<groupchat_history …>` and their `<environment>`
  block) renders as a real chat widget inside the message, with the prose around
  it untouched.
- **One response, one roleplay turn.** Each complete private or group phone
  response is saved as one SillyTavern message. Group senders remain attributed
  inside its YAML, and regeneration uses that message's native swipes.
- **Bubble actions.** Click or tap a bubble to reveal left-aligned actions below
  it, with the timestamp in its original position and swipe controls on their own row underneath; hovering does not reveal
  them. The original compact avatar/bubble layout is retained, with no extra
  author rail. Long-press with mouse or touch to Reply. Reserved control rows
  prevent bubbles from shifting. Translate is not offered.
- **Live history.** Deleting roleplay turns immediately restores each phone
  thread's latest surviving messages and preview, including empty threads.
  Generated replies save only the relevant transcript and environment; model
  reasoning, unrelated tags, surrounding explanations and fences are discarded.
- **Emoji and global stickers.** More → Emoji opens the emoji/sticker picker.
  Import images once and use them in any Mochi chat in the same browser/origin.
- **The same data, in SillyTavern's terms.** The phone document lives in the
  chat's metadata, so it travels with export, import and branching. Transcript
  turns stay in the ordinary roleplay messages — no parallel store to keep in
  step. Sticker image files are the exception: they live in Mochi's browser
  storage, not chat metadata or SillyTavern's media directories.

## Opening it

Ways to open it:

| Where | How |
| --- | --- |
| Floating bubble | The draggable phone button, initially at the bottom right of the chat. Its position is remembered and its colours follow the Mochi OS theme. |
| Wand menu | Extensions (wand) → **Mochi OS**. |
| Quick Reply | With Quick Replies switched **on**, a **Mochi OS** set holding one `/mochi` button is added to the bar. With them off, nothing is written at all. Delete the button and it stays deleted. |
| Slash command | `/mochi`, also `/mochios`. |

Mochi OS opens centred below SillyTavern's top settings bar. It is never wider
than that bar, but you can move it across the visible screen. It prefers phone
proportions (9:19.5); on mobile, opening the keyboard reduces its height without
shrinking its reading width. Conversations and editors scroll within the phone,
and the popup stays inside the visible viewport, including browser panning and
safe-area insets. Drag it by the four-arrow move button; the position is remembered
across opening, closing and page reloads. Temporary keyboard adjustments do not
overwrite your saved position. You can also focus
that button and use arrow keys (Shift for larger steps). **×** closes it;
Escape dismisses the current picker, actions or sheet first, then backs out of
the app and closes the phone.
Phone data and transcripts belong to the selected SillyTavern chat; switching
chats resets the phone UI and cancels pending phone results.

Under **Extensions → Mochi OS**, the inline settings drawer has a **Show floating
bubble** checkbox. Hiding it leaves the wand menu, Quick Reply and slash command
available. Drag the bubble directly, or focus it and use **Alt + arrow keys**
(**Shift** for larger steps).

Settings keeps its original sidebar on wide screens and horizontal section strip
on phones. Hold and drag the navigation to reach more sections with a desktop
mouse, just as you swipe the strip on mobile, then click a section to open it.
The content scrolls independently; there is no resize divider or section grid.

In **Messages → Profile**, Screen Name edits `phone_data.user.nickname`, not the
SillyTavern persona's name. **People → Social Handle** reads and writes
`socialhandle`; older `screenName`, `screen_name` and `nickname` values remain
readable. New private transcripts identify their contact through `target=` only;
both the phone and inline widget resolve display aliases from `phone_data`.
Legacy transcript aliases remain supported, and group output is unchanged.

### Stickers and emoji

Open **More → Emoji → Stickers → Import stickers**. PNG, JPEG, GIF and WebP files
up to 10 MB each are supported. Select an imported sticker to send an image
bubble; emoji selection inserts into the composer, where Send queues it as text.
Use Refresh to request the phone's next reply, just as with other queued messages.

Images are saved in the browser's origin-private folder **`mochi-os/stickers`**,
with an IndexedDB fallback on browsers without folder storage. This is not a
folder beside the repository and does not use SillyTavern upload APIs. The
library survives page reloads and chat switches within the same browser profile
and origin; it is not synced across devices or included in SillyTavern chat
exports. Clearing site data removes the library. A sticker's **×** removes it
globally; older transcripts then show its name if its image is unavailable.

## Installing

The extension is four files. That is the whole install, and copying them is all
SillyTavern needs:

```
mochi-os/
  manifest.json
  index.js      the entry point SillyTavern loads
  app.js        the phone, fetched the first time it is opened
  style.css     the launcher's styles
```

Copy those into `SillyTavern/public/scripts/extensions/third-party/mochi-os/`
and reload. The extension appears under **Extensions** as *Mochi OS*, with a
floating-bubble toggle in its settings drawer. Installing from this repository instead:

```powershell
npm install          # once, to build
node scripts/install.mjs --target "D:\path\to\SillyTavern"
```

or just `npm run build`, which builds and installs into every SillyTavern it finds
next to this folder. Nothing is written anywhere else in the SillyTavern
directory.

To build without writing to any SillyTavern installation, use
`node build.mjs --no-install`.

For an existing installation, update the four runtime files in its existing
extension folder instead of creating a second differently named Mochi OS folder.
The installer replaces its destination folder, so do not use it over a source
checkout or a folder containing local work you need to keep.

### Offline checks

`npm run typecheck` and `npm test` check types and the SillyTavern integration
contract without touching an installation or sending API requests. After a
build, `node scripts/preview-st.mjs` serves an isolated UI fixture at
`http://127.0.0.1:8127`; generation is disabled there.
**Check chat features** runs bubble-action, long-press, settings, media and
conversation-isolation checks using only queued local mock replies. Reload the
page and run **Check saved stickers after reload** to verify real storage
persistence and remove the imported test sticker. **Check responsive controls**
tests viewport/keyboard placement and launcher behavior. **Check requested
updates** verifies wallpaper cropping, personas, target-only private records,
Social Handle editing, profile sizing and format-guide controls. Resize the
preview to a mobile viewport, or select **Use 320 × 568 test viewport** to constrain the phone's
visible area deterministically. Feature results report the measured visible size,
not the browser panel's preset label. None of these checks calls a live model or
writes to a SillyTavern installation.

### Why it is laid out this way

`index.js` depends only on SillyTavern's own host modules; the extension code it
needs is bundled inside it. SillyTavern loads that one file and reports a failure as
`Extension "Mochi OS" failed to load: [object Event]`, which is what a browser
returns when a **file is missing**: it is an Event, so it stringifies to nothing
useful. A layout with `index.js` importing a folder of chunks therefore turns one
missed file into an unreadable error. With this layout the entry cannot be broken
that way, and if `app.js` is missing the phone says so:

> Mochi OS could not be loaded (Failed to fetch dynamically imported module …/app.js).
> Its files are probably incomplete — reinstall the whole "mochi-os" folder, not just
> some of the files in it.

If you see the `[object Event]` message on a fresh install, the folder is not
where SillyTavern looks, or `manifest.json`/`index.js` did not arrive. Check both
files exist at the path above.

## How it maps onto SillyTavern

The engine owned a database, a request pipeline and a model connection.
SillyTavern owns all three, so each one is answered from what SillyTavern already
has:

| Engine | Here |
| --- | --- |
| `GET /chats/:id/messages` and friends | The open chat, read through `getContext().chat`. |
| Engine message ids | Minted once into `message.extra.mochiosId`, so the UI can hold an id across a generation. |
| `data_generation` YAML file | `chat_metadata.mochios.phoneDataYaml`, saved with the chat. |
| Transcript turns | The roleplay messages themselves. Bubble keys exist only in memory; no message ids are added to transcript YAML. |
| Incoming private/group replies | One complete YAML transcript per SillyTavern message, with each sender retained inside the record. The phone renders individual bubbles; edits and reactions target their YAML items. Older split turns remain readable and consolidate only when explicitly edited or regenerated. |
| Sticker library | Mochi-owned browser folder `mochi-os/stickers`, or IndexedDB fallback, shared across chats within the same browser/origin. |
| Lorebook assignments | Only explicitly configured global, chat, persona or character books (including group members and embedded card entries). Installed but unattached books are never activated; assignments are checked again before sending. |
| Model provider | Current connection via `generateRaw`, or saved profile via `ConnectionManagerRequestService`; template braces are protected. |
| Engine dialogs | SillyTavern's `callGenericPopup`. |
| Engine toasts | `toastr`. |
| Capability packages | Reported as none installed; Mochi OS only asks whether there are any. |

The `@marinara-engine/shared` package is not available outside the engine, so
`src/shared/` stands in for it: the engine's pure helpers (verbatim) plus the
types the interface reads. `src/compat/` does the same for `clsx`,
`tailwind-merge`, `i18next`, `react-i18next` and `sonner`.

### Prompt presets

Data generation and private/group replies use the same marker expansion.
**Chat History** inserts chronological user, assistant and narrator messages,
not one flattened system block. SillyTavern's prompt regexes, file attachments,
speaker-name settings and dialogue examples are respected. The greeting stays
in history rather than being repeated as an example.

World Info uses SillyTavern's scanner for activation, budgets and placement:
before/after lore, example lore and depth/Author's Note injections stay distinct.
Phone scanning does not leave lore added to the roleplay's Author's Note.
Summary and extension markers are supported without duplicate memory or lore.
The default history limit is `0` (retain the newest turns that fit the context);
saved message limits, tag filters and regeneration exclusions still apply.
Marker order and disabled markers are preserved, and new input precedes trailing
assistant prefill. Output-template placeholders remain literal.

## Layout

```
manifest.json               what SillyTavern reads first
index.js                    built entry point — self-contained
app.js                      built phone — fetched on demand by index.js
style.css                   the window, the launchers, the size container
src/
  index.ts                  the launchers, the event bridge, /mochi
  app.ts                    what app.js exports: the overlay, widgets, readiness
  st/                       everything SillyTavern-specific
    adapter.ts              the one place that touches getContext()
    api.ts                  the engine's REST surface, answered from SillyTavern
    mochi-data.ts           phone document storage, transcript generation
    phone-actions.ts        targeted transcript edits, deletion and reactions
    phone-transcript.ts     compatibility with older split-message turns
    stickers.ts             persistent global Mochi sticker library
    generate.ts             generateRaw, and the {{ escape
    preset.ts               shared ST-style prompt markers and chronological history
    lorebooks.ts            native World Info scanning and assignment compatibility
    connections.ts          saved profile selection and host request service
    host.tsx                the phone window: floating controls, drag, lifecycle
    frame-layout.ts         how big the window is and where it sits
    inline.tsx              the transcript widgets inside messages
    styles.ts               the stylesheets, in the engine's order
  components/chat/mochi-os/ the ported interface, identities and draggable navigation
  components/chat/          the four pieces of the engine's app shell Mochi OS borrows
  hooks/, stores/, lib/, shared/, types/, compat/
  styles/port-chrome.css    the chrome the port had to write, plus utility generation output
```

`index.js` and `app.js` are build output, committed because SillyTavern never
runs a package manager. `src/components/chat/mochi-os/MochiOsView.tsx` is adapted
for this port's transcript lifecycle and interactions. The ported
`mochi-os.css` retains the engine's design with targeted phone-layout adjustments;
host-specific responsive and interaction rules belong in `src/styles/port-chrome.css`.

### Why the interface is measured in `cq` units

The engine was the page, so it sized itself with `vh`/`vw` and switched layouts
with `@media (max-width: …)`. As a window inside SillyTavern those would describe
the browser, not the phone: desktop-sized tiles in a narrow window, and the
small-phone layout never selected on a wide screen.

`st/styles.ts` therefore rewrites the engine's stylesheet on the way into the
page: `vh`→`cqh`, `vw`→`cqw`, and size media queries→`@container`. The window's
screen (`style.css`) is the container, so the interface scales as one piece at any
window size. This unit/container conversion happens at build time, in memory.

## Working on it

```powershell
npm run typecheck    # tsc across the whole port
npm test             # offline integration contracts
node build.mjs --no-install          # one build, no installation writes
node build.mjs --watch --no-install  # rebuild on save, without installing
npm run install:st   # copy the four files without rebuilding
npm run tailwind     # regenerate the utility sheet (see below)
```

`npm run build` installs into neighboring SillyTavern directories automatically.
Use the explicit `--no-install` commands when those installations must remain
untouched.

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
