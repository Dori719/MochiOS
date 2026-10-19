/**
 * Everything the Mochi OS interface is painted with, in one string.
 *
 * The engine's components import their stylesheets as side effects
 * (`import "./mochi-os.css"`), which is how a bundler is normally fed. The port
 * cannot use that: SillyTavern is a single long-lived document, so the styles
 * have to be switched on and off with the overlay instead of being appended to
 * `<head>` once at load. Every file below is therefore read as text and joined
 * here, and `st/host.tsx` injects the result into one `<style>` element it owns.
 *
 * The order is the order the engine effectively had:
 *
 *   1. Tailwind's utilities — generated, and scoped to `.mochi-scope`. The
 *      engine emitted them inside a cascade layer, so the stylesheet below (which
 *      is unlayered) won every collision; putting them first reproduces that.
 *   2. `mochi-os.css` — the engine's own stylesheet, copied verbatim.
 *   3. The two chat-widget stylesheets, also verbatim.
 *   4. `port-chrome.css` — the parts the port had to write itself, plus the
 *      engine's chat-chrome custom properties mapped onto Mochi tokens.
 */
import utilitiesCss from '../styles/tailwind.generated.css';
import engineCss from '../components/chat/mochi-os/mochi-os.css';
import privateChatWidgetCss from '../components/chat/mochi-os/mochi-private-chat-widget.css';
import groupChatWidgetCss from '../components/chat/mochi-os/mochi-group-chat-widget.css';
import portChromeCss from '../styles/port-chrome.css';

export const MOCHI_OS_STYLES = [
  utilitiesCss,
  engineCss,
  privateChatWidgetCss,
  groupChatWidgetCss,
  portChromeCss,
].join('\n\n');
