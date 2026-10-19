/**
 * The window Mochi OS lives in, and the SillyTavern events that keep it current.
 *
 * Mochi OS is a phone interface, so it opens as a phone: a floating window with
 * the device's proportions, dragged by its bar, capped to the width of
 * SillyTavern's top bar and to the room below it. `frame-layout.ts` holds the
 * arithmetic; this file owns the elements and the lifecycle.
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
import { activeChatId, offEvent, onEvent, readChatSettings, writeChatSettings } from './adapter';
import { defaultPlace, phoneSize, placeFrame, readLimits, type FrameSize } from './frame-layout';
import { mochiQueryClient } from './query-client';
import { ensureMochiStyles } from './stylesheet';

const HOST_ID = 'mochi-os-host';

/**
 * Above SillyTavern's chat chrome, which tops out at 3000, and below its
 * dialogs (`#dialogue_popup`, 9999) so a confirmation opened from inside Mochi
 * OS is still visible. Toasts sit above everything at 999999.
 */
const OVERLAY_Z_INDEX = '3000';

/** Height of the drag bar, in px. Kept in step with `.mochi-os-frame-bar`. */
const BAR_HEIGHT = 30;

let host: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let root: Root | null = null;
let unlisten: Array<() => void> = [];

/** The phone's size, and where it sits, in viewport pixels. */
let size: FrameSize = { width: 0, height: 0 };
let position: { left: number; top: number } | null = null;

/** Where the window was last left, from the extension's settings. */
function storedPosition(): { left: number; top: number } | null {
  const stored = readChatSettings().window as { left?: unknown; top?: unknown } | undefined;
  if (!stored || typeof stored.left !== 'number' || typeof stored.top !== 'number') return null;
  return { left: stored.left, top: stored.top };
}

/** Remembers the window's position, but only once the user has moved it. */
function persistPosition(): void {
  if (!position) return;
  writeChatSettings({ window: { left: Math.round(position.left), top: Math.round(position.top) } });
}

/**
 * Sizes and places the window.
 *
 * On open the stored position is used; on a resize the current one is kept, so
 * the phone only moves if it no longer fits.
 */
function layout(initial: boolean): void {
  if (!host) return;

  const limits = readLimits(BAR_HEIGHT);
  size = phoneSize(limits);

  host.style.width = `${Math.round(size.width)}px`;
  // The bar is part of the window, not of the phone's proportions.
  host.style.height = `${Math.round(size.height + BAR_HEIGHT)}px`;

  const wanted = initial ? storedPosition() : position;
  const placed = wanted ? placeFrame(wanted.left, wanted.top, size, limits) : defaultPlace(size, limits);
  position = placed;

  host.style.left = `${Math.round(placed.left)}px`;
  host.style.top = `${Math.round(placed.top)}px`;
}

function onResize(): void {
  layout(false);
}

/**
 * Dragging by the bar.
 *
 * Pointer capture keeps the window following the cursor even when the cursor
 * leaves the bar — which it does constantly, because the bar is thin.
 */
function installDrag(bar: HTMLElement): void {
  let drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;

  bar.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || !host) return;
    if ((event.target as HTMLElement).closest('.mochi-os-frame-close')) return;

    const rect = host.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    host.classList.add('is-dragging');
    bar.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  bar.addEventListener('pointermove', (event: PointerEvent) => {
    if (!drag || !host || event.pointerId !== drag.pointerId) return;

    const placed = placeFrame(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      size,
      readLimits(BAR_HEIGHT),
    );
    position = placed;
    host.style.left = `${Math.round(placed.left)}px`;
    host.style.top = `${Math.round(placed.top)}px`;
  });

  const end = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    host?.classList.remove('is-dragging');
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    persistPosition();
  };

  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

function ensureHost(): HTMLDivElement {
  if (host?.isConnected && body) return body;

  const frame = document.createElement('div');
  frame.id = HOST_ID;
  frame.className = 'mochi-os-frame';
  frame.style.zIndex = OVERLAY_Z_INDEX;
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-label', 'Mochi OS');

  const bar = document.createElement('div');
  bar.className = 'mochi-os-frame-bar';

  const grip = document.createElement('span');
  grip.className = 'mochi-os-frame-grip';
  grip.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'mochi-os-frame-title';
  title.textContent = 'Mochi OS';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mochi-os-frame-close';
  close.title = 'Close Mochi OS';
  close.setAttribute('aria-label', 'Close Mochi OS');
  close.textContent = '×';
  close.addEventListener('click', () => closeMochiOs());

  bar.append(grip, title, close);

  const screen = document.createElement('div');
  screen.className = 'mochi-os-frame-body';

  frame.append(bar, screen);
  document.body.append(frame);

  host = frame;
  body = screen;

  installDrag(bar);
  layout(true);
  return screen;
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
 * Mirror SillyTavern into the store and the query cache while the window is up.
 *
 * SillyTavern owns the chat, generation and the character list, so Mochi OS
 * cannot be told about a change by whoever made it. Listening here — and only
 * while the window exists — keeps the cache honest without polling.
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
 * Tells the launchers whether the window is up.
 *
 * The phone can be closed from inside itself (dragging the home indicator
 * down), so the bubble cannot simply track its own clicks.
 */
function announce(open: boolean): void {
  document.dispatchEvent(new CustomEvent('mochios:visibility', { detail: { open } }));
}

/**
 * A last line of defence.
 *
 * Mochi OS is a large interface ported from another application; if something in
 * it throws, the alternative is a frozen layer with no way back. This turns that
 * into a readable message and a way out.
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

  window.addEventListener('resize', onResize);
  // Capture phase, so SillyTavern's own handlers never see the key.
  document.addEventListener('keydown', onKeyDown, true);
  announce(true);
}

export function closeMochiOs(): void {
  window.removeEventListener('resize', onResize);
  document.removeEventListener('keydown', onKeyDown, true);
  stopEventBridge();
  announce(false);

  const closing = root;
  const element = host;
  root = null;
  host = null;
  body = null;

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
