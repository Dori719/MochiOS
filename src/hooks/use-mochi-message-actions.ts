import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';

export interface MochiReplyTarget {
  author: string;
  text: string;
  isOutgoing: boolean;
}

interface MessageActionTarget extends MochiReplyTarget {
  id: string | number;
}

/** One pointer path for mouse, touch, and pen; scrolling must never become Reply. */
export function useMochiMessageActions(onReply: (target: MochiReplyTarget) => void, threadKey: string) {
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; pointerId: number; x: number; y: number } | null>(null);
  const suppressClick = useRef<string | number | null>(null);
  const activeElement = useRef<HTMLElement | null>(null);

  const cancelHold = useCallback(() => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);

  const dismiss = useCallback(() => {
    cancelHold();
    activeElement.current = null;
    setActiveId(null);
  }, [cancelHold]);

  useEffect(() => {
    const cancel = () => cancelHold();
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      cancelHold();
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, [cancelHold]);

  useEffect(() => {
    cancelHold();
    suppressClick.current = null;
    activeElement.current = null;
    setActiveId(null);
  }, [threadKey, cancelHold]);

  useEffect(() => {
    if (activeId === null) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[role="alertdialog"], [role="menu"], [data-chat-floating-panel]')) return;
      if (!activeElement.current?.contains(target)) setActiveId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [activeId, dismiss]);

  const isBubble = (target: EventTarget | null) => target instanceof Element
    && !target.closest('button, a, textarea, input, select, [contenteditable="true"], .msg-actions-trigger, .mochi-reaction-row')
    && Boolean(target.closest('.b, .sticker, .msg-image-thumb'));

  const interaction = (message: MessageActionTarget): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: 0,
    'aria-label': `${message.author}: ${message.text || 'Message'}`,
    onPointerDown(event) {
      cancelHold();
      suppressClick.current = null;
      if (event.button !== 0 || event.isPrimary === false || !isBubble(event.target)) return;
      const element = event.currentTarget;
      hold.current = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        timer: setTimeout(() => {
          hold.current = null;
          suppressClick.current = message.id;
          setActiveId(null);
          onReply({ author: message.author, text: message.text, isOutgoing: message.isOutgoing });
          if (element.isConnected) element.blur();
        }, 500),
      };
    },
    onPointerMove(event) {
      const start = hold.current;
      if (start && (event.pointerId !== start.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) {
        suppressClick.current = message.id;
        cancelHold();
      }
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onPointerLeave: cancelHold,
    onContextMenu(event) {
      if (isBubble(event.target)) { event.preventDefault(); cancelHold(); }
    },
    onClick(event) {
      if (suppressClick.current === message.id) {
        suppressClick.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!isBubble(event.target)) return;
      if (typeof window.getSelection === 'function' && window.getSelection()?.toString()) return;
      activeElement.current = event.currentTarget;
      setActiveId((previous) => previous === message.id ? null : message.id);
    },
    onKeyDown(event) {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      activeElement.current = event.currentTarget;
      setActiveId((previous) => previous === message.id ? null : message.id);
    },
  });

  return { activeId, interaction, dismiss };
}
