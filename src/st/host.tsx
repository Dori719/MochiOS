/**
 * The window Mochi OS lives in, and the SillyTavern events that keep it current.
 *
 * Mochi OS is a phone interface, so it opens as a phone: a floating window with
 * the device's proportions, dragged by its move button, capped to the width of
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
import { setFloatingPosition, watchViewport } from './viewport';

const HOST_ID = 'mochi-os-host';

/**
 * Above SillyTavern's chat chrome, which tops out at 3000, and below its
 * dialogs (`#dialogue_popup`, 9999) so a confirmation opened from inside Mochi
 * OS is still visible. Toasts sit above everything at 999999.
 */
const OVERLAY_Z_INDEX = '3000';

/** Space for the floating controls above the phone, in px. */
const BAR_HEIGHT = 48;

let host: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let root: Root | null = null;
let unlisten: Array<() => void> = [];

/** The phone's size, and where it sits, in viewport pixels. */
let size: FrameSize = { width: 0, height: 0 };
let position: { left: number; top: number } | null = null;
/** Temporary keyboard/resize clamping never overwrites where the user left it. */
let preferredPosition: { left: number; top: number } | null = null;
let stopViewport: (() => void) | null = null;
let topbarObserver: ResizeObserver | null = null;
let stopDrag: (() => void) | null = null;

/** Where the window was last left, from the extension's settings. */
function storedPosition(): { left: number; top: number } | null {
  const stored = readChatSettings().window as { left?: unknown; top?: unknown } | undefined;
  if (!stored || typeof stored.left !== 'number' || typeof stored.top !== 'number' || !Number.isFinite(stored.left) || !Number.isFinite(stored.top)) return null;
  return { left: stored.left, top: stored.top };
}

/** Remembers the window's position, but only once the user has moved it. */
function persistPosition(): void {
  if (!position) return;
  preferredPosition = { ...position };
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
  // The floating controls sit above the phone, outside its proportions.
  host.style.height = `${Math.round(size.height + BAR_HEIGHT)}px`;

  if (initial) preferredPosition = storedPosition();
  const wanted = preferredPosition;
  const placed = wanted ? placeFrame(wanted.left, wanted.top, size, limits) : defaultPlace(size, limits);
  position = placed;

  setFloatingPosition(host, placed);
}

function onResize(): void {
  layout(false);
  // Scroll an editor's own panel, never the page or the phone root sideways.
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !host?.contains(focused)) return;
  for (let panel = focused.parentElement; panel && panel !== host; panel = panel.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(panel).overflowY)) continue;
    const field = focused.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    if (field.bottom > bounds.bottom) panel.scrollTop += field.bottom - bounds.bottom;
    else if (field.top < bounds.top) panel.scrollTop -= bounds.top - field.top;
  }
}

/**
 * Dragging by the move button.
 *
 * Pointer capture keeps the window following the cursor outside the button.
 */
function installDrag(handle: HTMLElement): void {
  let drag: { pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null = null;

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || !host) return;

    const rect = host.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    host.classList.add('is-dragging');
    try { handle.setPointerCapture(event.pointerId); } catch { /* Some embedded browsers do not support capture. */ }
    event.preventDefault();
  });

  const move = (event: PointerEvent): void => {
    if (!drag || !host || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;

    const placed = placeFrame(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      size,
      readLimits(BAR_HEIGHT),
    );
    position = placed;
    setFloatingPosition(host, placed);
  };

  const end = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    host?.classList.remove('is-dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (moved) persistPosition();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  stopDrag = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    drag = null;
  };
}

