const BUBBLE_SELECTOR = ':scope > .b, :scope > .sticker, :scope > .mochi-private-bubble, :scope > .mochi-private-transfer';
const META_SELECTOR = ':scope > .mochi-bubble-meta, :scope > .mochi-private-time';
const TIMESTAMP_CLEARANCE = 8;

function setLayoutValue(element: HTMLElement, name: string, value: number): void {
  const next = `${value}px`;
  if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next);
}

/** Content determines bubble bounds; controls reserve a separate usable width.
 * No message-type exceptions, and no avatar offsets tied to bubble height. */
export function alignMochiMessageLayout(message: HTMLElement): void {
  const bubble = message.querySelector<HTMLElement>(BUBBLE_SELECTOR);
  if (!bubble) return;
  const actions = message.querySelector<HTMLElement>(':scope > .msg-actions-trigger');
  let minimum = 0;
  if (actions) {
    const count = actions.children.length;
    const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
    // Measure layout widths, not hover transforms; every control keeps at least
    // its normal 28px target even when the fallback row currently wraps.
    minimum = Array.from(actions.children).reduce((total, control) => total + Math.max(28, (control as HTMLElement).offsetWidth), 0)
      + Math.max(0, count - 1) * gap;
    setLayoutValue(actions, '--mochi-actions-inline-size', Math.max(bubble.getBoundingClientRect().width, minimum));
    setLayoutValue(actions, '--mochi-actions-compact-inline-size', minimum);
  }

  // Read again after sizing controls: compact outgoing bubbles may now sit to
  // the right of a wider wrapper. The timestamp still follows the bubble edge.
  const wrapper = message.getBoundingClientRect();
  const content = bubble.getBoundingClientRect();
  setLayoutValue(message, '--mochi-bubble-inline-size', content.width);
  setLayoutValue(message, '--mochi-bubble-inline-offset', content.left - wrapper.left);

  // A tiny sticker can be shorter than its avatar. Keep a wide timestamp below
  // both without adding padding to, or resizing, the actual sticker image.
  const avatar = message.parentElement?.querySelector<HTMLElement>(':scope > .mini, :scope > .mochi-private-mini-avatar');
  setLayoutValue(message, '--mochi-bubble-meta-gap', Math.max(3, (avatar?.offsetHeight || 0) - bubble.offsetTop - bubble.offsetHeight + 3));

  if (actions) {
    const metadata = message.querySelector<HTMLElement>(META_SELECTOR);
    const time = metadata?.querySelector<HTMLElement>('time') || metadata;
    const clock = time?.getBoundingClientRect();
    const fits = Boolean(minimum && time?.textContent?.trim() && clock && minimum + TIMESTAMP_CLEARANCE <= clock.left - content.left);
    setLayoutValue(message, '--mochi-bubble-meta-block-size', metadata?.getBoundingClientRect().height || 0);
    message.classList.toggle('mochi-actions-inline', fits);
    // Measure wrapped controls even while collapsed. Inline controls reclaim
    // the timestamp height only when revealed, leaving no hidden footprint.
    const top = actions.getBoundingClientRect().top;
    const height = Math.max(0, ...Array.from(actions.children, (control) => control.getBoundingClientRect().bottom - top));
    setLayoutValue(actions, '--mochi-actions-block-size', height);
    const width = actions.getBoundingClientRect().width;
    const offset = Math.min(Math.max(0, content.left - wrapper.left), Math.max(0, wrapper.width - width));
    setLayoutValue(actions, '--mochi-actions-inline-offset', offset);
    setLayoutValue(actions, '--mochi-actions-wrapper-inline-size', wrapper.width);
  }
  const swipe = message.querySelector<HTMLElement>(':scope > .mochi-swipe-trigger');
  if (swipe) setLayoutValue(swipe, '--mochi-actions-block-size', Math.max(0, ...Array.from(swipe.children, (control) => (control as HTMLElement).offsetHeight)) + 6);
}

/** One observer per frame, retained across clock ticks and action reveals.
 * Edits, timestamps, action-count changes and late image loads remeasure it. */
export function observeMochiMessageLayout(message: HTMLElement): () => void {
  let watched = new Set<Element>();
  let actions: Element | null = null;
  let metadata: Element | null = null;
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
  function update() {
    alignMochiMessageLayout(message);
    const current = new Set<Element>([message, ...message.children]);
    for (const element of watched) if (!current.has(element)) resize?.unobserve(element);
    for (const element of current) if (!watched.has(element)) resize?.observe(element);
    watched = current;
    const nextActions = message.querySelector(':scope > .msg-actions-trigger');
    const nextMetadata = message.querySelector(META_SELECTOR);
    if (actions !== nextActions || metadata !== nextMetadata) {
      actions = nextActions;
      metadata = nextMetadata;
      mutation?.disconnect();
      mutation?.observe(message, { childList: true });
      if (metadata) mutation?.observe(metadata, { childList: true, characterData: true, subtree: true });
      if (actions) mutation?.observe(actions, { childList: true });
    }
  }
  mutation?.observe(message, { childList: true });
  update();
  return () => { resize?.disconnect(); mutation?.disconnect(); };
}
