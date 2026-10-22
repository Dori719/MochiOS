import { useEffect, useRef, type ReactNode } from 'react';

/** Keep the original split layout; mouse/pen dragging scrolls its navigation. */
export function MochiSettingsSplit({ children }: { children: ReactNode }) {
  const drag = useRef<{
    sidebar: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const horizontal = start.sidebar.scrollWidth > start.sidebar.clientWidth;
      const vertical = start.sidebar.scrollHeight > start.sidebar.clientHeight;
      if (!start.moved && Math.hypot(horizontal ? dx : 0, vertical ? dy : 0) < 5) return;
      if (!horizontal && !vertical) return;
      if (!start.moved) {
        start.moved = true;
        suppressClick.current = true;
        start.sidebar.classList.add('is-dragging');
        try { start.sidebar.setPointerCapture(event.pointerId); } catch { /* Window listeners also cover embedded browsers. */ }
      }
      event.preventDefault();
      if (horizontal) start.sidebar.scrollLeft = start.left - dx;
      if (vertical) start.sidebar.scrollTop = start.top - dy;
    };
    const finish = (event?: PointerEvent) => {
      const start = drag.current;
      if (!start || (event && event.pointerId !== start.pointerId)) return;
      drag.current = null;
      start.sidebar.classList.remove('is-dragging');
      if (start.sidebar.hasPointerCapture(start.pointerId)) start.sidebar.releasePointerCapture(start.pointerId);
    };
    const blur = () => finish();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', blur);
    return () => {
      finish();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <div
      className="settings-split-body"
      onPointerDown={(event) => {
        suppressClick.current = false;
        // Touch keeps the original native swipe scrolling.
        if (event.pointerType === 'touch' || event.button !== 0 || event.isPrimary === false) return;
        const sidebar = event.target instanceof Element ? event.target.closest<HTMLElement>('.settings-split-sidebar') : null;
        if (!sidebar || !event.currentTarget.contains(sidebar)) return;
        drag.current = {
          sidebar, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: sidebar.scrollLeft, top: sidebar.scrollTop, moved: false,
        };
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDownCapture={() => { suppressClick.current = false; }}
      onDragStart={(event) => { if (drag.current) event.preventDefault(); }}
    >
      {children}
    </div>
  );
}
