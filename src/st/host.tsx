/**
 * The overlay that Mochi OS lives in, and the SillyTavern events that keep it
 * current.
 *
 * Mochi OS is a phone interface, not a panel: it paints its own wallpaper over
 * the whole viewport and then draws the device on top of it. So instead of
 * squeezing it into a SillyTavern drawer, the extension mounts it into a
 * full-viewport element it creates, and removes that element when the user
 * leaves. Nothing is left behind for SillyTavern to trip over, and the interface
 * is never half-there while a chat loads.
 *
 * The React tree is created on open and destroyed on close rather than kept
 * mounted and hidden: Mochi OS subscribes to the chat, to streaming and to a few
 * queries, and none of that should keep running while the extension is closed.
 */
import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { MochiOsView } from '../components/chat/mochi-os/MochiOsView';
import { useChatStore } from '../stores/chat.store';
import { activeChatId, offEvent, onEvent } from './adapter';
import { mochiQueryClient } from './query-client';
import { ensureMochiStyles } from './stylesheet';

const HOST_ID = 'mochi-os-host';

/**
 * Above SillyTavern's chat chrome, which tops out at 3000, and below its
 * dialogs (`#dialogue_popup`, 9999) so a confirmation opened from inside Mochi
 * OS is still visible. Toasts sit above everything at 999999.
 */
const OVERLAY_Z_INDEX = '3000';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let unlisten: Array<() => void> = [];

function ensureHost(): HTMLDivElement {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.className = 'mochi-os-host';
  host.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    // Sized from the viewport, not from `inset: 0`. SillyTavern is served inside
    // wrappers that can carry a transform, and that makes a fixed element's
    // containing block the wrapper's own box — which, with a fixed-position body,
    // has no height at all. `inset: 0` would then collapse the whole phone to
    // nothing. `dvh` always measures the viewport.
    'width: 100%',
    'height: 100dvh',
    `z-index: ${OVERLAY_Z_INDEX}`,
    // A plain block, so Mochi OS's own `w-full h-full` on the root keeps the
    // meaning it had in the engine.
    'display: block',
    'overflow: hidden',
  ].join('; ');
  document.body.append(host);
  return host;
}

function invalidateAll(): void {
  void mochiQueryClient().invalidateQueries();
}

/** Points the UI store at the chat SillyTavern currently has open. */
export function syncActiveChat(): void {
  useChatStore.getState().setActiveChatId(activeChatId());
}

function beginGeneration(): void {
  const store = useChatStore.getState();
  const chat = activeChatId() ?? undefined;
  store.clearStreamBuffer(chat);
  store.setStreaming(true, chat);
}

function endGeneration(): void {
  useChatStore.getState().setStreaming(false, activeChatId() ?? undefined);
}

/**
 * Mirror SillyTavern into the store and the query cache while the overlay is up.
 *
 * SillyTavern owns the chat, generation and the character list, so Mochi OS
 * cannot be told about a change by whoever made it. Listening here — and only
 * while the overlay exists — keeps the cache honest without polling.
 */
function startEventBridge(): void {
  const listen = (name: string, handler: (...args: any[]) => void): void => {
    onEvent(name, handler);
    unlisten.push(() => offEvent(name, handler));
  };

  listen('CHAT_CHANGED', () => {
    syncActiveChat();
    invalidateAll();
  });

  // Anything that changes what a chat or a contact looks like.
  for (const name of [
    'MESSAGE_SENT',
    'MESSAGE_RECEIVED',
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'USER_MESSAGE_RENDERED',
    'CHARACTER_MESSAGE_RENDERED',
    'CHAT_CREATED',
    'CHAT_DELETED',
    'GROUP_UPDATED',
    'CHARACTER_EDITED',
    'CHARACTER_DELETED',
    'CHARACTER_RENAMED',
    'PERSONA_CHANGED',
    'WORLDINFO_UPDATED',
  ]) {
    listen(name, invalidateAll);
  }

  listen('GENERATION_STARTED', beginGeneration);
  listen('STREAM_TOKEN_RECEIVED', (text: unknown) => {
    useChatStore.getState().appendStreamBuffer(String(text ?? ''), activeChatId() ?? undefined);
  });
  for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED', 'GENERATION_FAILED']) {
    listen(name, endGeneration);
  }
}

function stopEventBridge(): void {
  for (const remove of unlisten) remove();
  unlisten = [];
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  // Escape belongs to Mochi OS while it is open: SillyTavern would otherwise
  // also close whatever panel it thinks is showing underneath.
  event.preventDefault();
  event.stopPropagation();
  closeMochiOs();
}

/**
 * Tells the launchers whether the overlay is up.
 *
 * The overlay can be closed from inside itself (dragging the home indicator
 * down), so the bubble cannot simply track its own clicks.
 */
function announce(open: boolean): void {
  document.dispatchEvent(new CustomEvent('mochios:visibility', { detail: { open } }));
}

/**
 * A last line of defence.
 *
 * Mochi OS is a large interface ported from another application; if something in
 * it throws, the alternative is a frozen full-screen layer over SillyTavern with
 * no way back. This turns that into a readable message and a way out.
 */
class OverlayBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[Mochi OS]', error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          height: '100%',
          padding: '24px',
          background: '#2b3327',
          color: '#f2f8df',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <strong>Mochi OS could not be drawn.</strong>
        <span style={{ opacity: 0.75, fontSize: '0.9em', maxWidth: '32rem' }}>{error.message}</span>
        <button
          type="button"
          onClick={closeMochiOs}
          style={{
            marginTop: '8px',
            padding: '8px 18px',
            borderRadius: '999px',
            border: 'none',
            background: '#7fa061',
            color: '#fff',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    );
  }
}

export function isMochiOsOpen(): boolean {
  return root !== null;
}

export function openMochiOs(): void {
  if (root) return;

  ensureMochiStyles();
  startEventBridge();
  syncActiveChat();

  root = createRoot(ensureHost());
  root.render(
    <QueryClientProvider client={mochiQueryClient()}>
      <OverlayBoundary>
        <MochiOsView onReturn={closeMochiOs} />
      </OverlayBoundary>
    </QueryClientProvider>,
  );

  // Capture phase, so SillyTavern's own handlers never see the key.
  document.addEventListener('keydown', onKeyDown, true);
  announce(true);
}

export function closeMochiOs(): void {
  document.removeEventListener('keydown', onKeyDown, true);
  stopEventBridge();
  announce(false);

  const closing = root;
  const element = host;
  root = null;
  host = null;

  if (!closing) {
    element?.remove();
    return;
  }

  // `onReturn` is called from inside the React tree (the home-indicator drag),
  // and React cannot unmount a root while it is rendering. Waiting one task
  // lets the current event finish first. The stylesheet is left in place: a
  // transcript widget in a chat message may still be on screen.
  setTimeout(() => {
    closing.unmount();
    element?.remove();
  }, 0);
}

export function toggleMochiOs(): void {
  if (root) closeMochiOs();
  else openMochiOs();
}
