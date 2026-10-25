import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Controls reserve their own footprint, without widening text or stickers. */
export function MochiMessageActions({ children, inert }: { children: ReactNode; inert: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const actions = ref.current;
    const meta = actions?.previousElementSibling;
    if (!actions || !(meta instanceof HTMLElement)) return;
    const message = actions.parentElement;
    const bubble = message?.querySelector<HTMLElement>(':scope > .b, :scope > .sticker');
    const align = () => {
      actions.style.setProperty('--mochi-actions-meta-height', `${meta.getBoundingClientRect().height}px`);
      if (message && bubble) {
        const hasSticker = Boolean(bubble.querySelector('img.mochi-chat-sticker-image'));
        const count = actions.children.length;
        // Short text and small stickers still need usable buttons. Let the
        // controls size the wrapper, not the bubble; CSS caps it to the thread.
        const style = getComputedStyle(actions);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const minimum = count * 24 + Math.max(0, count - 1) * 4 + padding;
        actions.style.setProperty('--mochi-actions-inline-size', `${Math.max(bubble.getBoundingClientRect().width, minimum)}px`);
        const wrapper = message.getBoundingClientRect();
        const content = bubble.getBoundingClientRect();
        const width = actions.getBoundingClientRect().width;
        // Outgoing controls may extend left of a compact bubble, but never
        // beyond its wrapper. Long messages keep their original alignment.
        const offset = Math.min(Math.max(0, content.left - wrapper.left), Math.max(0, wrapper.width - width));
        if (hasSticker) message.style.setProperty('--mochi-sticker-inline-size', `${content.width}px`);
        else message.style.removeProperty('--mochi-sticker-inline-size');
        actions.style.setProperty('--mochi-actions-inline-offset', `${offset}px`);
        actions.style.setProperty('--mochi-actions-count', `${Math.max(1, count)}`);
        actions.style.setProperty('--mochi-actions-wrapper-inline-size', `${wrapper.width}px`);
      } else {
        message?.style.removeProperty('--mochi-sticker-inline-size');
        actions.style.removeProperty('--mochi-actions-inline-size');
        actions.style.removeProperty('--mochi-actions-inline-offset');
        actions.style.removeProperty('--mochi-actions-count');
        actions.style.removeProperty('--mochi-actions-wrapper-inline-size');
      }
    };
    align();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(align);
    observer.observe(meta);
    if (message) observer.observe(message);
    if (bubble) observer.observe(bubble);
    return () => observer.disconnect();
  }, [children]);
  return <div ref={ref} className="msg-actions-trigger" aria-label="Message actions" inert={inert}>{children}</div>;
}
