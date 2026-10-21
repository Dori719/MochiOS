/** The visible viewport, not the layout viewport hidden behind a mobile keyboard. */
export interface Viewport {
  width: number;
  height: number;
  left: number;
  top: number;
  layoutWidth: number;
  layoutHeight: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readViewport(): Viewport {
  const visual = window.visualViewport;
  const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
  const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
  const style = getComputedStyle(document.documentElement);
  const inset = (side: string) => Math.max(0, finite(parseFloat(style.getPropertyValue(`--mochi-safe-${side}`))));
  return {
    width: Math.max(0, finite(visual?.width, window.innerWidth)),
    height: Math.max(0, finite(visual?.height, window.innerHeight)),
    left: Math.max(0, finite(visual?.offsetLeft)),
    top: Math.max(0, finite(visual?.offsetTop)),
    layoutWidth,
    layoutHeight,
    safeTop: inset('top'),
    safeRight: inset('right'),
    safeBottom: inset('bottom'),
    safeLeft: inset('left'),
  };
}

/** Used by both the popup and bubble; all coordinates are layout-viewport pixels. */
export function placeFloating(
  left: number,
  top: number,
  size: { width: number; height: number },
  viewport: Pick<Viewport, 'width' | 'height' | 'left' | 'top'> & Partial<Viewport>,
  edge = 12,
): { left: number; top: number } {
  const horizontalGap = Math.min(edge, Math.max(0, (viewport.width - size.width) / 2));
  const verticalGap = Math.min(edge, Math.max(0, (viewport.height - size.height) / 2));
  const minLeft = viewport.left + Math.max(horizontalGap, viewport.safeLeft ?? 0);
  const minTop = viewport.top + Math.max(verticalGap, viewport.safeTop ?? 0);
  const maxLeft = Math.max(minLeft, viewport.left + viewport.width - size.width - Math.max(horizontalGap, viewport.safeRight ?? 0));
  const maxTop = Math.max(minTop, viewport.top + viewport.height - size.height - Math.max(verticalGap, viewport.safeBottom ?? 0));
  return {
    left: Math.min(Math.max(finite(left, minLeft), minLeft), maxLeft),
    top: Math.min(Math.max(finite(top, minTop), minTop), maxTop),
  };
}

/** ST transforms its html element. Compensate for a scrolled/transformed fixed
 * containing block instead of assuming CSS left/top are screen coordinates. */
export function setFloatingPosition(element: HTMLElement, position: { left: number; top: number }): void {
  element.style.left = `${Math.round(position.left)}px`;
  element.style.top = `${Math.round(position.top)}px`;
  const rect = element.getBoundingClientRect();
  const dx = position.left - rect.left;
  const dy = position.top - rect.top;
  if (Math.abs(dx) > 1) element.style.left = `${Math.round(position.left + dx)}px`;
  if (Math.abs(dy) > 1) element.style.top = `${Math.round(position.top + dy)}px`;
}

/** Coalesce keyboard animation, viewport panning and orientation changes into one layout per frame. */
export function watchViewport(update: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  const visual = window.visualViewport;
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule);
  visual?.addEventListener('resize', schedule);
  visual?.addEventListener('scroll', schedule);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('orientationchange', schedule);
    visual?.removeEventListener('resize', schedule);
    visual?.removeEventListener('scroll', schedule);
  };
}
