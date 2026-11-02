import type { ReactNode } from 'react';

/** The shared frame reserves room for controls even while they are hidden. */
export function MochiMessageActions({ children, inert }: { children: ReactNode; inert: boolean }) {
  return <div className="msg-actions-trigger" aria-label="Message actions" inert={inert}>{children}</div>;
}
