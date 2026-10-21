/**
 * Where the phone window goes, and how big it is.
 *
 * Kept apart from the DOM so the arithmetic can be read (and tested) on its own:
 * a movable window that is allowed to drift off screen, or to grow past the
 * SillyTavern it floats in, is the kind of bug that only shows up on someone
 * else's window size.
 */

import { placeFloating, readViewport } from './viewport';

/** Preferred proportions; a keyboard reduces height, not the reading width. */
export const PHONE_RATIO = 19.5 / 9;

/** Gap kept between the window and the edges of SillyTavern. */
export const EDGE = 12;

/**
 * Prefer a readable width even when there is not enough height for the original
 * aspect ratio. Fitting inside the visible viewport still takes precedence.
 */
export const MIN_WIDTH = 280;

export interface FrameLimits {
  viewportWidth: number;
  viewportHeight: number;
  viewportLeft?: number;
  viewportTop?: number;
  layoutWidth?: number;
  layoutHeight?: number;
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
  /** Width of SillyTavern's top bar: the window is never wider than this. */
  topbarWidth: number;
  /** Height of the top bar: the window starts below it and never covers it. */
  topbarHeight: number;
  topbarLeft?: number;
  topbarBottom?: number;
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
    viewportLeft: limits.viewportLeft ?? 0,
    viewportTop: limits.viewportTop ?? 0,
    layoutWidth: limits.layoutWidth ?? limits.viewportWidth,
    layoutHeight: limits.layoutHeight ?? limits.viewportHeight,
    topbarLeft: limits.topbarLeft ?? 0,
    topbarBottom: limits.topbarBottom ?? limits.topbarHeight,
    safeTop: limits.safeTop ?? 0,
    safeRight: limits.safeRight ?? 0,
    safeBottom: limits.safeBottom ?? 0,
    safeLeft: limits.safeLeft ?? 0,
  };
}

function topBoundary(limits: Required<FrameLimits>): number {
  const { viewportTop, viewportHeight, topbarBottom, edge, safeTop, safeBottom, barHeight } = limits;
  const start = viewportTop + Math.max(edge, safeTop);
  // If the browser pans past the top bar, it must not reserve the bar again.
  const belowBar = Math.max(start, topbarBottom + edge);
  return Math.min(belowBar, Math.max(start, viewportTop + viewportHeight - barHeight - Math.max(edge, safeBottom)));
}

/** Prefer phone proportions on desktop and retain a usable width on mobile/short screens. */
export function phoneSize(limits: FrameLimits): FrameSize {
  const resolved = limitsOf(limits);
  const { edge, minWidth, topbarWidth, viewportWidth, viewportHeight, viewportTop, barHeight, layoutWidth, layoutHeight, topbarHeight, safeLeft, safeRight, safeBottom } = resolved;
  const availableHeight = Math.max(0, viewportTop + viewportHeight - topBoundary(resolved) - Math.max(edge, safeBottom) - barHeight);
  const maxWidth = Math.max(0, Math.min(topbarWidth - edge * 2, viewportWidth - Math.max(edge, safeLeft) - Math.max(edge, safeRight)));
  const preferredWidth = layoutWidth <= 900
    ? Math.min(420, maxWidth)
    : Math.max(minWidth, (layoutHeight - topbarHeight - edge * 2 - barHeight) / PHONE_RATIO);
  const width = Math.floor(Math.min(maxWidth, preferredWidth));
  return { width, height: Math.floor(Math.min(width * PHONE_RATIO, availableHeight)) };
}

/** Keeps the whole window on screen, and below the top bar. */
export function placeFrame(
  left: number,
  top: number,
  size: FrameSize,
  limits: FrameLimits,
): { left: number; top: number } {
  const resolved = limitsOf(limits);
  const { edge, viewportWidth, viewportHeight, viewportLeft, viewportTop, barHeight } = resolved;
  const placed = placeFloating(left, top, { width: size.width, height: size.height + barHeight }, {
    ...resolved, width: viewportWidth, height: viewportHeight, left: viewportLeft, top: viewportTop,
  }, edge);
  return { left: placed.left, top: Math.max(topBoundary(resolved), placed.top) };
}

/** First launch: centred on SillyTavern's top bar, immediately below it. */
export function defaultPlace(size: FrameSize, limits: FrameLimits): { left: number; top: number } {
  const resolved = limitsOf(limits);
  return placeFrame(resolved.topbarLeft + (resolved.topbarWidth - size.width) / 2, topBoundary(resolved), size, limits);
}

/** Everything the window needs to place itself, measured from the page. */
export function readLimits(barHeight: number): FrameLimits {
  const topbar = document.getElementById('top-bar');
  const rect = topbar?.getBoundingClientRect();
  const viewport = readViewport();

  return {
    ...viewport,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportTop: viewport.top,
    // The top bar spans the application; fall back to the document when it is
    // not there (a very old SillyTavern, or a theme that hides it).
    topbarWidth: rect && rect.width > 0 ? rect.width : document.documentElement.clientWidth,
    topbarHeight: rect?.height ?? 0,
    topbarLeft: rect?.left ?? viewport.left,
    topbarBottom: rect?.bottom ?? viewport.top,
    barHeight,
  };
}
