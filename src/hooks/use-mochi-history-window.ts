import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const MOCHI_HISTORY_PAGE_SIZE = 80;

/** Only the visible batch mounts bubble controls. Loading older messages keeps
 * the scroll anchor and original archive indexes; generation still sees history. */
export function useMochiHistoryWindow(threadKey: string, total: number, scrollRef: RefObject<HTMLElement | null>) {
  const [window, setWindow] = useState({ threadKey, count: MOCHI_HISTORY_PAGE_SIZE });
  const count = window.threadKey === threadKey ? window.count : MOCHI_HISTORY_PAGE_SIZE;
  const startIndex = Math.max(0, total - count);
  const anchor = useRef<{ threadKey: string; top: number; height: number } | null>(null);
  const showOlder = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll) anchor.current = { threadKey, top: scroll.scrollTop, height: scroll.scrollHeight };
    setWindow((previous) => ({ threadKey, count: (previous.threadKey === threadKey ? previous.count : MOCHI_HISTORY_PAGE_SIZE) + MOCHI_HISTORY_PAGE_SIZE }));
  }, [threadKey, scrollRef]);
  useLayoutEffect(() => {
    setWindow((previous) => previous.threadKey === threadKey ? previous : { threadKey, count: MOCHI_HISTORY_PAGE_SIZE });
    const previous = anchor.current;
    const scroll = scrollRef.current;
    anchor.current = null;
    if (scroll && previous?.threadKey === threadKey) scroll.scrollTop = previous.top + scroll.scrollHeight - previous.height;
  }, [threadKey, startIndex, scrollRef]);
  return { startIndex, showOlder };
}
