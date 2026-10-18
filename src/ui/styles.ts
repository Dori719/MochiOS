/**
 * Style delivery for the Shadow Root.
 *
 * The ported stylesheets are imported as text rather than as CSS side effects:
 * the UI renders inside a Shadow Root, where a document-level stylesheet has no
 * reach, and SillyTavern only ever loads the one stylesheet the manifest
 * declares. Bundling them as text keeps the ported rules byte-identical and lets
 * the extension inject them exactly once, scoped to its own tree.
 */
import mochiOsCss from '../mochi/styles/mochi-os.css';
import privateWidgetCss from '../mochi/styles/mochi-private-chat-widget.css';
import groupWidgetCss from '../mochi/styles/mochi-group-chat-widget.css';
import panelChromeCss from '../st/panel.css';
import panelOverrides from './panel-overrides.css';

/**
 * Order matters: the ported sheets define the design system, the panel chrome
 * frames it, and the overrides only resize it for a floating panel.
 */
const CSS_TEXT = [mochiOsCss, privateWidgetCss, groupWidgetCss, panelChromeCss, panelOverrides].join('\n');

const STYLE_ID = 'mochi-os-ported-styles';

export function injectStyles(root: ShadowRoot): void {
  if (root.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  root.appendChild(style);
}

/** The host document needs the font the ported design system asks for. */
export function ensureFont(): void {
  const id = 'mochi-os-font';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap';
  document.head.appendChild(link);
}