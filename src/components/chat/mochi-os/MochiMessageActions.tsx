import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Align the controls to the existing metadata, never reposition the timestamp. */
export function MochiMessageActions({ children, inert }: { children: ReactNode; inert: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const actions = ref.current;
    const meta = actions?.previousElementSibling;
    if (!actions || !(meta instanceof HTMLElement)) return;
    const align = () => {
      actions.style.setProperty('--mochi-actions-meta-height', `${meta.getBoundingClientRect().height}px`);
    };
    align();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(align);
    observer.observe(meta);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="msg-actions-trigger" aria-label="Message actions" inert={inert}>{children}</div>;
}
