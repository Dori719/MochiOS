import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { MochiMessageIdentity } from './MochiMessageIdentity';
import { observeMochiMessageLayout } from './mochi-message-layout';

type MochiMessageLayoutProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  outgoing?: boolean;
  embedded?: boolean;
  name?: string;
  /** Only group chats supply a sender label. It never belongs to the footer. */
  sender?: string;
  color?: string;
  avatar?: string | null;
  crop?: any;
  contentClassName?: string;
};

/** The same avatar/header/content/footer frame for every message type. */
export function MochiMessageLayout({
  children, outgoing = false, embedded = false, name = '', sender, color = 'var(--acc)',
  avatar, crop, className = '', contentClassName = '', ...props
}: MochiMessageLayoutProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content) return observeMochiMessageLayout(content);
  }, []);

  const Row = embedded ? 'article' : 'div';
  const rowClass = embedded ? 'mochi-private-message' : 'mrow';
  const directionClass = outgoing ? (embedded ? ' is-user' : ' out') : '';
  const label = outgoing ? '' : sender?.trim();
  return (
    <Row {...props} className={`${rowClass}${directionClass}${className ? ` ${className}` : ''}`}>
      {!outgoing && label && <MochiMessageIdentity embedded={embedded} name={name || label} color={color} avatar={avatar} crop={crop} />}
      <div ref={contentRef} className={`mochi-message-content ${embedded ? 'mochi-private-bubble-wrap' : 'wmsg'}${contentClassName ? ` ${contentClassName}` : ''}`}>
        {label && <span className="mochi-msg-sender" style={{ color }} title={label}>{label}</span>}
        {children}
      </div>
    </Row>
  );
}
