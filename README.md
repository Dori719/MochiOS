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
- **Content-sized text bubbles.** Short messages have no minimum bubble width or
  height, with the same layout for incoming and outgoing text. Timestamps stay
  below the actual bubble’s right edge, even when the time is wider than the text.
  Compact group replies keep the author on a separate line. When all action
  buttons cannot fit beside the timestamp, they use a
  separate row below it, like stickers. Transfer messages keep their existing
  sizing, and resizing a sticker reply's text never resizes its quoted sticker section.
- **Long conversations.** Phone threads and expanded transcript widgets initially
  render their newest 80 messages. **Load older messages** adds another 80 while
  preserving the scroll position. Saved and generation history are not shortened;
  cached archive indexes keep buried records and older-message actions responsive.
- **Live history.** Deleting roleplay turns immediately restores each phone
  thread's latest surviving messages and preview, including empty threads.
  Generated replies save only the relevant transcript and environment; model
  reasoning, unrelated tags, surrounding explanations and fences are discarded.
- **Emoji and global stickers.** More → Emoji opens the emoji/sticker picker.
  Import images once and use them in any Mochi chat, browser, or device connected
  to the same SillyTavern extension library.
- **The same data, in SillyTavern's terms.** The phone document lives in the
  chat's metadata, so it travels with export, import and branching. Transcript
  turns stay in the ordinary roleplay messages — no parallel store to keep in
  step. Sticker image files are the exception: they live in the Mochi extension's
  `stickers/` folder, not browser storage, chat metadata, or SillyTavern's media directories.

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

Open **More → Emoji → Stickers → Upload images**. PNG, JPEG, GIF and WebP files
up to 10 MB each are supported. Review the image previews, edit each name, and
choose **Save stickers**; Cancel leaves the library untouched. Suggested names
are unique, and saving rejects empty names or duplicates (ignoring case,
surrounding whitespace, and Unicode compatibility variants). Select a saved
sticker to send an image bubble; emoji selection inserts into the composer,
where Send queues it as text.
Use Refresh to request the phone's next reply, just as with other queued messages.

Use a saved sticker's **Rename** button to change its name at any time. Previous
names stay reserved for that sticker so existing messages continue to show its
image. **Export JSON** downloads a complete backup, including image bytes, names,
and previous names. **Import JSON** opens the same editable review before saving;
name conflicts and invalid images never overwrite existing stickers. The versioned
backup format is `{ "format": "mochi-os-stickers", "version": 1, "stickers": [...] }`;
each sticker has `name`, `mimeType`, a base64 image data URL in `data`, and optional
`aliases` for its previous names. No other files are needed to transfer it.

Images are saved on the machine running SillyTavern, inside the installed
Mochi OS extension's **`stickers/`** folder, alongside its runtime files. That
folder contains `.library.json` (names, aliases, and migration receipts) and
dot-prefixed UUID image files. Dotfiles are intentionally not served by
SillyTavern's public static-file handler; images are read through the authenticated
plugin API. The **Mochi OS sticker server plugin** below is required:
browser extensions cannot directly write to the server's filesystem. If it is
unavailable, Mochi shows setup instructions and does not silently save in the browser.
The picker displays the actual extension folder name, including installations named `MochiOS`.

The library survives page reloads, chat switches, and clearing browser site data.
Other browsers/devices connected to the same installation read the same files;
reopening Mochi or focusing its tab refreshes the library. Revision-checked saves
prevent one device from overwriting another's changes. A globally installed
extension shares its library; only SillyTavern admins may change it. User-local
extension installs keep their own libraries and do not require admin privileges.
Sticker files are not included in chat exports. Export JSON or back up the
`stickers/` folder before uninstalling the extension. **×** removes a sticker
from that library; older transcripts then show its name if its image is unavailable.

