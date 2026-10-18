import { type ReactNode } from "react";

import { MOCHI_HOME_APPS, type MochiHomeAppMeta } from "./mochi-os.apps";

/**
 * Homescreen app registry with tile glyphs attached.
 *
 * The ids and label keys come from `MOCHI_HOME_APPS` so the rendered grid and
 * the pure ordering rules in `mochi-os.apps.ts` can never drift apart.
 */
export interface MochiHomeApp extends MochiHomeAppMeta {
  /** Glyph drawn on the app's gradient tile. */
  icon: ReactNode;
}

const glyph = (children: ReactNode): ReactNode => <svg viewBox="0 0 24 24">{children}</svg>;

const ICONS: Record<string, ReactNode> = {
  messages: glyph(
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  ),
  forum: glyph(
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  ),
  feed: glyph(
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>,
  ),
  maps: glyph(
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>,
  ),
  music: glyph(
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>,
  ),
  live: glyph(
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>,
  ),
  camera: glyph(
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>,
  ),
  calendar: glyph(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>,
  ),
  journal: glyph(
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>,
  ),
  tools: glyph(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 0-10 10 10 10 0 0 0 10 10 10 10 0 0 0 10-10 10 10 0 0 0-10-10zm0 4a6 6 0 0 1 6 6" />
    </>,
  ),
  photos: glyph(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>,
  ),
  files: glyph(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />),
};

export const MOCHI_HOMESCREEN_APPS: MochiHomeApp[] = MOCHI_HOME_APPS.map((app) => ({
  ...app,
  icon: ICONS[app.id] ?? null,
}));

const APP_BY_ID = new Map(MOCHI_HOMESCREEN_APPS.map((app) => [app.id, app]));

export function getMochiHomeApp(id: string): MochiHomeApp | undefined {
  return APP_BY_ID.get(id);
}
