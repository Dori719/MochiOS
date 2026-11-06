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
      const withinMessage = activeElement.current?.contains(target) && target.closest(
        '.b, .sticker, .msg-image-thumb, .mochi-photo, .msg-actions-trigger, .mochi-swipe-trigger, .mochi-reaction-row',
      );
      if (!withinMessage) {
        activeElement.current = null;
        setActiveId(null);
      }
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
    && !target.closest('button:not(.mochi-photo-image), a, textarea, input, select, [contenteditable="true"], .msg-actions-trigger, .mochi-reaction-row')
    && Boolean(target.closest('.b, .sticker, .msg-image-thumb, .mochi-photo'));

  const interaction = (message: MessageActionTarget): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: 0,
    'aria-label': `${message.author}: ${message.text || 'Message'}`,
    onPointerOver(event) {
      if (event.pointerType !== 'mouse' || !isBubble(event.target)) return;
      activeElement.current = event.currentTarget;
      setActiveId(message.id);
    },
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
      // The row spans the thread width; blank space beside a bubble is not a
      // hover target. Keep a small bridge to its controls so they stay reachable.
      if (event.pointerType === 'mouse' && activeId === message.id) {
        const target = event.target;
        const overControl = target instanceof Element && Boolean(target.closest(
          '.msg-actions-trigger, .mochi-swipe-trigger, .mochi-reaction-row',
        ));
        const overContent = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          '.wmsg > .b, .wmsg > .sticker, .wmsg > .mochi-photo, .wmsg > .msg-actions-trigger, .wmsg > .mochi-swipe-trigger',
        )).some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
        });
        if (!overControl && !overContent) {
          activeElement.current = null;
          setActiveId(null);
        }
      }
      const start = hold.current;
      if (start && (event.pointerId !== start.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) {
        suppressClick.current = message.id;
        cancelHold();
      }
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onPointerLeave(event) {
      cancelHold();
      if (event.pointerType === 'mouse') {
        setActiveId((previous) => previous === message.id ? null : previous);
      }
    },
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
