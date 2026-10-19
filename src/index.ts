/**
 * Mochi OS for SillyTavern — the extension's entry point.
 *
 * SillyTavern loads this one file, as an ES module, and calls the function named
 * in `manifest.json`'s `hooks.activate`. Everything else — React, the phone, the
 * stylesheet — lives in `app.js` beside it and is fetched the first time Mochi OS
 * is actually needed, so someone who never opens it pays almost nothing.
 *
 * This file must stay self-contained. It imports nothing but SillyTavern's own
 * context module and each other file it needs is inlined by the build: a missing
 * piece would make SillyTavern report "failed to load" with no useful detail,
 * because a browser hands the failure back as an Event.
 *
 * There are three ways in, on purpose: a floating bubble for reach, an entry in
 * the wand menu for discoverability, and `/mochi` for Quick Replies and scripts.
 */
import { ctx, offEvent, onEvent, stReady } from './st/adapter';

const LOG = '[Mochi OS]';
const LAUNCHER_ID = 'mochi-os-launcher';
const WAND_CONTAINER_ID = 'mochi_os_wand_container';
const WAND_ENTRY_ID = 'mochi_os_wand_entry';

const QUICK_REPLY_SET = 'Mochi OS';
const QUICK_REPLY_LABEL = 'Mochi OS';

/** The rest of the extension, in the file beside this one. */
type AppModule = typeof import('./app');

/** The slice of SillyTavern's Quick Reply API this extension uses. */
interface QuickReplyApi {
  listSets(): string[];
  listQuickReplies(setName: string): Array<{ label?: string }>;
  createSet(name: string): Promise<unknown>;
  createQuickReply(setName: string, label: string, props: Record<string, unknown>): unknown;
  addGlobalSet(name: string, isVisible?: boolean): void;
}

let initialized = false;
let disabled = false;
let appModule: AppModule | null = null;
let appLoading: Promise<AppModule> | null = null;
let widgetTimer: number | null = null;
let unlisten: Array<() => void> = [];

function notify(message: string, kind: 'error' | 'info' = 'error'): void {
  const toastr = (globalThis as { toastr?: Record<string, (m: string, t?: string) => void> }).toastr;
  if (toastr?.[kind]) toastr[kind](message, 'Mochi OS');
  else console[kind === 'error' ? 'error' : 'log'](LOG, message);
}

/**
 * `app.js` could not be fetched, or could not start.
 *
 * Only a failed fetch means the files are incomplete — a browser names the URL
 * when it can (and hands back an Event that says nothing when it cannot). Any
 * other error is our own, and claiming the install is broken would send someone
 * re-copying files for no reason.
 */
function reportLoadFailure(error: unknown): void {
  console.error(LOG, error);
  const detail = error instanceof Error && error.message ? error.message : String(error);
  const looksUnfetchable = /dynamically imported module|Failed to fetch|module script failed|404|not found/i.test(
    detail,
  );
  notify(
    looksUnfetchable
      ? `Mochi OS could not be loaded (${detail}). Its files are probably incomplete — ` +
          'reinstall the whole "mochi-os" folder, not just some of the files in it.'
      : `Mochi OS could not start (${detail}).`,
  );
}

function loadApp(): Promise<AppModule> {
  appLoading ??= import('./app.js').then(
    (module) => {
      appModule = module as AppModule;
      return appModule;
    },
    (error: unknown) => {
      // Let a later click try again instead of caching the failure.
      appLoading = null;
      throw error;
    },
  );
  return appLoading;
}

/** `app.js`, once it can read SillyTavern — it loads the context module itself. */
async function loadAppReady(): Promise<AppModule> {
  const module = await loadApp();
  await module.ready;
  return module;
}

async function toggleMochiOs(): Promise<void> {
  if (disabled) return;
  try {
    (await loadAppReady()).toggleMochiOs();
  } catch (error) {
    reportLoadFailure(error);
  }
}

/* ------------------------------------------------------------------ *
 * The floating bubble
 * ------------------------------------------------------------------ */

