/**
 * The extension's stylesheet, injected once.
 *
 * The styles are not added at extension load, because someone who never opens
 * Mochi OS should not pay for 150 KB of them. They are added the first time
 * anything Mochi appears — the overlay, or a transcript widget inside a chat
 * message — and stay for the life of the page, since a widget can be on screen
 * while the overlay is closed.
 *
 * Everything the stylesheet contains is scoped to `.mochi-scope`, which both the
 * overlay's root and every widget carry, so it cannot reach SillyTavern's own
 * markup.
 */
import { MOCHI_OS_STYLES } from './styles';

const STYLE_ID = 'mochi-os-styles';

export function ensureMochiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MOCHI_OS_STYLES;
  document.head.append(style);
}

export function removeMochiStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}
