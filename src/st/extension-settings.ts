/** Native inline drawer, using SillyTavern's own drawer styles and click delegation. */
import { readChatSettings, writeChatSettings } from './adapter';

const DRAWER_ID = 'mochi_os_settings';
const BUBBLE_ID = 'mochi_os_show_bubble';
let retry: number | null = null;

export function installExtensionSettings(onChange: () => void, attempt = 0): void {
  const existing = document.getElementById(BUBBLE_ID) as HTMLInputElement | null;
  if (existing) {
    existing.checked = readChatSettings().showFloatingBubble !== false;
    return;
  }
  const panel = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (!panel) {
    if (attempt < 20 && retry === null) retry = window.setTimeout(() => {
      retry = null;
      installExtensionSettings(onChange, attempt + 1);
    }, 500);
    return;
  }
  const container = document.createElement('div');
  container.id = DRAWER_ID;
  container.className = 'extension_container';
  container.innerHTML = '<div class="inline-drawer">' +
    '<div class="inline-drawer-toggle inline-drawer-header" role="button" tabindex="0" aria-expanded="false" aria-controls="mochi_os_settings_content">' +
    '<b>Mochi OS</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down" aria-hidden="true"></div></div>' +
    '<div class="inline-drawer-content" id="mochi_os_settings_content">' +
    `<label class="checkbox_label" for="${BUBBLE_ID}"><input type="checkbox" id="${BUBBLE_ID}"><span>Show floating bubble</span></label>` +
    '<small class="mochi-os-settings-hint">You can also open Mochi OS from the wand menu or with /mochi.</small></div></div>';
  const input = container.querySelector<HTMLInputElement>(`#${BUBBLE_ID}`)!;
  input.checked = readChatSettings().showFloatingBubble !== false;
  input.addEventListener('change', () => {
    writeChatSettings({ showFloatingBubble: input.checked });
    onChange();
  });
  const header = container.querySelector<HTMLElement>('.inline-drawer-header')!;
  header.addEventListener('click', () => header.setAttribute('aria-expanded', String(header.getAttribute('aria-expanded') !== 'true')));
  header.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    header.click();
  });
  panel.append(container);
}

export function disposeExtensionSettings(): void {
  if (retry !== null) window.clearTimeout(retry);
  retry = null;
  document.getElementById(DRAWER_ID)?.remove();
}
