/** Lightweight draggable launcher: no React or phone stylesheet needed before opening. */
import { readChatSettings, writeChatSettings } from './adapter';
import { placeFloating, readViewport, setFloatingPosition, watchViewport } from './viewport';
import { buildMochiCustomTokens } from '../components/chat/mochi-os/mochi-os.color';

export const LAUNCHER_ID = 'mochi-os-launcher';
const SETTINGS_KEY = 'mochi-os-settings';
let removeLauncher: (() => void) | null = null;

function storedPosition(): { left: number; top: number } | null {
  const stored = readChatSettings().bubblePosition;
  return stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)
    ? { left: stored.left, top: stored.top } : null;
}

function appearance(): Record<string, any> {
  const settings = readChatSettings()[SETTINGS_KEY];
  try {
    return typeof settings === 'string' ? JSON.parse(settings)
      : settings ?? JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch { return {}; }
}

/** Same accent as Mochi's built-in/custom tokens, including automatic light/dark changes. */
export function launcherPalette(settings: Record<string, any>, systemDark: boolean): { accent: string; paper: string; text: string } {
  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && systemDark);
  if (settings.colorPreset === 'custom') {
    const rgb = settings.customRgb ?? { r: 127, g: 160, b: 97 };
    const channel = (value: unknown) => Math.round(Math.max(0, Math.min(255, Number(value) || 0))).toString(16).padStart(2, '0');
    const tokens = buildMochiCustomTokens(`#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`, dark ? 'dark' : 'light');
    return { accent: tokens['--acc'], paper: tokens['--paper'], text: tokens['--text'] };
  }
  const palettes: Record<string, [string, string, string, string, string]> = {
    ocean: ['#6fa2cc', '#e6f3fc', '#192433', '#2b4255', '#d8ebf9'],
    plum: ['#b57fb8', '#f5ecf7', '#2d1e2f', '#4a2c4d', '#f4e8f5'],
    peach: ['#d98e71', '#fdf0e9', '#361f15', '#523226', '#faebe4'],
  };
  const palette = palettes[settings.colorPreset];
  return palette ? { accent: palette[0], paper: palette[dark ? 2 : 1], text: palette[dark ? 4 : 3] }
    : { accent: dark ? '#94b172' : '#7fa061', paper: dark ? '#2c3a20' : '#f2f8df', text: dark ? '#e4f2c9' : '#33402a' };
}

export function updateLauncherTheme(): void {
  const button = document.getElementById(LAUNCHER_ID);
  if (!button) return;
  const palette = launcherPalette(appearance(), window.matchMedia('(prefers-color-scheme: dark)').matches);
  const screen = document.querySelector('#mochi-os-host .mochi-os-frame-body > .mochi-scope');
  if (screen) {
    const tokens = getComputedStyle(screen);
    palette.accent = tokens.getPropertyValue('--acc').trim() || palette.accent;
    palette.paper = tokens.getPropertyValue('--paper').trim() || palette.paper;
    palette.text = tokens.getPropertyValue('--text').trim() || palette.text;
  }
  button.style.setProperty('--mochi-launcher-accent', palette.accent);
  button.style.setProperty('--mochi-launcher-paper', palette.paper);
  button.style.setProperty('--mochi-launcher-text', palette.text);
}

export function disposeLauncher(): void {
  removeLauncher?.();
  removeLauncher = null;
  document.getElementById(LAUNCHER_ID)?.remove();
}

export function installLauncher(toggle: () => void): void {
  if (readChatSettings().showFloatingBubble === false) {
    disposeLauncher();
    return;
  }
  if (document.getElementById(LAUNCHER_ID)) { updateLauncherTheme(); return; }
  const button = document.createElement('button');
  button.id = LAUNCHER_ID;
  button.type = 'button';
  button.className = 'mochi-os-launcher';
  button.title = 'Open Mochi OS · drag to move';
  button.setAttribute('aria-label', 'Mochi OS');
  button.setAttribute('aria-description', 'Drag to move. Use Alt and arrow keys to move with the keyboard.');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.1" y="2.3" width="11.8" height="19.4" rx="3.3" /><path d="M10.1 4.9h3.8" /><circle cx="12" cy="18.2" r="1.1" /></svg>';
  document.body.append(button);
  let preferred = storedPosition();
  let position = { left: 0, top: 0 };
  let suppressClick = false;
  let drag: { pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null = null;
  const place = (left: number, top: number) => {
    position = placeFloating(left, top, { width: button.offsetWidth, height: button.offsetHeight }, readViewport());
    button.style.right = 'auto';
    setFloatingPosition(button, position);
  };
  const layout = () => {
    const viewport = readViewport();
    place(preferred?.left ?? viewport.left + viewport.width - button.offsetWidth - 16,
      preferred?.top ?? viewport.top + viewport.height - button.offsetHeight - 88);
  };
  const persist = () => {
    preferred = { ...position };
    writeChatSettings({ bubblePosition: { left: Math.round(position.left), top: Math.round(position.top) } });
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...position, moved: false };
    try { button.setPointerCapture(event.pointerId); } catch { /* Embedded browser fallback: window listeners. */ }
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = event.clientX - drag.startX;
    const y = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(x, y) < 6) return;
    drag.moved = true;
    suppressClick = true;
    button.classList.add('is-dragging');
    place(drag.left + x, drag.top + y);
    event.preventDefault();
  };
  const end = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    button.classList.remove('is-dragging');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (moved) persist();
  };
  button.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  button.addEventListener('lostpointercapture', end);
  button.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    suppressClick = false;
    toggle();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') suppressClick = false;
    if (!event.altKey || !event.key.startsWith('Arrow')) return;
    const step = event.shiftKey ? 40 : 10;
    place(position.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      position.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    persist();
    event.preventDefault();
  });
  const stopViewport = watchViewport(layout);
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', updateLauncherTheme);
  window.addEventListener('storage', updateLauncherTheme);
  removeLauncher = () => {
    stopViewport();
    scheme.removeEventListener('change', updateLauncherTheme);
    window.removeEventListener('storage', updateLauncherTheme);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  updateLauncherTheme();
  layout();
}
