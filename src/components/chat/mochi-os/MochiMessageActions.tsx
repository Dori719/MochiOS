import type { ReactNode } from 'react';

/** Controls expand the shared message frame only while active. */
export function MochiMessageActions({ children, inert }: { children: ReactNode; inert: boolean }) {
  return <div className="msg-actions-trigger" aria-label="Message actions" inert={inert}>{children}</div>;
}
