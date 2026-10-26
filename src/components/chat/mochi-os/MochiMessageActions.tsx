import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { alignMochiBubbleMeta, isMochiTextBubble, mochiTimestampWidth, observeMochiBubbleLayout, setMochiLayoutValue } from './MochiBubbleMeta';

/** Controls reserve their own footprint, without widening text or stickers. */
export function MochiMessageActions({ children, inert }: { children: ReactNode; inert: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const actions = ref.current;
    const message = actions?.parentElement;
    if (!actions || !message) return;
    const align = () => {
      const meta = actions.previousElementSibling;
      const bubble = message.querySelector<HTMLElement>(':scope > .b, :scope > .sticker');
      if (!(meta instanceof HTMLElement)) return;
      if (message && bubble) {
        const hasSticker = Boolean(bubble.querySelector('img.mochi-chat-sticker-image'));
        const isText = isMochiTextBubble(bubble);
        const count = actions.children.length;
        const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
        const gaps = Math.max(0, count - 1) * gap;
        const timestampSpace = Math.max(36, (isText ? mochiTimestampWidth(meta) : 0) + gap);
        const belowTimestamp = isText && bubble.getBoundingClientRect().width < count * 28 + gaps + timestampSpace;
        // Text that cannot fit every button beside the time uses the same
        // reserved row as stickers. Transfers and other bubble types stay put.
        actions.classList.toggle('is-below-timestamp', belowTimestamp);
        if (isText) actions.style.setProperty('--mochi-actions-timestamp-space', `${timestampSpace}px`);
        else actions.style.removeProperty('--mochi-actions-timestamp-space');
        // Short text and small stickers still need usable buttons. Let the
        // controls size the wrapper, not the bubble; CSS caps it to the thread.
        const style = getComputedStyle(actions);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const minimum = count * (belowTimestamp ? 28 : 24) + gaps + padding;
        setMochiLayoutValue(actions, '--mochi-actions-inline-size', Math.max(bubble.getBoundingClientRect().width, minimum));
        alignMochiBubbleMeta(message, bubble, meta);
        const wrapper = message.getBoundingClientRect();
        const content = bubble.getBoundingClientRect();
        const width = actions.getBoundingClientRect().width;
        // Outgoing controls may extend left of a compact bubble, but never
        // beyond its wrapper. Long messages keep their original alignment.
        const offset = Math.min(Math.max(0, content.left - wrapper.left), Math.max(0, wrapper.width - width));
        if (hasSticker) message.style.setProperty('--mochi-sticker-inline-size', `${content.width}px`);
        else message.style.removeProperty('--mochi-sticker-inline-size');
        setMochiLayoutValue(actions, '--mochi-actions-inline-offset', offset);
        actions.style.setProperty('--mochi-actions-count', `${Math.max(1, count)}`);
        actions.style.setProperty('--mochi-actions-wrapper-inline-size', `${wrapper.width}px`);
        setMochiLayoutValue(actions, '--mochi-actions-meta-height', meta.getBoundingClientRect().height);
      } else {
        actions.classList.remove('is-below-timestamp');
        actions.style.removeProperty('--mochi-actions-timestamp-space');
        message?.style.removeProperty('--mochi-sticker-inline-size');
        actions.style.removeProperty('--mochi-actions-inline-size');
        actions.style.removeProperty('--mochi-actions-inline-offset');
        actions.style.removeProperty('--mochi-actions-count');
        actions.style.removeProperty('--mochi-actions-wrapper-inline-size');
      }
    };
    return observeMochiBubbleLayout(message, align);
  }, []);
  return <div ref={ref} className="msg-actions-trigger" aria-label="Message actions" inert={inert}>{children}</div>;
}