Existing OPFS/IndexedDB stickers migrate automatically when disk storage is first
available. Their names and aliases are preserved; identical images can merge,
but conflicting names/images never overwrite disk stickers. The old browser
copy is left untouched as a read-only recovery backup. Migration receipts on disk
prevent deleted stickers from reappearing on reload. If migration cannot finish,
use **Export browser JSON**, then **Import JSON** to review and resolve conflicts.
If a previous-name alias itself conflicts, edit that alias in the recovery JSON before importing.
New saves never write image bytes to browser storage.

Sent sticker bubbles fit their existing image dimensions exactly, without a
stretched container or empty space on the right. Sent and quoted stickers retain
the same **12px image corners** and image sizing in both the phone and embedded transcripts.
Sticker quotes keep their original padded cards and vertical spacing, with equal
left/right insets for character and user messages instead of excess empty space.
Message controls keep a separate footprint without widening small or portrait
stickers. Ordinary text quotes and unavailable-image fallbacks keep their normal layout.

## Installing

The browser interface is four runtime files, with one bundled server helper for
extension-folder sticker persistence:

```
mochi-os/
  manifest.json
  index.js      the entry point SillyTavern loads
  app.js        the phone, fetched the first time it is opened
  style.css     the launcher's styles
  sticker-storage.mjs  copy to SillyTavern/plugins/mochi-os-stickers.mjs for disk stickers
```

Copy those into `SillyTavern/public/scripts/extensions/third-party/mochi-os/`
and reload. The extension appears under **Extensions** as *Mochi OS*, with a
floating-bubble toggle in its settings drawer. Installing from this repository instead:

```powershell
npm install          # once, to build
node build.mjs --no-install
node scripts/install.mjs --target "D:\path\to\SillyTavern" --with-sticker-storage
```

Then set **`enableServerPlugins: true`** in SillyTavern's `config.yaml` and restart
SillyTavern. Install server plugins only from sources you trust. The installer
does not enable plugins, change server configuration, or restart a live server.
For manual installs, copy `sticker-storage.mjs` to
`SillyTavern/plugins/mochi-os-stickers.mjs`, enable the same setting, and restart.
The rest of the phone still works without the sticker server plugin.

`npm run build` builds and updates runtime files in neighboring SillyTavern
installations, but does not activate the server plugin. `--with-sticker-storage`
explicitly opts into copying the helper into SillyTavern's `plugins/` directory.

To build without writing to any SillyTavern installation, use
`node build.mjs --no-install`.

The installer reuses an existing Mochi OS extension folder instead of creating a
second differently named install. It updates only runtime/helper files, preserving
`stickers/`, `.git/`, source files, and unrelated local files. Local edits to the
runtime/helper files themselves are replaced, so back those up first. If several
Mochi OS installs exist, select one explicitly with `--folder MochiOS`.

### Repairing sticker storage when plugins are already enabled

**`enableServerPlugins: true` is not a plugin installer.** SillyTavern scans its
own `plugins/` folder when the server starts; it does not load the helper just
because it is bundled inside a browser extension. Installing or updating Mochi OS
through the browser therefore does not install its server plugin.

If the setting is already true but stickers still show the setup error, run this
from the Mochi OS directory to install **only** the missing server helper:

```powershell
node scripts/install.mjs --target "D:\path\to\SillyTavern" --sticker-storage-only
```

This writes only `plugins/mochi-os-stickers.mjs`; back up any local edits to that
helper first. Browser runtime files, extension source files, sticker libraries,
and server configuration are untouched. For a runtime-only manual installation without the
installer script, copy the installed extension's `sticker-storage.mjs` to
`SillyTavern/plugins/mochi-os-stickers.mjs` instead.

Target the installation printed as **`Server directory:`** when SillyTavern starts,
not another copy of SillyTavern or the extension folder. Keep the setting enabled
in that server's active configuration, then **stop and start SillyTavern**; reloading
the web page is not a server restart. Startup should initialize
`plugins/mochi-os-stickers.mjs` and report a loaded server plugin. Reopen the picker
or choose **Retry storage** afterward. An authenticated GET to
`/api/plugins/mochi-os-stickers/library?extension=MochiOS` (use your actual extension
folder name) should return the library JSON, not an unregistered-route 404.