function installLauncher(): void {
  if (document.getElementById(LAUNCHER_ID)) return;

  const button = document.createElement('button');
  button.id = LAUNCHER_ID;
  button.type = 'button';
  button.className = 'mochi-os-launcher';
  button.title = 'Mochi OS';
  button.setAttribute('aria-label', 'Mochi OS');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<rect x="6.1" y="2.3" width="11.8" height="19.4" rx="3.3" />' +
    '<path d="M10.1 4.9h3.8" />' +
    '<circle cx="12" cy="18.2" r="1.1" />' +
    '</svg>';
  button.addEventListener('click', () => void toggleMochiOs());
  document.body.append(button);
}

/* ------------------------------------------------------------------ *
 * The wand menu entry
 * ------------------------------------------------------------------ */

function installWandEntry(attempt = 0): void {
  if (document.getElementById(WAND_ENTRY_ID)) return;
  if (disabled) return;

  const menu = document.getElementById('extensionsMenu');
  if (!menu) {
    // The wand menu is drawn after the extension list loads; a few short retries
    // cover a slow first paint without holding the extension up.
    if (attempt < 20) window.setTimeout(() => installWandEntry(attempt + 1), 500);
    return;
  }

  const container = document.createElement('div');
  container.id = WAND_CONTAINER_ID;
  container.className = 'extension_container';

  const entry = document.createElement('div');
  entry.id = WAND_ENTRY_ID;
  entry.className = 'list-group-item flex-container flexGap5 mochi-os-wand-entry';
  entry.tabIndex = 0;
  entry.setAttribute('role', 'button');
  entry.innerHTML =
    '<div class="fa-solid fa-mobile-screen extensionsMenuExtensionButton"></div>' +
    '<span>Mochi OS</span>';

  const activate = (): void => void toggleMochiOs();
  entry.addEventListener('click', activate);
  entry.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  });

  container.append(entry);
  menu.append(container);
}

/* ------------------------------------------------------------------ *
 * The /mochi command
 * ------------------------------------------------------------------ */

function registerCommand(): void {
  const context = ctx();
  const parser = context.SlashCommandParser;
  const Command = context.SlashCommand;
  if (!parser?.addCommandObject || !Command?.fromProps) {
    console.warn(LOG, 'SillyTavern has no slash command API; /mochi was not registered.');
    return;
  }

  try {
    parser.addCommandObject(
      Command.fromProps({
        name: 'mochi',
        aliases: ['mochios'],
        helpString: 'Opens or closes Mochi OS.',
        returns: 'nothing',
        callback: async () => {
          await toggleMochiOs();
          return '';
        },
      }),
    );
  } catch (error) {
    // Re-activating an extension registers the same command twice, and
    // SillyTavern throws rather than replacing it. The first one still works.
    console.warn(LOG, '/mochi is already registered.', error);
  }
}

/* ------------------------------------------------------------------ *
 * The Quick Reply button
 * ------------------------------------------------------------------ */

function quickReplyApi(): QuickReplyApi | null {
  // The Quick Reply extension publishes itself here; if it is switched off,
  // there is no API and nothing to add a button to.
  const api = (globalThis as { quickReplyApi?: QuickReplyApi }).quickReplyApi;
  return api && typeof api.createSet === 'function' ? api : null;
}

/**
 * Adds a Mochi OS button to the Quick Reply bar.
 *
 * Only for someone who already uses Quick Replies: with the feature switched
 * off there is no bar to put a button in, and writing one anyway would leave an
 * unused set in their data folder. Nothing is written in that case.
 *
 * SillyTavern cannot ship a Quick Reply inside an extension, so the set is made
 * through the Quick Reply extension's own API, looked up by label first so a
 * second page load never duplicates it. Deleting the button therefore sticks.
 */
