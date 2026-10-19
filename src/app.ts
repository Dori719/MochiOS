/**
 * Mochi OS itself: the overlay, the transcript widgets, the query cache and the
 * stylesheet.
 *
 * `index.js` never imports this file statically. It is fetched as a separate
 * module the first time Mochi OS is actually needed, so the entry script depends
 * on no other file and cannot be broken by one that is missing — the failure a
 * partial install used to produce ("failed to load: [object Event]", because a
 * browser reports a missing module as an Event that stringifies to nothing).
 *
 * This file is its own bundle, so it has its own copy of the adapter, and that
 * copy knows nothing about the entry's. It has to load SillyTavern's context
 * module for itself before it can read anything: `ready` is that promise, and
 * callers wait on it once.
 */
import { activeChatId, onEvent, stReady } from './st/adapter';
import { closeMochiOs, isMochiOsOpen, openMochiOs, toggleMochiOs } from './st/host';
import { disposeMochiWidgets, refreshMochiWidgets } from './st/inline';
import { removeMochiStyles } from './st/stylesheet';
import { useChatStore } from './stores/chat.store';

/**
 * Keeps the store's current chat in step with SillyTavern.
 *
 * Transcript widgets read the chat id from here, and they are on screen even when
 * the phone was never opened, so this cannot wait for `openMochiOs`.
 */
function syncActiveChat(): void {
  useChatStore.getState().setActiveChatId(activeChatId());
}

/**
 * Resolves once this bundle can read SillyTavern.
 *
 * Module scope must not touch the context before this: the adapter here has not
 * loaded `/scripts/st-context.js` yet, and asking it for the chat would throw
 * during import — which the browser reports as a failed module, with no hint
 * that the real problem was ordering.
 */
export const ready: Promise<void> = stReady().then(() => {
  syncActiveChat();
  onEvent('CHAT_CHANGED', syncActiveChat);
});

export { closeMochiOs, isMochiOsOpen, openMochiOs, refreshMochiWidgets, toggleMochiOs };

/** Takes Mochi OS back off the page, for the extension being switched off. */
export function disposeAll(): void {
  disposeMochiWidgets();
  closeMochiOs();
  removeMochiStyles();
}