function ensureHost(): HTMLDivElement {
  if (host?.isConnected && body) return body;

  const frame = document.createElement('div');
  frame.id = HOST_ID;
  frame.className = 'mochi-os-frame';
  frame.style.zIndex = OVERLAY_Z_INDEX;
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-label', 'Mochi OS');

  const controls = document.createElement('div');
  controls.className = 'mochi-os-popup-controls';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mochi-os-popup-control mochi-os-popup-close';
  close.title = 'Close Mochi OS';
  close.setAttribute('aria-label', 'Close Mochi OS');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>';
  close.addEventListener('click', () => closeMochiOs());

  const move = document.createElement('button');
  move.type = 'button';
  move.className = 'mochi-os-popup-control mochi-os-popup-move';
  move.title = 'Drag to move Mochi OS';
  move.setAttribute('aria-label', 'Move Mochi OS');
  move.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" /></svg>';
  move.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!host || !position || !event.key.startsWith('Arrow')) return;
    const step = event.shiftKey ? 40 : 10;
    const left = position.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0);
    const top = position.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    position = placeFrame(left, top, size, readLimits(BAR_HEIGHT));
    setFloatingPosition(host, position);
    persistPosition();
    event.preventDefault();
  });

  controls.append(close, move);

  const screen = document.createElement('div');
  screen.className = 'mochi-os-frame-body';

  frame.append(controls, screen);
  document.body.append(frame);

  host = frame;
  body = screen;

  installDrag(move);
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
    'MESSAGE_UPDATED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'USER_MESSAGE_RENDERED',
    'CHARACTER_MESSAGE_RENDERED',
  ]) {
    listen(name, (_index: unknown, source?: string) => {
      // The phone's mutation caller refreshes its own cache after persistence.
      // Refetching during awaited ST receive/render hooks hydrates the new
      // bubbles before that caller appends them, creating a duplicate reply.
      if (source !== 'mochios') invalidateAll();
    });
  }

  for (const name of [
    'CHAT_CREATED',
    'CHAT_DELETED',
    'GROUP_UPDATED',
    'CHARACTER_EDITED',
    'CHARACTER_DELETED',
    'CHARACTER_RENAMED',
    'PERSONA_CHANGED',
    'PERSONA_CREATED',
    'PERSONA_UPDATED',
    'PERSONA_DELETED',
    'WORLDINFO_UPDATED',
    'WORLDINFO_SETTINGS_UPDATED',
    'SETTINGS_UPDATED',
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
    'CONNECTION_PROFILE_LOADED',
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
  // Let the phone dismiss its topmost controls first, without handing Escape
  // to SillyTavern's panels underneath the overlay.
  const escape = new Event('mochios:escape', { bubbles: true, cancelable: true });
  host?.dispatchEvent(escape);
  if (!escape.defaultPrevented) closeMochiOs();
}

/**
 * Tells the launchers whether the window is up.
 *
 * The popup can be closed by its own control or Escape, so the bubble cannot
 * simply track its own clicks.
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

/** A chat switch starts a fresh phone UI; drafts and local threads never leak. */
function MochiChatView() {
  const chatId = useChatStore((state) => state.activeChatId);
  return <MochiOsView key={chatId ?? 'no-chat'} chatId={chatId} />;
}

export function openMochiOs(): void {
  if (root) return;

  ensureMochiStyles();
  invalidateAll();
  startEventBridge();
  syncActiveChat();

  root = createRoot(ensureHost());
  root.render(
    <QueryClientProvider client={mochiQueryClient()}>
      <OverlayBoundary>
        <MochiChatView />
      </OverlayBoundary>
    </QueryClientProvider>,
  );

  stopViewport = watchViewport(onResize);
  const topbar = document.getElementById('top-bar');
  if (topbar && typeof ResizeObserver !== 'undefined') {
    topbarObserver = new ResizeObserver(onResize);
    topbarObserver.observe(topbar);
  }
  // Capture phase, so SillyTavern's own handlers never see the key.
  document.addEventListener('keydown', onKeyDown, true);
  announce(true);
}

export function closeMochiOs(): void {
  stopViewport?.();
  stopViewport = null;
  topbarObserver?.disconnect();
  topbarObserver = null;
  stopDrag?.();
  stopDrag = null;
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

  // A Close action can be called inside the React tree, and React cannot
  // unmount a root while it is rendering. Waiting one task
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
