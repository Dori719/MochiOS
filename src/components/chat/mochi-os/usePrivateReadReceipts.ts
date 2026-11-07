import { useEffect, type RefObject } from 'react';
import { savePrivateReadReceipts, type ReadReceiptTarget } from '../../../st/phone-read-receipts';

export interface VisibleReadReceipt extends ReadReceiptTarget {
  bubbleId: string;
  messageId: string;
  expectedContent: string;
  expectedSwipe: number;
}

/** Mark visible messages immediately; one archive write per source turn. */
export function usePrivateReadReceipts({ root, enabled, chatId, receipts, onSaved, suppressedIds }: {
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  chatId: string | null | undefined;
  receipts: VisibleReadReceipt[];
  onSaved: () => void;
  suppressedIds: RefObject<Set<string>>;
}) {
  useEffect(() => {
    const viewport = root.current;
    if (!enabled || !chatId || !viewport || !receipts.length) return;
    const byId = new Map(receipts.map((receipt) => [receipt.bubbleId, receipt]));
    const since = new Map<string, number>();
    const saved = new Set<string>();
    let disposed = false;
    let saving = false;
    const tick = async () => {
      if (saving || disposed) return;
      const bounds = viewport.getBoundingClientRect();
      if (document.visibilityState !== 'visible' || !viewport.getClientRects().length || bounds.height === 0 || viewport.closest('[hidden], [aria-hidden="true"]')) {
        since.clear();
        return;
      }
      const now = performance.now();
      const visible = new Set<string>();
      const ready: VisibleReadReceipt[] = [];
      for (const element of viewport.querySelectorAll<HTMLElement>('[data-msg-id]')) {
        const id = element.dataset.msgId!;
        const receipt = byId.get(id);
        if (!receipt || saved.has(id) || suppressedIds.current.has(id)) continue;
        const rect = element.getBoundingClientRect();
        const height = Math.min(rect.bottom, bounds.bottom, window.innerHeight) - Math.max(rect.top, bounds.top, 0);
        const width = Math.min(rect.right, bounds.right, window.innerWidth) - Math.max(rect.left, bounds.left, 0);
        // Half a normal bubble, or half a viewport for oversized content.
        if (width <= 0 || height < Math.min(rect.height, bounds.height) * 0.5 || height <= 0) continue;
        const x = (Math.max(rect.left, bounds.left, 0) + Math.min(rect.right, bounds.right, window.innerWidth)) / 2;
        const y = (Math.max(rect.top, bounds.top, 0) + Math.min(rect.bottom, bounds.bottom, window.innerHeight)) / 2;
        const top = document.elementFromPoint(x, y);
        if (!top || !element.contains(top)) continue;
        visible.add(id);
        if (!since.has(id)) since.set(id, now);
        if (now >= since.get(id)!) ready.push(receipt);
      }
      for (const id of since.keys()) if (!visible.has(id)) since.delete(id);
      if (!ready.length) return;
      saving = true;
      const groups = new Map<string, VisibleReadReceipt[]>();
      for (const receipt of ready) groups.set(receipt.messageId, [...(groups.get(receipt.messageId) || []), receipt]);
      let changed = false;
      try {
        for (const group of groups.values()) {
          if (disposed || document.visibilityState !== 'visible') break;
          const remaining = group.filter((receipt) => !suppressedIds.current.has(receipt.bubbleId));
          if (!remaining.length) continue;
          const first = remaining[0];
          const result = await savePrivateReadReceipts({ chatId, ...first, targets: remaining });
          if (result) {
            changed = true;
            group.forEach((receipt) => saved.add(receipt.bubbleId));
          }
        }
      } catch (error) {
        console.warn('Mochi OS: could not save read receipts', error);
        // Retry after a fresh dwell instead of repeatedly writing every tick.
        ready.forEach((receipt) => since.set(receipt.bubbleId, performance.now() + 4500));
      } finally {
        saving = false;
        // A render or manual toggle may dispose this effect during the save.
        // The archive still changed, so its query must always be refreshed.
        if (changed) onSaved();
      }
    };
    const reset = () => { since.clear(); void tick(); };
    document.addEventListener('visibilitychange', reset);
    viewport.addEventListener('scroll', reset, { passive: true });
    void tick();
    const interval = window.setInterval(() => { void tick(); }, 100);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', reset);
      viewport.removeEventListener('scroll', reset);
    };
  }, [root, enabled, chatId, receipts, onSaved, suppressedIds]);
}
