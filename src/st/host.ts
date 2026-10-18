/**
 * The host surface: a launcher button and a draggable floating panel.
 *
 * SillyTavern has no floating-window system, so this is the engine's
 * `FloatingWindow` / `WindowBubble` idea rebuilt on plain DOM. The panel is a
 * Shadow Root host so the ported design system — a few thousand lines of
 * `.mochi-scope` rules with its own custom properties — cannot leak into
 * SillyTavern's UI or be broken by it.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Phone } from '../ui/Phone';
import { injectStyles } from '../ui/styles';
import { readSettings, writeSettings } from './adapter';

interface PanelGeometry {
  width: number;
  height: number;
  /** Distance from the viewport's left edge. */
  left: number;
  /** Distance from the viewport's bottom edge. */
  bottom: number;
}

const GEOMETRY_KEY = 'panel';
const MIN_WIDTH = 260;
const MIN_HEIGHT = 320;

/** Docked to the right of the chat, clear of SillyTavern's send area. */
function defaults(): PanelGeometry {
  const width = Math.min(400, Math.max(MIN_WIDTH, window.innerWidth - 40));
  const height = Math.min(620, Math.max(MIN_HEIGHT, window.innerHeight - 40));
  return { width, height, left: Math.max(0, window.innerWidth - width - 24), bottom: 24 };
}

let panelHost: HTMLDivElement | null = null;
let panelShadow: ShadowRoot | null = null;
let reactRoot: Root | null = null;
let launcher: HTMLButtonElement | null = null;
let panelVisible = false;
let dragging: { mode: 'move' | 'resize'; startX: number; startY: number; origin: PanelGeometry } | null = null;

export function isPanelOpen(): boolean {
  return panelVisible;
}

export function togglePanel(): void {
  if (panelVisible) hidePanel();
  else showPanel();
}

export function showPanel(): void {
  if (!panelHost) return;
  panelVisible = true;
  panelHost.style.display = 'block';
  launcher?.setAttribute('aria-expanded', 'true');
  // Rendering here rather than at the call site means every way in — the
  // launcher, the slash command, a chat change — produces a phone.
  renderPhone();
}

export function hidePanel(): void {
  if (!panelHost) return;
  panelVisible = false;
  panelHost.style.display = 'none';
  launcher?.setAttribute('aria-expanded', 'false');
}

function geometry(): PanelGeometry {
  const fallback = defaults();
  const stored = readSettings()[GEOMETRY_KEY];
  if (!stored || typeof stored !== 'object') return fallback;
  const value = stored as Partial<PanelGeometry>;
  const width = clamp(value.width ?? fallback.width, MIN_WIDTH, window.innerWidth - 20);
  const height = clamp(value.height ?? fallback.height, MIN_HEIGHT, window.innerHeight - 20);
  const left = clamp(value.left ?? fallback.left, 0, Math.max(0, window.innerWidth - width));
  const bottom = clamp(value.bottom ?? fallback.bottom, 0, Math.max(0, window.innerHeight - height));
  return { width, height, left, bottom };
}

function saveGeometry(next: PanelGeometry): void {
  writeSettings({ [GEOMETRY_KEY]: next });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const PHONE_ICON =
  '<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M11 18h2"/>';

function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

/** Mount the launcher and the (hidden) panel. Safe to call once per session. */
export function mountHost(onPhoneStateChange?: () => void): void {
  if (panelHost) return;

  launcher = document.createElement('button');
  launcher.id = 'mochi-os-launcher';
  launcher.type = 'button';
  launcher.title = 'Mochi OS';
  launcher.setAttribute('aria-label', 'Mochi OS');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = svg(PHONE_ICON);
  launcher.addEventListener('click', () => {
    togglePanel();
    onPhoneStateChange?.();
  });

  panelHost = document.createElement('div');
  panelHost.id = 'mochi-os-host';
  panelHost.style.display = 'none';

  const shell = panelHost.attachShadow({ mode: 'open' });
  panelShadow = shell;

  const panel = document.createElement('div');
  panel.id = 'mochi-os-panel';

  const titlebar = document.createElement('div');
  titlebar.id = 'mochi-os-titlebar';
  titlebar.innerHTML = `
    <span class="mochi-os-grip">${svg('<path d="M4 8h16M4 16h16"/>')}</span>
    <span id="mochi-os-title">Mochi OS</span>
    <button type="button" data-action="home" title="Close">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
  `;

  const body = document.createElement('div');
  body.id = 'mochi-os-body';

  const resize = document.createElement('div');
  resize.id = 'mochi-os-resize';

  panel.append(titlebar, body, resize);
  shell.appendChild(panel);

  injectStyles(shell);

  const mountPoint = document.createElement('div');
  mountPoint.id = 'mochi-os-root';
  mountPoint.style.height = '100%';
  body.appendChild(mountPoint);
  reactRoot = createRoot(mountPoint);

  applyGeometry(panel);

  titlebar.querySelector('[data-action="home"]')?.addEventListener('click', () => {
    hidePanel();
    onPhoneStateChange?.();
  });
  titlebar.addEventListener('pointerdown', (event) => startDrag(event, 'move', panel));
  resize.addEventListener('pointerdown', (event) => startDrag(event, 'resize', panel));

  document.body.appendChild(panelHost);
  document.body.appendChild(launcher);
}

function applyGeometry(panel: HTMLElement): void {
  const geo = geometry();
  panel.style.width = `${geo.width}px`;
  panel.style.height = `${geo.height}px`;
  panel.style.left = `${geo.left}px`;
  panel.style.bottom = `${geo.bottom}px`;
}

function startDrag(event: PointerEvent, mode: 'move' | 'resize', panel: HTMLElement): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const geo = geometry();
  dragging = { mode, startX: event.clientX, startY: event.clientY, origin: geo };
  panel.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing');

  const onMove = (moveEvent: PointerEvent) => {
    if (!dragging) return;
    const dx = moveEvent.clientX - dragging.startX;
    const dy = moveEvent.clientY - dragging.startY;
    const origin = dragging.origin;

    const next: PanelGeometry =
      dragging.mode === 'move'
        ? {
            ...origin,
            left: clamp(origin.left + dx, 0, Math.max(0, window.innerWidth - origin.width)),
            bottom: clamp(origin.bottom - dy, 0, Math.max(0, window.innerHeight - origin.height)),
          }
        : {
            width: clamp(origin.width + dx, MIN_WIDTH, window.innerWidth - origin.left - 4),
            height: clamp(origin.height - dy, MIN_HEIGHT, window.innerHeight - origin.bottom - 4),
            left: origin.left,
            bottom: origin.bottom,
          };

    panel.style.width = `${next.width}px`;
    panel.style.height = `${next.height}px`;
    panel.style.left = `${next.left}px`;
    panel.style.bottom = `${next.bottom}px`;
    dragging.origin = next;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    panel.classList.remove('is-dragging', 'is-resizing');
    if (dragging) saveGeometry(dragging.origin);
    dragging = null;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** Render (or re-render) the phone into the panel. */
export function renderPhone(): void {
  if (!reactRoot || !panelVisible) return;
  reactRoot.render(createElement(Phone));
}

/** Keep the panel inside the viewport when the window is resized. */
export function watchViewport(): void {
  let frame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!panelShadow) return;
      const panel = panelShadow.getElementById('mochi-os-panel');
      if (panel) applyGeometry(panel);
    });
  });
}