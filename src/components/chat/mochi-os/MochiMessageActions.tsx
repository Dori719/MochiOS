import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Controls reserve their own footprint; they must never widen a sticker. */
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
      if (message && bubble?.querySelector('img.mochi-chat-sticker-image')) {
        const wrapper = message.getBoundingClientRect();
        const imageBubble = bubble.getBoundingClientRect();
        const count = actions.children.length;
        // Keep buttons usable on portrait/small stickers. Outgoing controls may
        // extend to the left of a narrow image, but never past the message edge.
        const minimum = count * 24 + Math.max(0, count - 1) * 4;
        const width = Math.min(wrapper.width, Math.max(imageBubble.width, minimum));
        const offset = Math.min(Math.max(0, imageBubble.left - wrapper.left), Math.max(0, wrapper.width - width));
        message.style.setProperty('--mochi-sticker-inline-size', `${imageBubble.width}px`);
        actions.style.setProperty('--mochi-actions-inline-size', `${width}px`);
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