async function installQuickReply(attempt = 0): Promise<void> {
  if (disabled) return;

  const quickReply = (ctx().extensionSettings as { quickReply?: { quickReplyEnabled?: boolean } })
    ?.quickReply;
  if (!quickReply?.quickReplyEnabled) return;

  const api = quickReplyApi();
  if (!api) {
    // The Quick Reply extension is activated around the same time as this one.
    if (attempt < 10) window.setTimeout(() => void installQuickReply(attempt + 1), 500);
    return;
  }

  try {
    if (!api.listSets().includes(QUICK_REPLY_SET)) await api.createSet(QUICK_REPLY_SET);

    const replies = api.listQuickReplies(QUICK_REPLY_SET) ?? [];
    if (!replies.some((reply) => reply.label === QUICK_REPLY_LABEL)) {
      api.createQuickReply(QUICK_REPLY_SET, QUICK_REPLY_LABEL, {
        message: '/mochi',
        icon: 'fa-solid fa-mobile-screen',
        title: 'Open Mochi OS',
        showLabel: false,
      });
    }

    api.addGlobalSet(QUICK_REPLY_SET, true);
  } catch (error) {
    console.warn(LOG, 'the Mochi OS Quick Reply could not be created.', error);
  }
}

/* ------------------------------------------------------------------ *
 * Transcript widgets
 * ------------------------------------------------------------------ */

/**
 * Whether any message in the open chat could hold a record.
 *
 * Deliberately duplicated from `app.js`: this decides whether that file is worth
 * fetching at all, so it has to be answerable without it.
 */
function chatMayHoldRecords(): boolean {
  const chat = ctx().chat;
  if (!Array.isArray(chat)) return false;
  return chat.some(
    (message) =>
      typeof message?.mes === 'string' &&
      /(?:privatechat_history|groupchat_history|chat_history)/i.test(message.mes) &&
      /<environment>/i.test(message.mes),
  );
}

/**
 * Re-reads the open chat for transcripts, once the current burst of events is
 * over.
 *
 * SillyTavern emits several events for one visible change (a message rendered,
 * then the chat saved), so the work is coalesced into one pass.
 */
function scheduleWidgetRefresh(): void {
  if (disabled) return;
  if (widgetTimer !== null) window.clearTimeout(widgetTimer);
  widgetTimer = window.setTimeout(() => {
    widgetTimer = null;
    if (disabled) return;
    // Loading 2 MB for a chat with no records would be waste; `app.js` is only
    // fetched once there is something for it to draw.
    if (!appModule && !chatMayHoldRecords()) return;

    void loadAppReady()
      .then((module) => module.refreshMochiWidgets())
      .catch((error: unknown) => reportLoadFailure(error));
  }, 150);
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function setOpenState(open: boolean): void {
  const button = document.getElementById(LAUNCHER_ID);
  button?.setAttribute('aria-pressed', String(open));
  button?.classList.toggle('is-open', open);
  document.getElementById(WAND_ENTRY_ID)?.classList.toggle('is-open', open);
}

function onVisibility(event: Event): void {
  setOpenState(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
}

function listen(name: string, handler: (...args: any[]) => void): void {
  onEvent(name, handler);
  unlisten.push(() => offEvent(name, handler));
}

function installEventBridge(): void {
  listen('CHAT_CHANGED', scheduleWidgetRefresh);

  for (const name of [
    'CHARACTER_MESSAGE_RENDERED',
    'USER_MESSAGE_RENDERED',
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'MORE_MESSAGES_LOADED',
  ]) {
    listen(name, scheduleWidgetRefresh);
  }

  document.addEventListener('mochios:visibility', onVisibility);
}

function installLaunchers(): void {
  installLauncher();
  installWandEntry();
  registerCommand();
}

/** Called by SillyTavern when the extension is loaded. */
export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    await stReady();
  } catch (error) {
    console.error(LOG, 'SillyTavern never became ready; Mochi OS will not start.', error);
    return;
  }

  installLaunchers();
  installEventBridge();
  void installQuickReply();
  // Messages already on screen were rendered before this module could listen.
  scheduleWidgetRefresh();
}

/** Called when the user switches the extension back on. */
export function onEnable(): void {
  disabled = false;
  if (!initialized) return;
  installLaunchers();
  scheduleWidgetRefresh();
}

/** Called when the user switches the extension off. */
export function onDisable(): void {
  disabled = true;

  if (widgetTimer !== null) window.clearTimeout(widgetTimer);
  widgetTimer = null;

  for (const remove of unlisten) remove();
  unlisten = [];
  document.removeEventListener('mochios:visibility', onVisibility);

  appModule?.disposeAll();

  document.getElementById(LAUNCHER_ID)?.remove();
  document.getElementById(WAND_CONTAINER_ID)?.remove();
  setOpenState(false);
}
