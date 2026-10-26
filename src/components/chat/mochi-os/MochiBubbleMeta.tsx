import { useLayoutEffect, useRef } from 'react';

export function isMochiTextBubble(bubble: HTMLElement): boolean {
  return bubble.classList.contains('mochi-text-bubble') && !bubble.querySelector('img.mochi-chat-sticker-image, img.mochi-private-sticker');
}

export function setMochiLayoutValue(element: HTMLElement, name: string, value: number): void {
  const next = `${value}px`;
  if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next);
}

export function mochiTimestampWidth(meta: HTMLElement): number {
  const time = meta.matches('.mt, .mochi-private-time') ? meta : meta.querySelector('.mt, .mochi-private-time');
  if (!time) return 0;
  const range = document.createRange();
  range.selectNodeContents(time);
  return range.getBoundingClientRect().width;
}

/** Entrance animations translate the bubble without changing its layout box.
 * Measuring that animated bottom once would leave the avatar a few pixels low. */
export function mochiBubbleBottomOffset(message: HTMLElement, bubble: HTMLElement): number {
  const top = bubble.offsetTop - (bubble.offsetParent === message ? 0 : message.offsetTop);
  return Math.max(0, message.offsetHeight - top - bubble.offsetHeight);
}

/** Metadata gets the bubble's bounds, never the wider button footprint. An
 * unusually wide timestamp may extend left, but its right edge stays anchored. */
export function alignMochiBubbleMeta(message: HTMLElement, bubble: HTMLElement, meta: HTMLElement): void {
  const isText = isMochiTextBubble(bubble);
  message.classList.toggle('is-text-layout', isText);
  const avatar = message.classList.contains('mochi-private-bubble-wrap')
    ? message.parentElement?.querySelector<HTMLElement>(':scope > .mochi-private-mini-avatar') : null;
  if (!isText) {
    message.classList.remove('has-compact-meta');
    for (const name of ['--mochi-text-inline-size', '--mochi-text-inline-offset', '--mochi-text-label-size']) message.style.removeProperty(name);
    if (avatar) avatar.style.marginBottom = '';
    return;
  }
  const initial = bubble.getBoundingClientRect();
  const timeWidth = mochiTimestampWidth(meta);
  const sender = meta.querySelector<HTMLElement>('.mochi-msg-sender');
  message.classList.toggle('has-compact-meta', Boolean(sender && initial.width < timeWidth + 6 + Math.min(80, sender.scrollWidth)));
  setMochiLayoutValue(message, '--mochi-text-inline-size', initial.width);
  // Containing metadata can shrink a previously sender-sized wrapper. Read the
  // final geometry before positioning either incoming or outgoing timestamps.
  const wrapper = message.getBoundingClientRect();
  const content = bubble.getBoundingClientRect();
  const row = message.parentElement?.getBoundingClientRect();
  setMochiLayoutValue(message, '--mochi-text-inline-size', content.width);
  setMochiLayoutValue(message, '--mochi-text-inline-offset', content.left - wrapper.left);
  setMochiLayoutValue(message, '--mochi-text-label-size', Math.max(wrapper.width, Math.min(120, (row?.right ?? wrapper.right) - content.left)));
  if (avatar) avatar.style.marginBottom = `${mochiBubbleBottomOffset(message, bubble)}px`;
}

/** Observers survive ordinary React renders. Only real geometry or direct-child
 * changes (an edit or a changed action count) need another layout measurement. */
export function observeMochiBubbleLayout(message: HTMLElement, align: () => void): () => void {
  let watched = new Set<Element>();
  let actions: Element | null = null;
  let metadata: Element | null = null;
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
  function update() {
    align();
    const current = new Set<Element>([message, ...message.querySelectorAll(':scope > .b, :scope > .sticker, :scope > .mochi-private-bubble, :scope > .mochi-private-transfer, :scope > .mt, :scope > .mochi-bubble-meta, :scope > .mochi-private-time, :scope > .mochi-private-bubble-meta, :scope > :is(.mochi-bubble-meta, .mochi-private-bubble-meta) > *')]);
    for (const element of watched) if (!current.has(element)) resize?.unobserve(element);
    for (const element of current) if (!watched.has(element)) resize?.observe(element);
    watched = current;
    const nextActions = message.querySelector(':scope > .msg-actions-trigger');
    const nextMetadata = message.querySelector(':scope > .mt, :scope > .mochi-bubble-meta, :scope > .mochi-private-time, :scope > .mochi-private-bubble-meta');
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

/** Both sides use the same metadata markup; readonly widgets use the same
 * geometry helper without mounting phone action controls. */
export function MochiBubbleMeta({ time, sender, color, embedded = false, group = false }: {
  time: string; sender?: string; color?: string; embedded?: boolean; group?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const meta = ref.current;
    const message = meta?.parentElement;
    if (!meta || !message || message.querySelector(':scope > .msg-actions-trigger')) return;
    return observeMochiBubbleLayout(message, () => {
      const bubble = message.querySelector<HTMLElement>(':scope > .mochi-private-bubble, :scope > .mochi-private-transfer, :scope > .b, :scope > .sticker');
      if (bubble) alignMochiBubbleMeta(message, bubble, meta);
    });
  }, []);
  if (embedded && !group) return <time ref={(element) => { ref.current = element; }} className="mochi-private-time">{time}</time>;
  return <span ref={(element) => { ref.current = element; }} className={embedded ? 'mochi-private-bubble-meta' : 'mochi-bubble-meta'}>
    {sender && <span className="mochi-msg-sender" style={{ color }} title={sender}>{sender}</span>}
    <time className={embedded ? 'mochi-private-time' : 'mt'}>{time}</time>
  </span>;
}
