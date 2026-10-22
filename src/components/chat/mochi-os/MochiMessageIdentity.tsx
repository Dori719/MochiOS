import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { getAvatarCropStyle } from '../../../lib/utils';

/** The original compact incoming avatar; group names stay beside the timestamp. */
export function MochiMessageIdentity({ name, color, avatar, crop }: { name: string; color: string; avatar?: string | null; crop?: any }) {
  const avatarRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = avatarRef.current;
    const message = element?.parentElement?.querySelector<HTMLElement>(':scope > .wmsg');
    if (!element || !message) return;
    // Controls reserve space without moving the original bottom-aligned avatar
    // away from its bubble. Their height can change when buttons wrap on phones.
    const align = () => {
      const actions = message.querySelector<HTMLElement>(':scope > .msg-actions-trigger');
      const offset = actions ? message.getBoundingClientRect().bottom - actions.getBoundingClientRect().top + parseFloat(getComputedStyle(actions).marginTop) : 0;
      element.style.marginBottom = `${Math.max(0, offset)}px`;
    };
    align();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(align);
    observer.observe(message);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={avatarRef} className="mini" style={{ '--c': color, background: color, overflow: 'hidden' } as CSSProperties} aria-label={name} title={name}>
      {avatar ? <img src={avatar} alt="" style={getAvatarCropStyle(crop)} /> : Array.from(name)[0]?.toUpperCase() || '?'}
    </span>
  );
}
