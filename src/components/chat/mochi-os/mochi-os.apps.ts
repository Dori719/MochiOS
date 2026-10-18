/**
 * Canonical homescreen app definitions for Mochi OS.
 *
 * The homescreen renders from this list, never from a raw stored array. A
 * user's saved order is only ever a *permutation hint*: it is filtered down to
 * known ids, de-duplicated, and topped up with any app it is missing. That
 * keeps a stale or hand-edited `localStorage` value from rendering apps with
 * no icon and no click handler.
 *
 * This module holds no JSX so the ordering rules stay testable on their own;
 * the tile glyphs live alongside in `mochi-os.apps.tsx`.
 */

export interface MochiHomeAppMeta {
  id: string;
  /** Localization key for the homescreen label. */
  labelKey: string;
}

export const MOCHI_HOME_APPS: MochiHomeAppMeta[] = [
  { id: "messages", labelKey: "ui.chat.homeprofessormarichat.attachChatHistoryRangePrefix" },
  { id: "forum", labelKey: "ui.chat.mochiosview.forum" },
  { id: "feed", labelKey: "ui.chat.mochiosview.feed" },
  { id: "maps", labelKey: "ui.game.gamesessionhistory.maps" },
  { id: "music", labelKey: "game.toolbar.volume.music" },
  { id: "live", labelKey: "ui.chat.mochiosview.live" },
  { id: "camera", labelKey: "ui.chat.mochiosview.camera" },
  { id: "calendar", labelKey: "ui.chat.mochiosview.calendar" },
  { id: "journal", labelKey: "ui.game.gamesurfacecomponent.journal" },
  { id: "tools", labelKey: "extensions.contributions.tools" },
  { id: "photos", labelKey: "ui.chat.mochiosview.photos" },
  { id: "files", labelKey: "ui.agents.agenteditor.files" },
];

export const MOCHI_HOMESCREEN_APP_IDS: string[] = MOCHI_HOME_APPS.map((app) => app.id);

const APP_BY_ID = new Map(MOCHI_HOME_APPS.map((app) => [app.id, app]));

export function getMochiHomeAppMeta(id: string): MochiHomeAppMeta | undefined {
  return APP_BY_ID.get(id);
}

/**
 * Turn any stored value into a complete, valid homescreen order.
 *
 * Unknown ids are dropped, duplicates collapse to their first occurrence, and
 * apps missing from the stored list are appended in registry order. Always
 * returns every registry id exactly once.
 */
export function normalizeHomescreenAppOrder(stored: unknown): string[] {
  const known = new Set(MOCHI_HOMESCREEN_APP_IDS);
  const seen = new Set<string>();
  const order: string[] = [];

  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (typeof entry !== "string") continue;
      if (!known.has(entry) || seen.has(entry)) continue;
      seen.add(entry);
      order.push(entry);
    }
  }

  for (const id of MOCHI_HOMESCREEN_APP_IDS) {
    if (!seen.has(id)) order.push(id);
  }

  return order;
}
