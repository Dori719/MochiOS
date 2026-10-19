/**
 * Where the phone window goes, and how big it is.
 *
 * Kept apart from the DOM so the arithmetic can be read (and tested) on its own:
 * a movable window that is allowed to drift off screen, or to grow past the
 * SillyTavern it floats in, is the kind of bug that only shows up on someone
 * else's window size.
 */

/** Phone proportions: 9:19.5, the shape the interface was drawn for. */
export const PHONE_RATIO = 19.5 / 9;

/** Gap kept between the window and the edges of SillyTavern. */
export const EDGE = 12;

/**
 * Below this the phone stops being readable. It is a floor on usability, not a
 * promise: fitting inside the window comes first, so a very short viewport still
 * gets a complete (if small) phone rather than one whose dock is cut off.
 */
export const MIN_WIDTH = 160;

export interface FrameLimits {
  viewportWidth: number;
  viewportHeight: number;
  /** Width of SillyTavern's top bar: the window is never wider than this. */
  topbarWidth: number;
  /** Height of the top bar: the window starts below it and never covers it. */
  topbarHeight: number;
  /** Height of the window's own drag bar, which sits above the phone. */
  barHeight: number;
  edge?: number;
  minWidth?: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface FramePlace extends FrameSize {
  left: number;
  top: number;
}

function limitsOf(limits: FrameLimits): Required<FrameLimits> {
  return {
    ...limits,
    edge: limits.edge ?? EDGE,
    minWidth: limits.minWidth ?? MIN_WIDTH,
  };
}

/**
 * The largest phone that fits.
 *
 * Two constraints, and the stricter one wins: never wider than SillyTavern's top
 * bar, and never taller than the space between that bar and the bottom of the
 * window. Because the height follows from the width, the second constraint is
 * applied to the width.
 */
export function phoneSize(limits: FrameLimits): FrameSize {
  const { edge, minWidth, topbarWidth, topbarHeight, viewportHeight, barHeight } = limitsOf(limits);

  const topEdge = topbarHeight + edge;
  const availableHeight = Math.max(minWidth * PHONE_RATIO, viewportHeight - topEdge - edge - barHeight);
  const maxWidth = Math.max(minWidth, topbarWidth - edge * 2);

  const width = Math.min(maxWidth, availableHeight / PHONE_RATIO);
  return { width, height: width * PHONE_RATIO };
}

/** Keeps the whole window on screen, and below the top bar. */
export function placeFrame(
  left: number,
  top: number,
  size: FrameSize,
  limits: FrameLimits,
): { left: number; top: number } {
  const { edge, topbarWidth, topbarHeight, viewportWidth, viewportHeight, barHeight } = limitsOf(limits);

  const minLeft = edge;
  const maxLeft = Math.max(minLeft, Math.min(viewportWidth, topbarWidth) - size.width - edge);
  const minTop = topbarHeight + edge;
  const maxTop = Math.max(minTop, viewportHeight - size.height - barHeight - edge);

  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
}

/** Where the window first appears: down the right-hand side, centred. */
export function defaultPlace(size: FrameSize, limits: FrameLimits): { left: number; top: number } {
  const { edge, topbarWidth, topbarHeight, viewportWidth, viewportHeight, barHeight } = limitsOf(limits);

  const minTop = topbarHeight + edge;
  const room = viewportHeight - minTop - size.height - barHeight - edge;
  const top = minTop + Math.max(0, room / 2);
  const left = Math.min(viewportWidth, topbarWidth) - size.width - edge;

  return placeFrame(left, top, size, limits);
}

/** Everything the window needs to place itself, measured from the page. */
export function readLimits(barHeight: number): FrameLimits {
  const topbar = document.getElementById('top-bar');
  const rect = topbar?.getBoundingClientRect();

  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    // The top bar spans the application; fall back to the document when it is
    // not there (a very old SillyTavern, or a theme that hides it).
    topbarWidth: rect && rect.width > 0 ? rect.width : document.documentElement.clientWidth,
    topbarHeight: rect?.height ?? 0,
    barHeight,
  };
}