### Offline checks

`npm run typecheck` and `npm test` check types, integration contracts, real disk
persistence/rollback, cross-device saves, safe migration, and plugin permissions
using temporary fixtures, without touching a live installation or sending API requests. After a
build, `node scripts/preview-st.mjs` serves an isolated UI fixture at
`http://127.0.0.1:8127`; generation is disabled there.
**Check chat features** runs bubble-action, long-press, settings, media and
conversation-isolation checks using only queued local mock replies. Reload the
page and run **Check saved stickers after reload** to verify real storage
persistence and remove the imported test sticker. **Check responsive controls**
tests viewport/keyboard placement and launcher behavior. **Check requested
updates** verifies wallpaper cropping, personas, target-only private records,
Social Handle editing, profile sizing, heading-style isolation and format-guide
controls.
**Check sticker management** verifies editable upload names, duplicate protection,
renaming without breaking old bubbles, JSON backup/restore, and rounded compact
sticker quotes in private/group chats and embedded transcripts. It uses the real
server helper with an isolated temporary extension folder, then removes only its
own test stickers. **Inspect sticker layout** checks wide, portrait, and small
images, incoming/outgoing quotes, long sender names and replies, and fixed image
bounds when controls appear, in both phone chats and embedded widgets. It also checks
content-sized short text bubbles, action placement as text grows/shrinks, unchanged
transfer sizing, unchanged sticker quotes as reply text grows, and right-edge
timestamp alignment with short and wide AM/PM times. **Check long histories** tests
300-message private/group records buried 150 roleplay turns back, pagination and
scroll anchors, older-message edits/reactions/branches/swipes/deletion, and collapsed
thread cleanup. **Inspect sticker layout** keeps
the isolated fixtures visible until **Clear sticker layout** is selected. Resize the
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
| Sticker library | The installed extension's `stickers/` folder, read/written through the Mochi OS server plugin and shared across chats/devices using that library. |
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

Mochi follows SillyTavern’s configured context size **and response length**, including
a saved connection profile’s completion preset, without switching the active API.
The prompt reserves the configured response tokens, counts recent history first,
and checks the final text/instruct formatting again before sending. Whole older
turns and example collections yield when needed; an oversized preset/format guide
or current task reports an error rather than sending beyond the selected budget.

## Layout

```
manifest.json               what SillyTavern reads first
index.js                    built entry point — self-contained
app.js                      built phone — fetched on demand by index.js
style.css                   the window, the launchers, the size container
sticker-storage.mjs          bundled dependency-free SillyTavern server plugin
server/sticker-storage.mjs   server plugin source; restricted disk paths and atomic writes
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
    sticker-format.ts       shared browser/server image and name validation
    sticker-storage.ts      server storage client and read-only browser migration
    generate.ts             generateRaw, and the {{ escape
    preset.ts               shared ST-style prompt markers and chronological history
    context-budget.ts       configured native/profile token limits and final prompt fitting
    prompt-template.ts      literal template-brace protection
    lorebooks.ts            native World Info scanning and assignment compatibility
    connections.ts          saved profile selection and host request service
    host.tsx                the phone window: floating controls, drag, lifecycle
    frame-layout.ts         how big the window is and where it sits
    inline.tsx              the transcript widgets inside messages
    styles.ts               the stylesheets, in the engine's order
  components/chat/mochi-os/ the ported interface, shared bubble metadata and cached archive index
  components/chat/          the four pieces of the engine's app shell Mochi OS borrows
  hooks/, stores/, lib/, shared/, types/, compat/
  styles/port-chrome.css    the chrome the port had to write, plus utility generation output
```

`index.js`, `app.js`, and `sticker-storage.mjs` are build output, committed because SillyTavern never
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
npm run install:st   # update runtime/helper files without rebuilding or enabling the server plugin
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
