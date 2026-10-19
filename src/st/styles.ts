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

/**
 * Re-points the engine's measurements at the phone window.
 *
 * The engine was the page, so it measured itself in viewport units: `10vh` for a
 * tile, `3vw` for a gutter, `@media (max-width: 700px)` for the small-phone
 * layout. Inside SillyTavern it is a window, and those units would then describe
 * the browser rather than the phone — tiles sized for a desktop, and the
 * small-phone layout never chosen on a wide screen.
 *
 * Container units say exactly what was meant: "relative to the thing holding
 * this". The window's screen is a size container, so `cqh`/`cqw` and the
 * `@container` queries resolve against the phone, and the interface scales as one
 * piece at any window size. The chat widgets share these stylesheets but live in
 * a message instead; they are given their own inline-size container, and where
 * neither exists container units fall back to the viewport, which is how they
 * looked before.
 */
function toPhoneMeasurements(css: string, { blockAxis }: { blockAxis: boolean }): string {
  const units = blockAxis
    ? css
        .replace(/(-?\d*\.?\d+)(?:sv|dv|lv)?vh\b/g, '$1cqh')
        .replace(/(-?\d*\.?\d+)(?:sv|dv|lv)?vw\b/g, '$1cqw')
    : // A transcript widget is only an inline-size container, so a block-axis
      // container unit would have nothing to measure. Its width is the phone's,
      // so `cqw` is right; its height stays the viewport's, as it always was.
      css.replace(/(-?\d*\.?\d+)(?:sv|dv|lv)?vw\b/g, '$1cqw');

  return units.replace(/@media\s*([^{]+)\{/g, (match, condition: string) => {
    // Only size queries move. Colour scheme, reduced motion, pointer and print
    // describe the machine, not the phone.
    if (!/\b(width|height)\b/.test(condition)) return match;
    if (/prefers-|orientation|aspect-ratio|hover|pointer|resolution|print/i.test(condition)) return match;
    return `@container ${condition.trim()} {`;
  });
}

export const MOCHI_OS_STYLES = [
  utilitiesCss,
  toPhoneMeasurements(engineCss, { blockAxis: true }),
  toPhoneMeasurements(privateChatWidgetCss, { blockAxis: false }),
  toPhoneMeasurements(groupChatWidgetCss, { blockAxis: false }),
  portChromeCss,
].join('\n\n');
