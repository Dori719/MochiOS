/**
 * Extension entry point.
 *
 * SillyTavern loads this as a module and calls the `activate` hook named in
 * manifest.json. It primes the host context, restores settings, mounts the panel
 * and keeps the phone in step with the chat it belongs to.
 */
import { primeContext, onEvent, hasChat } from './st/adapter';
import { hydrateSettings } from './core/settings';
import { hydratePhone, openThread } from './core/phone-data';
import { setState } from './core/store';
import { ensureFont } from './ui/styles';
import { hidePanel, mountHost, renderPhone, showPanel, togglePanel, watchViewport } from './st/host';

let started = false;
let starting: Promise<void> | null = null;

/** Events after which the active chat's phone must be reloaded. */
const CHAT_EVENTS = ['CHAT_CHANGED', 'CHAT_CREATED', 'CHAT_DELETED'];

/**
 * `/mochios` — open the phone without hunting for the launcher.
 *
 * Also navigates it, so the whole phone is reachable from the keyboard:
 *   /mochios              homescreen
 *   /mochios messages     the messenger
 *   /mochios profile      contacts, groups and the YAML editor
 *   /mochios settings     appearance, clock, preset
 *   /mochios thread=Aria  one contact's thread
 */
async function registerSlashCommand(): Promise<void> {
  try {
    const { SlashCommandParser } = await import('/scripts/slash-commands/SlashCommandParser.js');
    const { SlashCommand } = await import('/scripts/slash-commands/SlashCommand.js');
    // Both argument classes live in the same module.
    const { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = await import(
      '/scripts/slash-commands/SlashCommandArgument.js'
    );

    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: 'mochios',
        helpString: 'Opens Mochi OS for this chat. Optionally: messages, profile, settings, thread=<contact>.',
        // An unnamed argument arrives as the callback's second parameter; named
        // ones arrive on the first.
        unnamedArgumentList: [new SlashCommandArgument('Where to open', ARGUMENT_TYPE.STRING, false, false, '')],
        namedArgumentList: [
          new SlashCommandNamedArgument('thread', 'Open a contact\'s thread by name.', ARGUMENT_TYPE.STRING, false, false, ''),
        ],
        callback: async (args: Record<string, unknown>, where: string) => {
          await open();
          navigate(args, where);
          return '';
        },
      }),
    );
  } catch (error) {
    console.warn('[Mochi OS] slash command unavailable; use the launcher button', error);
  }
}

/** Move the phone to whatever the command named. */
function navigate(args: Record<string, unknown> | undefined, where: string | undefined): void {
  const thread = String(args?.thread ?? '').trim();
  if (thread) {
    const record = openThread(thread, 'private');
    setState({ openThreadId: record.id });
    return;
  }

  switch (String(where ?? '').trim().toLowerCase()) {
    case '':
      setState({ activeApp: null, openThreadId: null });
      break;
    case 'messages':
    case 'messenger':
      setState({ activeApp: { id: 'messages' } });
      break;
    case 'profile':
    case 'persona':
    case 'data':
      setState({ activeApp: { id: 'persona' } });
      break;
    case 'settings':
      setState({ activeApp: { id: 'settings' } });
      break;
    default:
      setState({ activeApp: null });
  }
}

async function showPhone(): Promise<void> {
  if (!hasChat()) {
    console.info('[Mochi OS] open a chat first');
    return;
  }
  await hydratePhone();
  renderPhone();
}

async function boot(): Promise<void> {
  if (started) return;
  if (starting) return starting;

  starting = (async () => {
    await primeContext();
    hydrateSettings();
    ensureFont();
    mountHost();
    watchViewport();

    // The phone belongs to a chat. Reload it whenever the chat changes, is
    // created or is deleted, so the panel never shows another chat's data.
    for (const event of CHAT_EVENTS) {
      onEvent(event, () => {
        void hydratePhone().then(() => renderPhone());
      });
    }

    if (hasChat()) await hydratePhone();
    await registerSlashCommand();

    started = true;
  })();

  return starting;
}

/** Open the phone, loading this chat's phone first. */
export async function open(): Promise<void> {
  await boot();
  await showPhone();
  showPanel();
}

/** Close the phone. */
export async function close(): Promise<void> {
  hidePanel();
}

/** Flip the phone open or shut. */
export async function toggle(): Promise<void> {
  await boot();
  togglePanel();
  if (hasChat()) await showPhone();
}

/** Called by SillyTavern through the manifest's `activate` hook. */
export async function init(): Promise<void> {
  try {
    await boot();
    console.info('[Mochi OS] ready — open the phone with the handset button or /mochios');
  } catch (error) {
    console.error('[Mochi OS] failed to start', error);
  }
}